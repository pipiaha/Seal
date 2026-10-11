import { useCallback, useEffect, useRef, useState } from "react";
import { App, Button } from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { captureUserScope, assertUserScope } from "@/lib/user-scope-guard";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { prepareBackendGenerationTask } from "@/services/api/generation-task";
import {
    acceptMediaProposal,
    getMediaProposalTask,
    listMediaProposals,
    readAssistantPermissions,
    writeAssistantPermissions,
    stopAssistantMediaSession,
    resumeAssistantMediaSession,
    rejectMediaProposal,
    type AssistantPermissionMode,
    type MediaProposal,
} from "@/services/api/creator";
import type { AssistantGenerationProposal } from "@/services/api/agent-assistant";
import { cancelGenerationTask } from "@/services/api/task-center";
import type { CanvasAssistantController } from "./use-canvas-assistant";

const submitting = new Set<string>();
const continuing = new Set<string>();
type MediaOutcome = { assetIDs: string[]; status: string; error?: string };

export function useCreatorMediaActions(assistant: CanvasAssistantController, readOnly = false, userQueue?: { current: boolean }) {
    const projectId = assistant.projectId;
    const onStarted = assistant.markProposalHandled;
    const config = useEffectiveConfig();
    const [scope] = useState(() => captureUserScope());
    const context = `${scope.userScope}:${scope.epoch}:${projectId}:${assistant.sessionId || ""}`;
    const live = useRef(context);
    live.current = context;
    const assistantRef = useRef(assistant);
    assistantRef.current = assistant;
    const outcomes = useRef(new Map<string, MediaOutcome>());
    const attempted = useRef(new Set<string>());
    const paused = useRef(false);
    const previous = useRef(context);
    if (previous.current !== context) {
        previous.current = context;
        outcomes.current.clear();
        attempted.current.clear();
        paused.current = false;
    }
    const [outcomeRevision, setOutcomeRevision] = useState(0);
    const notifyUserQueueChanged = useCallback(() => setOutcomeRevision(value => value + 1), []);
    const [permissionBusy, setPermissionBusy] = useState(false);
    const [continuingContext, setContinuingContext] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<Record<string, string>>({});
    const queryClient = useQueryClient();
    const policyKey = ["assistant-permissions", scope.userScope, scope.epoch, projectId, assistant.sessionId];
    const policy = useQuery({ queryKey: policyKey, queryFn: () => readAssistantPermissions(projectId, assistant.sessionId!, scope), enabled: Boolean(projectId && assistant.sessionId), refetchInterval: 3000 });
    const proposals = useQuery({
        queryKey: ["creator-media", scope.userScope, scope.epoch, projectId, assistant.sessionId],
        queryFn: ({ signal }) => listMediaProposals(projectId, scope, signal),
        enabled: Boolean(projectId && assistant.sessionId),
        refetchInterval: 3000,
    });
    const items = (proposals.data?.items || []).filter((item) => item.sessionId === assistant.sessionId || !item.sessionId);
    const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: ["creator-media", scope.userScope, scope.epoch, projectId] }), [queryClient, projectId, scope]);
    const start = useCallback(
        async (proposal: Pick<MediaProposal, "proposalId" | "kind" | "prompt" | "modelKey"> | AssistantGenerationProposal, automatic = false) => {
            const key = `${scope.userScope}:${proposal.proposalId}`;
            if (submitting.has(key) || readOnly || (automatic && paused.current)) return;
            submitting.add(key);
            setFeedback((value) => ({ ...value, [proposal.proposalId]: "正在提交…" }));
            try {
                const input = await prepareBackendGenerationTask({ projectId, mode: proposal.kind, prompt: proposal.prompt || "", config: { ...config, model: proposal.modelKey, count: "1" }, expectedScope: scope });
                assertUserScope(scope);
                if (live.current !== context || (automatic && paused.current)) return;
                const task = await acceptMediaProposal(projectId, proposal.proposalId, input, scope, automatic);
                assertUserScope(scope);
                if (live.current !== context) return;
                if (paused.current && ["queued", "running"].includes(task.status)) {
                    await cancelGenerationTask(task.id);
                    await refresh();
                    return;
                }
                onStarted(proposal.proposalId);
                setFeedback((value) => ({ ...value, [proposal.proposalId]: `已提交任务 ${task.id}` }));
                await refresh();
            } catch (error) {
                if (live.current === context) setFeedback((value) => ({ ...value, [proposal.proposalId]: error instanceof Error ? error.message : "提交失败" }));
            } finally {
                submitting.delete(key);
            }
        },
        [projectId, onStarted, config, scope, context, readOnly, refresh],
    );
    useEffect(() => {
        if (policy.data?.mode !== "allow" || policy.isError || readOnly || paused.current) return;
        for (const item of items) if (item.sessionId === assistant.sessionId && item.autoContinue && !item.taskId && item.decision !== "rejected" && !feedback[item.proposalId]) void start(item, true);
    }, [proposals.data, policy.data, policy.isError, readOnly, assistant.sessionId, feedback, start]);
    const onOutcome = useCallback(
        (id: string, outcome: MediaOutcome) => {
            if (live.current !== context) return;
            const old = outcomes.current.get(id);
            if (JSON.stringify(old) === JSON.stringify(outcome)) return;
            outcomes.current.set(id, outcome);
            setOutcomeRevision((value) => value + 1);
        },
        [context],
    );
    useEffect(() => {
        const current = assistantRef.current;
        if (readOnly || paused.current || userQueue?.current || current.streaming || current.sessionBusy || current.error || !current.historyLoaded || continuingContext === context) return;
        const item = items.find((item) => item.sessionId === current.sessionId && item.autoContinue && !item.continuationTurnId && !attempted.current.has(item.proposalId) && (item.decision === "rejected" || outcomes.current.has(item.proposalId)));
        if (!item) return;
        const key = `${context}:${item.proposalId}`;
        if (continuing.has(key)) return;
        continuing.add(key);
        attempted.current.add(item.proposalId);
        setContinuingContext(context);
        const outcome = item.decision === "rejected" ? { assetIDs: [], status: "rejected" } : outcomes.current.get(item.proposalId)!;
        const message =
            outcome.status === "succeeded"
                ? "素材已制作完成。请继续原来的制作要求；先读取原计划和真实结果，复用已有素材，不重复生成。如用户已修改目标，遵循最新要求。"
                : `本次制作${outcome.status === "rejected" ? "已被拒绝" : outcome.status === "cancelled" ? "已取消" : outcome.status === "materialization_failed" ? "未能保存素材" : "失败"}。${outcome.error || ""} 请继续当前制作要求，说明影响并优先使用已有素材；拒绝或取消的方案不要重新提交。`;
        void current
            .send(
                message,
                [],
                outcome.assetIDs.map((id) => ({ kind: "asset" as const, id })),
                undefined,
                [],
                [],
                { continuationProposalId: item.proposalId },
            )
            .then((admitted) => {
                if (live.current === context) setFeedback((value) => ({ ...value, [item.proposalId]: admitted ? "结果已交给助手继续处理" : "自动续接未发送，请核对对话状态" }));
            })
            .catch((error) => {
                if (live.current === context) setFeedback((value) => ({ ...value, [item.proposalId]: error instanceof Error ? error.message : "自动续接失败" }));
            })
            .finally(() => {
                continuing.delete(key);
                if (live.current === context) setContinuingContext(null);
                void refresh();
            });
    }, [assistant.streaming, assistant.sessionBusy, assistant.error, assistant.historyLoaded, assistant.turns.length, proposals.data, outcomeRevision, context, continuingContext, readOnly, refresh]);
    const changeMode = async (mode: AssistantPermissionMode) => {
        if (readOnly) return;
        setPermissionBusy(true);
        try {
            const sessionId = await assistant.ensureSession();
            assertUserScope(scope);
            const value = await writeAssistantPermissions(projectId, sessionId, mode, scope);
            assertUserScope(scope);
            queryClient.setQueryData(["assistant-permissions", scope.userScope, scope.epoch, projectId, sessionId], value);
            setFeedback({});
            await refresh();
        } finally {
            setPermissionBusy(false);
        }
    };
    const reject = async (item: MediaProposal) => {
        if (readOnly) return;
        await rejectMediaProposal(projectId, item.proposalId, scope);
        assertUserScope(scope);
        await refresh();
    };
    const stop = async () => {
        paused.current = true;
        setOutcomeRevision((value) => value + 1);
        const stopped = await Promise.allSettled([assistant.sessionId ? stopAssistantMediaSession(projectId, assistant.sessionId, scope) : Promise.resolve(), assistant.stop()]);
        const cancelled = await Promise.allSettled(
            items
                .filter((item) => item.taskId && !item.continuationTurnId)
                .map(async (item) => {
                    const task = await getMediaProposalTask(projectId, item.taskId!, scope);
                    if (["queued", "running"].includes(task.status)) await cancelGenerationTask(item.taskId!);
                }),
        );
        await refresh();
        const failed = [...stopped, ...cancelled].find((result) => result.status === "rejected");
        if (failed?.status === "rejected") throw failed.reason;
    };
    const resume = useCallback(async () => {
        const sessionId = await assistant.ensureSession();
        await resumeAssistantMediaSession(projectId, sessionId, scope);
        assertUserScope(scope);
        paused.current = false;
    }, [assistant.ensureSession, projectId, scope]);
    const pending = items.some((item) => item.autoContinue && !item.continuationTurnId && item.decision !== "rejected") || continuingContext === context;
    return {
        start,
        feedback,
        items,
        onOutcome,
        reject,
        stop,
        mode: policy.data?.mode || "ask",
        changeMode,
        permissionBusy,
        pending,
        permissionError: policy.isError ? "对话权限读取失败，自动生成暂停" : proposals.isError ? "制作任务读取失败，请重新读取" : undefined,
        resume,
        notifyUserQueueChanged,
    };
}

