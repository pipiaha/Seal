import { useEffect, useRef, useState } from "react";
import { Button, Select } from "antd";
import { getAsrRuntimeStatus, type AsrRuntimeStatus } from "@/services/api/creator";
import { captureUserScope, isUserScopeAbandonedError } from "@/lib/user-scope-guard";
import { attachLocalExecutorResult, beginLocalExecutorSession, isLocalExecutorSessionStop, localExecutorFrozenInputKey, localExecutorIntentAfterError, localExecutorIntentAfterSubmit, nextLocalExecutorClientOperationId, runOwnedTimelineTranscription, type LocalExecutorIntentState } from "@/lib/plugins/builtin/editor/local-executor-session";
import type { SrtEntry } from "@/types/timeline";

export function CanvasTranscriptionControls({ projectId, nodeId, resourceId, disabled, onResult, onRunningChange }: {
    projectId: string;
    nodeId: string;
    resourceId: string | null;
    disabled: boolean;
    onResult: (entries: SrtEntry[]) => void;
    onRunningChange: (running: boolean) => void;
}) {
    const [models, setModels] = useState<Array<{ value: string; label: string }>>([]);
    const [model, setModel] = useState<"" | "local" | "service">("");
    const [runtime, setRuntime] = useState<AsrRuntimeStatus | null>(null);
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState("");
    const [running, setRunning] = useState(false);
    const requestRef = useRef(0);
    const controllerRef = useRef<AbortController | null>(null);
    const intentRef = useRef<LocalExecutorIntentState | null>(null);
    const busyRef = useRef(false);
    const mountedRef = useRef(true);
    const projectRef = useRef(projectId);
    projectRef.current = projectId;
    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; requestRef.current++; controllerRef.current?.abort(); onRunningChange(false); };
    }, [onRunningChange]);

    const refresh = async () => {
        const request = ++requestRef.current;
        setLoading(true); setModels([]); setModel(""); setStatus("");
        try {
            const result = await getAsrRuntimeStatus(captureUserScope());
            if (!mountedRef.current || request !== requestRef.current) return;
            setRuntime(result);
            setModels([
                ...(result.localReady ? [{ value: "local", label: "本地 Whisper Base" }] : []),
                ...(result.serviceReady ? [{ value: "service", label: `在线识别 · ${result.settings.model}` }] : []),
            ]);
            if (!result.localReady && !result.serviceReady) setStatus("识别服务未就绪，请先在模型配置中设置 ASR");
        } catch (error) {
            if (mountedRef.current && request === requestRef.current && !isUserScopeAbandonedError(error)) setStatus(error instanceof Error ? error.message : "读取转写模型失败");
        } finally {
            if (mountedRef.current && request === requestRef.current) setLoading(false);
        }
    };

    useEffect(() => { void refresh(); }, []);

    const transcribe = async () => {
        if (!resourceId || busyRef.current || disabled || loading) return;
        busyRef.current = true; setRunning(true); onRunningChange(true); setStatus("排队中…");
        const controller = new AbortController();
        controllerRef.current = controller;
        const session = beginLocalExecutorSession(projectId, { controller, getLiveProjectId: () => projectRef.current });
        const frozenInputKey = localExecutorFrozenInputKey([projectId, nodeId, resourceId, model, runtime?.settings.language, runtime?.settings.revision]);
        const clientOperationId = nextLocalExecutorClientOperationId(intentRef.current, frozenInputKey);
        const intent = { clientOperationId, frozenInputKey };
        intentRef.current = intent;
        try {
            const { task, result } = await runOwnedTimelineTranscription({
                session, resourceId, projectId, route: model || undefined, language: runtime?.settings.language, clientOperationId,
                onCreated: task => { intentRef.current = localExecutorIntentAfterSubmit(clientOperationId, task, intent); },
                onTaskUpdate: task => { if (mountedRef.current) setStatus(task.stage || "正在转写…"); },
            });
            intentRef.current = localExecutorIntentAfterSubmit(clientOperationId, task, intent);
            await attachLocalExecutorResult(session, () => {
                const entries = result.segments.filter(segment => segment.text.trim() && segment.endMs > segment.startMs)
                    .map((segment, index) => ({ ...segment, index: index + 1 }));
                if (!entries.length) { setStatus("没有识别出可用字幕"); return; }
                onResult(entries);
                setStatus(`已识别 ${entries.length} 条字幕，可编辑后保存或导出 SRT`);
            });
        } catch (error) {
            intentRef.current = localExecutorIntentAfterError(intentRef.current || intent, error);
            if (mountedRef.current && !isLocalExecutorSessionStop(error)) setStatus(error instanceof Error ? error.message : "转写失败");
        } finally {
            busyRef.current = false;
            if (mountedRef.current) { setRunning(false); onRunningChange(false); }
        }
    };

    return <div className="flex flex-col gap-2 border-b px-4 py-3" style={{ borderColor: "var(--workspace-border)" }}>
        <div className="flex flex-wrap items-center gap-2">
            <Select aria-label="转写模型" size="small" className="min-w-[200px] flex-1" value={model} onChange={setModel} disabled={disabled || running || loading}
                options={[{ value: "", label: "使用默认 ASR 配置" }, ...models]} />
            <Button size="small" disabled={disabled || running} loading={loading} onClick={() => void refresh()}>刷新识别服务</Button>
            <Button size="small" disabled={disabled || !resourceId || loading} loading={running} onClick={() => void transcribe()}>自动转写字幕</Button>
        </div>
        <p className="text-xs opacity-60">{!resourceId ? "素材上传完成后即可自动转写。" : (model || runtime?.defaultRoute) === "service" ? "使用已配置的在线 ASR 服务，可能产生调用用量；识别后替换当前字幕草稿。" : "使用内置 Whisper Base 离线识别；识别后替换当前字幕草稿。"}</p>
        {status && <p role="status" className="text-xs">{status}</p>}
        {running && <p className="text-xs opacity-60">关闭窗口后，转写任务仍会继续，可在任务中心查看。</p>}
    </div>;
}
