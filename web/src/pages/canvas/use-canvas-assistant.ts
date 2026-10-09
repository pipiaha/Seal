import { Grid } from "antd";
import type { EditWorkspaceContext } from "@/services/api/edit-projects";
import { useCallback, useEffect, useRef, useState } from "react";

import { scopedLocalStorage } from "@/lib/user-scope";
import { flushModelConfig, getModelConfigPersistenceState } from "@/services/model-config-repository";
import { workspaceCapabilities } from "@/services/workspace-mode";
import {
    activateAssistantSession,
    agentAssistantFailureText,
    AgentTurnFailedError,
    AgentChatNotAdmittedError,
    cancelAgentChat,
    steerAgentChat,
    createAssistantSession,
    getAgentHostStatus,
    getAssistantHistory,
    listAssistantSessions,
    restartAgentHost,
    streamAgentChat,
    undoAssistantTurn,
    type AgentChatReference,
    type AgentHostStatus,
    type AssistantSessionSummary,
    type AssistantTurn,
    type AssistantSkillUse,
    type AssistantUndoFailure,
    type AssistantToolActivity,
    type AssistantInstruction,
    type AssistantImage,
    type AssistantMedia,
} from "@/services/api/agent-assistant";
import { assistantChangedNodeIds, assistantLifecycleText } from "./canvas-assistant-copy";
import { waitForAssistant } from "./assistant-readiness";
import { findRecoveredAssistantTurn, type PendingAssistantRecovery } from "./canvas-assistant-recovery";
import { settleToolActivity, updateToolActivity } from "./assistant-tool-activity";

export const ASSISTANT_MIN_WIDTH = 320;
export const ASSISTANT_MAX_WIDTH = 560;
export const ASSISTANT_DEFAULT_WIDTH = 380;
/** 停靠宽度以下改成覆盖式抽屉：与版本记录侧栏共用同一个折返宽度。 */
export const ASSISTANT_DOCK_MIN_SHELL_WIDTH = 1050;

const OPEN_STORAGE_KEY = "canvas:assistant-open";
const WIDTH_STORAGE_KEY = "canvas:assistant-width";
const PROPOSAL_STORAGE_KEY = "canvas:assistant-proposals";
const PROPOSAL_MEMORY = 200;

/** 已决定过的提议只记一个键：同意用 proposalId，谢绝加后缀，两种结果不会互相冒充。 */
export function dismissedProposalKey(proposalId: string) {
    return `${proposalId}:skipped`;
}

export type CanvasRightPanel = "assistant" | "versions" | null;

/**
 * 画布右侧只有一个栏位：版本记录一旦打开就占住它。
 * 渲染两侧都读这一个判断，避免出现两块面板同时挤压画布。
 */
export function resolveCanvasRightPanel(assistantOpen: boolean, versionsOpen: boolean): CanvasRightPanel {
    if (versionsOpen) return "versions";
    return assistantOpen ? "assistant" : null;
}

export function clampAssistantWidth(width: number) {
    if (!Number.isFinite(width)) return ASSISTANT_DEFAULT_WIDTH;
    return Math.min(ASSISTANT_MAX_WIDTH, Math.max(ASSISTANT_MIN_WIDTH, Math.round(width)));
}

export type AssistantTurnStatus = {
    undoing?: boolean;
    undone?: boolean;
    undoFailure?: AssistantUndoFailure;
};

type CanvasRun = {
    activeTurnId: string | null;
    waitingForTurn: boolean;
    instructionBusy: boolean;
    instructionError: string | null;
    instructions: AssistantInstruction[];
    pendingInstruction: { instructionId: string; turnId: string; message: string } | null;
    sessionId: string | null;
    sessions: AssistantSessionSummary[];
    turns: AssistantTurn[];
    historyLoaded: boolean;
    historyError: string | null;
    historyRequest: number;
    sessionBusy: boolean;
    dispatched: boolean;
    recovery: PendingAssistantRecovery | null;
    pendingUserText: string | null;
    pendingSelectedNodeIds: string[];
    pendingRequestedSkill: AssistantSkillUse | null;
    streamed: string;
    toolActivity: AssistantToolActivity[];
    streaming: boolean;
    lifecycleNotice: string | null;
    controller: AbortController | null;
    error: string | null;
    lastSent: { text: string; selectedNodeIds: string[]; references: AgentChatReference[]; selectedSkill?: AssistantSkillUse; images?: AssistantImage[]; media?: AssistantMedia[]; continuationProposalId?:string } | null;
    turnStatus: Record<string, AssistantTurnStatus>;
};