export function CreatorMediaTasks({
    assistant,
    onStart,
    feedback,
    items,
    onOutcome,
    onReject,
    readOnly = false,
}: {
    assistant: CanvasAssistantController;
    onStart: (proposal: MediaProposal) => void;
    feedback: Record<string, string>;
    items: MediaProposal[];
    onOutcome: (id: string, result: MediaOutcome) => void;
    onReject: (item: MediaProposal) => void;
    readOnly?: boolean;
}) {
    if (!items.length) return null;
    return (
        <details open className="canvas-assistant-card">
            <summary>制作任务 · {items.length}</summary>
            {items.map((item) =>
                item.taskId ? (
                    <CreatorMediaTask key={item.proposalId} item={item} assistant={assistant} onOutcome={onOutcome} readOnly={readOnly} />
                ) : (
                    <div key={item.proposalId} className="space-y-2 border-t border-[var(--border)] py-3 text-sm">
                        <p>
                            {item.kind === "audio" ? "配音" : item.kind === "video" ? "生成视频" : "生成图片"} · {item.model}
                        </p>
                        <p className="whitespace-pre-wrap break-words">{item.prompt}</p>
                        <p className="canvas-assistant-meta">使用所选渠道生成 1 个结果，结果保存到资产库。</p>
                        {item.decision === "rejected" ? (
                            <p>已拒绝</p>
                        ) : item.sessionId && !item.autoContinue ? (
                            <p>制作已停止</p>
                        ) : (
                            <div className="canvas-assistant-card-actions">
                                <Button size="small" disabled={readOnly || Boolean(feedback[item.proposalId]?.startsWith("正在提交"))} onClick={() => onStart(item)}>
                                    批准生成
                                </Button>
                                <Button size="small" aria-label="拒绝" disabled={readOnly || item.decision === "approved" || Boolean(feedback[item.proposalId]?.startsWith("正在提交"))} onClick={() => onReject(item)}>
                                    拒绝
                                </Button>
                            </div>
                        )}
                        {feedback[item.proposalId] ? <p role="status">{feedback[item.proposalId]}</p> : null}
                    </div>
                ),
            )}
        </details>
    );
}

function CreatorMediaTask({ item, assistant, onOutcome, readOnly }: { item: MediaProposal; assistant: CanvasAssistantController; onOutcome: (id: string, result: MediaOutcome) => void; readOnly: boolean }) {
    const { message } = App.useApp();
    const [scope] = useState(() => captureUserScope());
    const [cancelling, setCancelling] = useState(false);
    const task = useQuery({
        queryKey: ["creator-media-task", scope.userScope, scope.epoch, item.projectId, item.taskId],
        queryFn: ({ signal }) => getMediaProposalTask(item.projectId, item.taskId!, scope, signal),
        refetchInterval: (query) => {
            const value = query.state.data;
            return !value || ["queued", "running"].includes(value.status) || (value.status === "succeeded" && value.resultState !== "READY" && !value.resultState?.startsWith("FAILED")) ? 3000 : false;
        },
    });
    const data = task.data;
    const active = data?.status === "running" || data?.status === "queued";
    const assetIDs = data?.outputs?.flatMap((output) => (output.materializedAssetId ? [output.materializedAssetId] : [])) || [];
    useEffect(() => {
        if (!data || !item.autoContinue || item.continuationTurnId) return;
        if (data.status === "succeeded" && data.resultState === "READY" && assetIDs.length) onOutcome(item.proposalId, { assetIDs, status: data.status });
        else if (["failed", "cancelled"].includes(data.status) || data.resultState?.startsWith("FAILED")) onOutcome(item.proposalId, { assetIDs: [], status: data.status === "succeeded" ? "materialization_failed" : data.status, error: data.error });
    }, [data, item.autoContinue, item.continuationTurnId, item.proposalId, onOutcome]);
    async function cancel() {
        setCancelling(true);
        try {
            assertUserScope(scope);
            await cancelGenerationTask(item.taskId!);
            assertUserScope(scope);
            await task.refetch();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "取消失败");
        } finally {
            setCancelling(false);
        }
    }
    return (
        <div className="space-y-2 border-t border-[var(--border)] py-3 text-sm">
            <p>
                {item.kind === "audio" ? "配音" : item.kind === "video" ? "视频" : "图片"} · {item.model}
            </p>
            <p role="status">{task.isError ? task.error.message : data ? `${data.stage || data.status} · ${data.progress || 0}%` : "读取任务…"}</p>
            {data?.error ? <p role="alert">{data.error}</p> : null}
            {active ? (
                <Button size="small" disabled={readOnly} loading={cancelling} onClick={() => void cancel()}>
                    取消制作
                </Button>
            ) : null}
            {item.continuationTurnId ? (
                <p className="canvas-assistant-meta">结果已交给助手继续处理</p>
            ) : item.autoContinue ? (
                <p className="canvas-assistant-meta">结果准备好后，助手会自动继续</p>
            ) : assetIDs.length ? (
                <Button
                    size="small"
                    disabled={assistant.streaming || assistant.sessionBusy}
                    onClick={() =>
                        void assistant.send(
                            `继续使用制作任务 ${item.taskId} 已完成的素材完成原来的要求。先读取现有结果，复用已有素材，不要重复生成。`,
                            [],
                            assetIDs.map((id) => ({ kind: "asset" as const, id })),
                        )
                    }
                >
                    使用这些素材继续
                </Button>
            ) : null}
            {task.isError ? (
                <Button size="small" onClick={() => void task.refetch()}>
                    重新读取
                </Button>
            ) : null}
        </div>
    );
}