const createRun = (): CanvasRun => ({
    activeTurnId: null,
    waitingForTurn: false,
    instructionBusy: false,
    instructionError: null,
    instructions: [],
    pendingInstruction: null,
    sessionId: null,
    sessions: [],
    turns: [],
    historyLoaded: false,
    historyError: null,
    historyRequest: 0,
    sessionBusy: false,
    dispatched: false,
    recovery: null,
    pendingUserText: null,
    pendingSelectedNodeIds: [],
    pendingRequestedSkill: null,
    streamed: "",
    toolActivity: [],
    streaming: false,
    lifecycleNotice: null,
    controller: null,
    error: null,
    lastSent: null,
    turnStatus: {},
});

type Options = {
    canvasId: string;
    getWorkspaceContext?: () => Promise<EditWorkspaceContext>;
    /** 回合落地后画布要立刻拉取最新内容，并把改动过的节点高亮出来。 */
    onCanvasChanged?: (canvasId: string, changedNodeIds: string[]) => void;
};

function readStoredProposals(): Set<string> {
    try {
        const raw = scopedLocalStorage.getItem(PROPOSAL_STORAGE_KEY);
        const parsed = raw ? (JSON.parse(raw) as unknown) : null;
        return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
    } catch {
        return new Set();
    }
}

/**
 * 画布内助手的全部状态。
 *
 * 每个画布各持一条运行记录：发送时冻结画布归属，异步结果只写回当时那条记录，
 * 切画布不会把回复落到别的画布上。已结束的回合来自服务端历史，刷新页面不丢。
 */
export function useCanvasAssistant({ canvasId, onCanvasChanged, getWorkspaceContext }: Options) {
    const [open, setOpenState] = useState(() => scopedLocalStorage.getItem(OPEN_STORAGE_KEY) !== "0");
    const [width, setWidthState] = useState(() => clampAssistantWidth(Number(scopedLocalStorage.getItem(WIDTH_STORAGE_KEY)) || ASSISTANT_DEFAULT_WIDTH));
    const [status, setStatus] = useState<AgentHostStatus | null>(null);
    const [statusBusy, setStatusBusy] = useState(false);
    const [handledProposals, setHandledProposals] = useState<Set<string>>(readStoredProposals);
    const [, forceRender] = useState(0);
    const streamRenderTimerRef = useRef<number | null>(null);

    const runsRef = useRef<Map<string, CanvasRun>>(new Map());
    const activeCanvasRef = useRef(canvasId);
    activeCanvasRef.current = canvasId;
    const onCanvasChangedRef = useRef(onCanvasChanged);
    const workspaceContextRef = useRef(getWorkspaceContext);
    workspaceContextRef.current = getWorkspaceContext;
    onCanvasChangedRef.current = onCanvasChanged;

    const runFor = useCallback((id: string): CanvasRun => {
        const existing = runsRef.current.get(id);
        if (existing) return existing;
        const created = createRun();
        runsRef.current.set(id, created);
        return created;
    }, []);

    const rerenderIfActive = useCallback((id: string) => {
        if (activeCanvasRef.current === id) forceRender((value) => value + 1);
    }, []);

    const flushStreamRender = useCallback((id: string) => {
        if (streamRenderTimerRef.current !== null) {
            window.clearTimeout(streamRenderTimerRef.current);
            streamRenderTimerRef.current = null;
        }
        rerenderIfActive(id);
    }, [rerenderIfActive]);

    const scheduleStreamRender = useCallback((id: string) => {
        if (activeCanvasRef.current !== id || streamRenderTimerRef.current !== null) return;
        streamRenderTimerRef.current = window.setTimeout(() => {
            streamRenderTimerRef.current = null;
            rerenderIfActive(id);
        }, 50);
    }, [rerenderIfActive]);

    useEffect(() => () => {
        if (streamRenderTimerRef.current !== null) window.clearTimeout(streamRenderTimerRef.current);
    }, []);

    const setOpen = useCallback((next: boolean) => {
        setOpenState(next);
        scopedLocalStorage.setItem(OPEN_STORAGE_KEY, next ? "1" : "0");
    }, []);

    const setWidth = useCallback((next: number) => {
        const clamped = clampAssistantWidth(next);
        setWidthState(clamped);
        scopedLocalStorage.setItem(WIDTH_STORAGE_KEY, String(clamped));
    }, []);

    // 状态只在面板打开时复查：关着的面板不该一直问后端。正在启动时节奏更快。
    const starting = status?.reason === "host_starting";
    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        const refresh = () => {
            getAgentHostStatus()
                .then((value) => { if (!cancelled) setStatus(value); })
                .catch(() => { if (!cancelled) setStatus({ available: false }); });
        };
        refresh();
        const timer = setInterval(refresh, starting ? 2000 : 15000);
        return () => { cancelled = true; clearInterval(timer); };
    }, [open, starting]);

    const loadHistory = useCallback(async (targetCanvas: string, sessionId?: string) => {
        const run = runFor(targetCanvas);
        const request = ++run.historyRequest;
        try {
            const [sessionList, history] = await Promise.all([
                listAssistantSessions(targetCanvas),
                getAssistantHistory(targetCanvas, sessionId),
            ]);
            if (request !== run.historyRequest) return false;
            const nextSession = sessionId || history.sessionId || sessionList.currentSessionId || null;
            const known = new Set(history.turns.map((turn) => turn.turnId));
            const recent = nextSession === run.sessionId ? run.turns.filter((turn) => !known.has(turn.turnId)) : [];
            const recovered = findRecoveredAssistantTurn(run.recovery, history);
            if (run.error && recovered) {
                run.pendingUserText = null;
                run.pendingSelectedNodeIds = [];
                run.pendingRequestedSkill = null;
                run.error = null;
                run.recovery = null;
            }
            if (recovered) {
                run.waitingForTurn = false;
                run.activeTurnId = null;
                run.recovery = null;
                run.pendingUserText = null;
                run.instructions = recovered.instructions || [];
                onCanvasChangedRef.current?.(targetCanvas, assistantChangedNodeIds(recovered.change));
            }
            if (history.activeTurn && !run.streaming) {
                run.dispatched = true;
                run.waitingForTurn = true;
                run.activeTurnId = history.activeTurn.turnId;
                run.pendingUserText = history.activeTurn.userText;
                run.pendingSelectedNodeIds = history.activeTurn.selectedNodeIds;
                run.instructions = history.activeTurn.instructions || [];
                run.recovery = { sessionId: history.sessionId, turnId: history.activeTurn.turnId,
                    knownTurnIds: history.turns.map(turn => turn.turnId), text: history.activeTurn.userText,
                    selectedNodeIds: history.activeTurn.selectedNodeIds };
            }
            if (!history.activeTurn && run.waitingForTurn && history.turns.some(turn => turn.turnId === run.activeTurnId)) {
                run.waitingForTurn = false;
                run.activeTurnId = null;
                run.pendingUserText = null;
                run.error = null;
            }
            if ('activeTurn' in history && !history.activeTurn && !run.streaming) {
                run.waitingForTurn = false;
                run.activeTurnId = null;
            }
            run.sessions = sessionList.sessions;
            run.sessionId = nextSession;
            run.turns = [...history.turns, ...recent];
            for (const turn of history.turns) {
                if (turn.undone) run.turnStatus[turn.turnId] = { undone: true };
            }
            run.historyLoaded = true;
            run.historyError = null;
            return true;
        } catch {
            if (request === run.historyRequest) run.historyError = "没能读取对话，已有内容仍然保留。请重新读取。";
            return false;
        } finally {
            rerenderIfActive(targetCanvas);
        }
    }, [rerenderIfActive, runFor]);

    const waitingForTurn = runFor(canvasId).waitingForTurn;
    useEffect(() => {
        if (!open || !waitingForTurn) return;
        const timer = window.setInterval(() => { void loadHistory(canvasId); }, 2500);
        return () => window.clearInterval(timer);
    }, [open, waitingForTurn, canvasId, loadHistory]);

    // 打开面板或切画布时补齐这条画布的历史；已经载入过就不重复拉。
    useEffect(() => {
        if (!open) return;
        const run = runFor(canvasId);
        if (run.historyLoaded || run.streaming || run.sessionBusy) return;
        void loadHistory(canvasId);
    }, [canvasId, loadHistory, open, runFor, status?.available]);

    const send = useCallback(async (text: string, selectedNodeIds: string[], references: AgentChatReference[] = [], selectedSkill?: AssistantSkillUse, images: AssistantImage[] = [], media: AssistantMedia[] = [], options:{continuationProposalId?:string}={}) => {
        const message = text.trim();
        if (!message) return;
        // 发送时冻结归属：此后即使用户切到别的画布，结果也只写回这条记录。
        const targetCanvas = activeCanvasRef.current;
        const selectedSnapshot = [...selectedNodeIds];
        const referenceSnapshot = references.map((reference) => ({ ...reference }));
        const skillSelection = selectedSkill ? { ...selectedSkill } : undefined;
        const run = runFor(targetCanvas);
        if (run.streaming || run.waitingForTurn || run.sessionBusy) return;
        run.activeTurnId = null;
        run.instructions = [];
        run.instructionError = null;
        const controller = new AbortController();
        run.pendingUserText = message;
        run.pendingSelectedNodeIds = selectedSnapshot;
        run.pendingRequestedSkill = skillSelection ?? null;
        run.streamed = "";
        run.toolActivity = [];
        run.streaming = true;
        run.lifecycleNotice = null;
        run.controller = controller;
        run.error = null;
        run.dispatched = false;
        run.recovery = null;
        run.lastSent = { text: message, selectedNodeIds: selectedSnapshot, references: referenceSnapshot, selectedSkill: skillSelection, images, media, continuationProposalId:options.continuationProposalId };
        rerenderIfActive(targetCanvas);
        try {
            const workspaceContext = await workspaceContextRef.current?.();
            if (workspaceCapabilities().local) {
                await flushModelConfig();
                const persistence = getModelConfigPersistenceState();
                if (persistence.dirty || persistence.status === "error") throw new Error("助手模型还没保存成功，请稍后重试");
            }
            controller.signal.throwIfAborted();
            const ready = await waitForAssistant(controller.signal);
            setStatus(ready);
            if (images.length && (!ready.model?.maxImages || images.length > ready.model.maxImages)) throw new Error('当前助手模型未开启图片输入，或图片数量超出模型限制。请在模型配置中开启图片引用，或切换支持视觉的模型。');
            if (images.some(image => image.data.length * 3 / 4 > (ready.model?.maxImageBytes || 0))) throw new Error('图片超过当前助手模型的输入大小限制，请缩小图片或调整模型配置。');
            if (!run.historyLoaded && !await loadHistory(targetCanvas)) throw new Error("对话还没读回来，请重新读取后再发送");
            controller.signal.throwIfAborted();
            run.recovery = { sessionId: run.sessionId, knownTurnIds: run.turns.map((turn) => turn.turnId), text: message, selectedNodeIds: selectedSnapshot };
            run.dispatched = true;
            await streamAgentChat(targetCanvas, message, {
                onInstruction: (instruction) => {
                    run.instructions = [...run.instructions.filter(item => item.instructionId !== instruction.instructionId), instruction];
                    rerenderIfActive(targetCanvas);
                },
                onTurnStart: (start) => {
                    run.activeTurnId = start.turnId;
                    run.sessionId = start.sessionId;
                    if (run.recovery) { run.recovery.sessionId = start.sessionId; run.recovery.turnId = start.turnId; }
                    rerenderIfActive(targetCanvas);
                },
                onTool: (event) => {
                    const current = runFor(targetCanvas);
                    const next = updateToolActivity(current.toolActivity, event);
                    if (next !== current.toolActivity) {
                        current.toolActivity = next;
                        scheduleStreamRender(targetCanvas);
                    }
                },
                onDelta: (delta) => {
                    const current = runFor(targetCanvas);
                    current.streamed += delta;
                    scheduleStreamRender(targetCanvas);
                },
                onLifecycle: (event) => {
                    const current = runFor(targetCanvas);
                    current.lifecycleNotice = assistantLifecycleText(event);
                    rerenderIfActive(targetCanvas);
                },
                onTurnEnd: (end) => {
                    flushStreamRender(targetCanvas);
                    const current = runFor(targetCanvas);
                    const turn: AssistantTurn = {
                        media: end.media || media.map(({ content: _content, ...metadata }) => metadata),
                        images: end.images || images.map(({ data: _data, ...metadata }) => metadata),
                        instructions: end.instructions || [],
                        turnId: end.turnId || `${targetCanvas}:${Date.now()}`,
                        userText: message,
                        selectedNodeIds: selectedSnapshot,
                        reply: end.reply || current.streamed,
                        toolCalls: end.toolCalls || [],
                        toolActivity: settleToolActivity(end.toolActivity ?? current.toolActivity),
                        change: end.change ?? null,
                        proposals: end.proposals || [],
                        workflows: end.workflows || [],
                        references: referenceSnapshot,
                        skillsUsed: end.skillsUsed || [],
                        requestedSkill: end.requestedSkill,
                        error: end.error ? agentAssistantFailureText(end.errorReason ?? undefined, "这一轮没有全部完成，请核对已经落地的改动。") : null,
                        errorReason: end.errorReason,
                        cancelled: Boolean(end.cancelled),
                        createdAt: new Date().toISOString(),
                    };
                    current.turns = [...current.turns, turn];
                    current.recovery = null;
                    current.activeTurnId = null;
                    current.waitingForTurn = false;
                    current.instructions = end.instructions || [];
                    current.historyError = null;
                    current.pendingUserText = null;
                    current.pendingSelectedNodeIds = [];
                    current.pendingRequestedSkill = null;
                    current.streamed = "";
                    current.toolActivity = [];
                    current.lifecycleNotice = null;
                    onCanvasChangedRef.current?.(targetCanvas, assistantChangedNodeIds(turn.change));
                    rerenderIfActive(targetCanvas);
                },
            }, { signal: controller.signal, selectedNodeIds: selectedSnapshot, references: referenceSnapshot, sessionId: run.sessionId ?? undefined, workspaceContext, selectedSkillId: skillSelection?.id, images, media,continuationProposalId:options.continuationProposalId });
        } catch (streamError) {
            flushStreamRender(targetCanvas);
            if (streamError instanceof AgentTurnFailedError) {
                // onTurnEnd 已保存真实失败及画布变化，不再额外显示「结果未知」或触发重放。
                runFor(targetCanvas).error = null;
                rerenderIfActive(targetCanvas);
                return true;
            }
            // 用户点「停止」会以 AbortError 结束这次请求：这是预期结果，不当成失败。
            const aborted = streamError instanceof DOMException && streamError.name === "AbortError";
            const current = runFor(targetCanvas);
            if (streamError instanceof AgentChatNotAdmittedError) {
                current.dispatched = false;
                current.recovery = null;
            }
            // 失败时保留用户刚发的那句话，错误卡片就贴在它下面；主动停止才收起。
            if (aborted) {
                current.pendingUserText = null;
                current.pendingSelectedNodeIds = [];
                current.pendingRequestedSkill = null;
            }
            current.streamed = "";
            current.toolActivity = settleToolActivity(current.toolActivity);
            current.lifecycleNotice = null;
            current.error = aborted ? null : current.dispatched
                ? "回复连接中断，正在核对执行记录。已完成的改动会保留，请不要重复提交生成。"
                : streamError instanceof Error ? streamError.message : String(streamError);
            if (current.dispatched) {
                current.waitingForTurn = Boolean(current.recovery);
                onCanvasChangedRef.current?.(targetCanvas, []);
                void loadHistory(targetCanvas);
            }
            rerenderIfActive(targetCanvas);
        } finally {
            flushStreamRender(targetCanvas);
            const current = runFor(targetCanvas);
            current.streaming = false;
            current.lifecycleNotice = null;
            current.controller = null;
            rerenderIfActive(targetCanvas);
            void listAssistantSessions(targetCanvas).then((list) => {
                const latest = runFor(targetCanvas);
                latest.sessions = list.sessions;
                if (!latest.sessionId) latest.sessionId = list.currentSessionId;
                rerenderIfActive(targetCanvas);
            }).catch(() => { /* 会话列表读取失败不覆盖本轮结果；重新读取入口仍可用。 */ });
        }
        return run.dispatched;
    }, [flushStreamRender, loadHistory, rerenderIfActive, runFor, scheduleStreamRender]);

    // 停止只作用于当前正在查看的画布，不会取消别的画布。
    const stop = useCallback(async () => {
        const targetCanvas = activeCanvasRef.current;
        const run = runFor(targetCanvas);
        if (!run.dispatched) { run.controller?.abort(); return; }
        try {
            await cancelAgentChat(targetCanvas);
            run.controller?.abort();
            run.waitingForTurn = Boolean(run.recovery || run.activeTurnId);
            void loadHistory(targetCanvas);
        } catch (cancelError) {
            run.error = cancelError instanceof Error ? cancelError.message : String(cancelError);
            rerenderIfActive(targetCanvas);
        }
    }, [loadHistory, rerenderIfActive, runFor]);

    const supplement = useCallback(async (text: string) => {
        const targetCanvas = activeCanvasRef.current;
        const run = runFor(targetCanvas);
        if (!run.activeTurnId || !run.sessionId || run.instructionBusy) return false;
        run.instructionBusy = true;
        run.instructionError = null;
        rerenderIfActive(targetCanvas);
        try {
            const pending = run.pendingInstruction?.turnId === run.activeTurnId && run.pendingInstruction.message === text
                ? run.pendingInstruction : { instructionId: crypto.randomUUID(), turnId: run.activeTurnId, message: text };
            run.pendingInstruction = pending;
            const instruction = await steerAgentChat(targetCanvas, run.sessionId, pending.turnId, text, pending.instructionId);
            const observed = run.instructions.find(item => item.instructionId === instruction.instructionId);
            run.instructions = [...run.instructions.filter(item => item.instructionId !== instruction.instructionId), observed?.state === 'received' ? observed : instruction];
            if (instruction.state === 'failed') throw new Error('instruction_failed');
            run.pendingInstruction = null;
            return true;
        } catch {
            run.instructionError = '补充要求未能确认送达，请重新读取对话后核对；这条文字仍保留在输入框。';
            return false;
        } finally {
            run.instructionBusy = false;
            rerenderIfActive(targetCanvas);
        }
    }, [rerenderIfActive, runFor]);

    const retryLast = useCallback(() => {
        const run = runFor(activeCanvasRef.current);
        if (!run.lastSent || run.dispatched) return;
        void send(run.lastSent.text, run.lastSent.selectedNodeIds, run.lastSent.references, run.lastSent.selectedSkill, run.lastSent.images, run.lastSent.media,{continuationProposalId:run.lastSent.continuationProposalId});
    }, [runFor, send]);

    const dismissError = useCallback(() => {
        const run = runFor(activeCanvasRef.current);
        run.error = null;
        run.pendingUserText = null;
        run.pendingSelectedNodeIds = [];
        run.pendingRequestedSkill = null;
        rerenderIfActive(activeCanvasRef.current);
    }, [rerenderIfActive, runFor]);

    const startNewSession = useCallback(async () => {
        const targetCanvas = activeCanvasRef.current;
        const run = runFor(targetCanvas);
        if (run.streaming || run.waitingForTurn || run.sessionBusy) return;
        run.sessionBusy = true;
        ++run.historyRequest;
        rerenderIfActive(targetCanvas);
        try {
            const sessionId = await createAssistantSession(targetCanvas);
            run.sessionId = sessionId;
            run.recovery = null;
            run.turns = [];
            run.toolActivity = [];
            run.error = null;
            run.pendingUserText = null;
            run.lastSent = null;
            run.turnStatus = {};
            run.historyLoaded = true;
            run.historyError = null;
            void loadHistory(targetCanvas);
        } catch {
            run.error = "没能新建对话，当前对话仍然保留。请重试。";
        } finally {
            run.sessionBusy = false;
            rerenderIfActive(targetCanvas);
        }
    }, [loadHistory, rerenderIfActive, runFor]);

    const activateSession = useCallback(async (sessionId: string) => {
        const targetCanvas = activeCanvasRef.current;
        const run = runFor(targetCanvas);
        if (run.streaming || run.waitingForTurn || run.sessionBusy) return;
        run.sessionBusy = true;
        ++run.historyRequest;
        rerenderIfActive(targetCanvas);
        try {
            const activated = await activateAssistantSession(targetCanvas, sessionId);
            if (!activated) return;
            // 激活成功但读取失败时阻止把旧显示当作新对话继续发送。
            run.historyLoaded = false;
            if (await loadHistory(targetCanvas, activated)) {
                run.recovery = null;
                run.turnStatus = {};
                run.error = null;
                run.lastSent = null;
                run.pendingUserText = null;
                run.toolActivity = [];
            }
        } catch {
            run.error = "没能切换对话，当前对话仍然保留。请重试。";
        } finally {
            run.sessionBusy = false;
            rerenderIfActive(targetCanvas);
        }
    }, [loadHistory, rerenderIfActive, runFor]);

    const undoTurn = useCallback(async (turnId: string) => {
        const targetCanvas = activeCanvasRef.current;
        const run = runFor(targetCanvas);
        run.turnStatus = { ...run.turnStatus, [turnId]: { undoing: true } };
        rerenderIfActive(targetCanvas);
        const result = await undoAssistantTurn(turnId, targetCanvas);
        const next = runFor(targetCanvas);
        next.turnStatus = { ...next.turnStatus, [turnId]: result.ok ? { undone: true } : { undoFailure: result.failure } };
        rerenderIfActive(targetCanvas);
        if (result.ok) onCanvasChangedRef.current?.(targetCanvas, []);
    }, [rerenderIfActive, runFor]);

    const restartHost = useCallback(async () => {
        setStatusBusy(true);
        try {
            await restartAgentHost();
            setStatus(await getAgentHostStatus());
        } catch {
            setStatus({ available: false, reason: "host_start_failed" });
        } finally {
            setStatusBusy(false);
        }
    }, []);

    const rememberProposal = useCallback((key: string) => {
        setHandledProposals((current) => {
            if (current.has(key)) return current;
            const next = new Set(current);
            next.add(key);
            const kept = [...next].slice(-PROPOSAL_MEMORY);
            scopedLocalStorage.setItem(PROPOSAL_STORAGE_KEY, JSON.stringify(kept));
            return new Set(kept);
        });
    }, []);
    const markProposalHandled = useCallback((proposalId: string) => rememberProposal(proposalId), [rememberProposal]);
    const markProposalDismissed = useCallback((proposalId: string) => rememberProposal(dismissedProposalKey(proposalId)), [rememberProposal]);

    const run = runsRef.current.get(canvasId) ?? createRun();

    return {
        projectId: canvasId,
        open,
        setOpen,
        width,
        setWidth,
        status,
        statusBusy,
        modelBusy: statusBusy || [...runsRef.current.values()].some((item) => item.streaming || item.waitingForTurn || item.sessionBusy),
        sessions: run.sessions,
        sessionId: run.sessionId,
        turns: run.turns,
        historyLoaded: run.historyLoaded,
        historyError: run.historyError,
        sessionBusy: run.sessionBusy,
        reloadHistory: () => loadHistory(canvasId),
        ensureSession: async () => { const current=runFor(canvasId);if(!current.historyLoaded && !await loadHistory(canvasId)) throw new Error('无法读取当前对话');if(!current.sessionId) await startNewSession();if(!current.sessionId) throw new Error('无法创建对话');return current.sessionId; },
        pendingUserText: run.pendingUserText,
        pendingSelectedNodeIds: run.pendingSelectedNodeIds,
        pendingRequestedSkill: run.pendingRequestedSkill,
        streamed: run.streamed,
        toolActivity: run.toolActivity,
        streaming: run.streaming || run.waitingForTurn,
        canSupplement: Boolean(run.activeTurnId) && !run.instructionBusy,
        instructions: run.instructions,
        instructionError: run.instructionError,
        supplement,
        lifecycleNotice: run.lifecycleNotice,
        error: run.error,
        canRetry: Boolean(run.lastSent) && !run.dispatched,
        turnStatus: run.turnStatus,
        handledProposals,
        markProposalHandled,
        markProposalDismissed,
        send,
        stop,
        retryLast,
        dismissError,
        startNewSession,
        activateSession,
        undoTurn,
        restartHost,
    };
}

export type CanvasAssistantController = ReturnType<typeof useCanvasAssistant>;

/**
 * 编辑器外壳够宽才做停靠栏；窄了改成覆盖式抽屉，不把画布挤到不能用。
 */
export function useCanvasAssistantDockable(shellRef: { current: HTMLElement | null }) {
    const desktop = Boolean(Grid.useBreakpoint().lg);
    const [wide, setWide] = useState(true);
    useEffect(() => {
        const element = shellRef.current;
        if (!element || typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver((entries) => {
            const box = entries[0]?.contentRect;
            if (box) setWide(box.width >= ASSISTANT_DOCK_MIN_SHELL_WIDTH);
        });
        observer.observe(element);
        setWide(element.clientWidth >= ASSISTANT_DOCK_MIN_SHELL_WIDTH);
        return () => observer.disconnect();
    }, [shellRef]);
    return desktop && wide;
}
