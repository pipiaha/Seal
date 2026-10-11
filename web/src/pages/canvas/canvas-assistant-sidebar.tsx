import { App, Button, Dropdown, Tooltip } from "antd";
import { History, MessageSquarePlus, X, Clapperboard, ArrowUpRight } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { WorkingDots } from "@/components/ai/working-indicator";
import { CanvasAssistantHistory } from "./canvas-assistant-history";
import { AssistantExecutionProcess } from './assistant-execution-process';
import { useAssistantMessageQueue, type QueuedAssistantMessage } from './use-assistant-message-queue';
import { AssistantMessageQueueView } from './assistant-message-queue-view';

import { AppDrawer } from "@/components/ui/product/app-drawer";
import { referencedAssetIdsInPrompt, buildAssetMentionReferences, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { useAssetStore } from '@/stores/use-asset-store';
import { assistantReferenceImages, prepareAssistantImage, ASSISTANT_IMAGE_LIMIT } from '@/services/assistant-images';
import type { AssistantImage, AssistantMedia } from '@/services/api/agent-assistant';
import { assistantFileKind, prepareAssistantMedia, assistantReferencedMedia } from '@/services/assistant-media';
import type { AssistantGenerationProposal } from "@/services/api/agent-assistant";
import { ASSISTANT_STARTER_PROMPTS, assistantStatusNotice } from "./canvas-assistant-copy";
import { CanvasAssistantComposer } from "./canvas-assistant-composer";
import { CanvasAssistantReply, CanvasAssistantUserMessage } from "./canvas-assistant-turn";
import { ASSISTANT_MAX_WIDTH, ASSISTANT_MIN_WIDTH, type CanvasAssistantController } from "./use-canvas-assistant";
import "./canvas-assistant-sidebar.css";
import { CreatorMediaTasks, useCreatorMediaActions } from './creator-media-tasks';
import { captureUserScope, assertUserScope } from '@/lib/user-scope-guard';
import { getMediaProposalTask } from '@/services/api/creator';
import type { AssistantTurn, AssistantWorkflow } from '@/services/api/agent-assistant';
import type { HubSkill } from '@/services/api/skill-hub';

type Props = {
    captureVisual?: (target: 'preview' | 'selection') => Promise<AssistantImage[]>;
    resolveVisualReferences?: (text: string) => Promise<AssistantImage[]>;
    assistant: CanvasAssistantController;
    canvasTitle: string;
    dockable: boolean;
    readOnly: boolean;
    selectedNodeIds: string[];
    references: CanvasResourceReference[];
    includeAssetLibrary?: boolean;
    workspaceLabel?: string;
    referencesLabel?: string;
    onLocateNodes: (nodeIds: string[]) => void;
    onRunProposal: (proposal: AssistantGenerationProposal) => void;
    onOpenModelSettings: () => void;
    proposalFeedback?: Record<string, string>;
    proposalActionLabel?: string;
    prefill?: { id: string; text: string };
};

export function CanvasAssistantSidebar(props: Props) {
    const { assistant, canvasTitle, dockable, readOnly, selectedNodeIds, references, onLocateNodes, onRunProposal, onOpenModelSettings } = props;
    const pendingUserQueue = useRef(false);
    const mediaActions = useCreatorMediaActions(assistant,readOnly,pendingUserQueue);
    const callbacksRef = useRef({ onLocateNodes, onRunProposal });
    callbacksRef.current = { onLocateNodes, onRunProposal };
    const locateNodes = useCallback((ids: string[]) => callbacksRef.current.onLocateNodes(ids), []);
    const { message } = App.useApp();
    const [scope] = useState(() => captureUserScope());
    const [resuming, setResuming] = useState(false);
    const resume = useCallback(async (workflow: AssistantWorkflow, turn: AssistantTurn) => {
        if (resuming || assistant.streaming || assistant.sessionBusy) return;
        setResuming(true);
        try {
            const assetIDs = new Set<string>();
            for (const step of workflow.steps) if (step.taskId && step.taskKind === 'generation') {
                const task = await getMediaProposalTask(assistant.projectId, step.taskId, scope);
                for (const output of task.outputs || []) if (output.materializedAssetId) assetIDs.add(output.materializedAssetId);
            }
            assertUserScope(scope);
            await assistant.send(`继续已保存的任务 ${workflow.id}：${workflow.goal}。先用 workflow_read 读取最新步骤，核对原任务、候选和文件摘要，复用现有结果，从未完成处继续；不要重复提交已受理的生成或重复加入轨道。`, [],
                [...(turn.references || []), ...[...assetIDs].map(id => ({ kind: 'asset' as const, id }))]);
        } catch (error) { message.error(error instanceof Error ? error.message : '继续任务失败'); }
        finally { setResuming(false); }
    }, [resuming, assistant.streaming, assistant.sessionBusy, assistant.projectId, assistant.send, scope, message]);
    const resumeWorkflow = useCallback((workflow: AssistantWorkflow, turn: AssistantTurn) => { void resume(workflow, turn); }, [resume]);
    const runProposal = useCallback((proposal: AssistantGenerationProposal) => {
        if (proposal.assetGeneration) void mediaActions.start(proposal); else callbacksRef.current.onRunProposal(proposal);
    }, [mediaActions.start]);
    const proposalFeedback = useMemo(() => ({ ...props.proposalFeedback, ...mediaActions.feedback }), [props.proposalFeedback, mediaActions.feedback]);
    const undoTurn = useCallback((turnId: string) => { void assistant.undoTurn(turnId); }, [assistant.undoTurn]);
    const [draft, setDraft] = useState("");
    const [images, setImages] = useState<AssistantImage[]>([]);
    const [media, setMedia] = useState<AssistantMedia[]>([]);
    const [imageBusy, setImageBusy] = useState(false);
    const preparingRef = useRef(false);
    const assets = useAssetStore(state => state.assets);
    const imageGeneration = useRef(0);
    const imageScope = useRef({ projectId: assistant.projectId, sessionId: assistant.sessionId });
    useEffect(() => {
        const previous = imageScope.current;
        if (previous.projectId !== assistant.projectId || previous.sessionId && previous.sessionId !== assistant.sessionId) {
            imageGeneration.current++; setImages([]); setMedia([]); setImageBusy(false); preparingRef.current = false;
        }
        imageScope.current = { projectId: assistant.projectId, sessionId: assistant.sessionId };
    }, [assistant.projectId, assistant.sessionId]);
    const addImages = async (load: () => Promise<AssistantImage[]>) => {
        if (imageBusy || preparingRef.current || assistant.streaming || assistant.modelBusy) return;
        const generation = imageGeneration.current;
        preparingRef.current = true; setImageBusy(true);
        try {
            const added = await load(); assertUserScope(scope);
            if (generation !== imageGeneration.current) return;
            if (images.length + added.length > ASSISTANT_IMAGE_LIMIT) throw new Error('一次消息最多带 8 张图片');
            setImages(current => [...current, ...added]);
        } catch (error) { if (generation === imageGeneration.current) message.error(error instanceof Error ? error.message : '读取图片失败'); }
        finally { if (generation === imageGeneration.current) { preparingRef.current = false; setImageBusy(false); } }
    };
    const addFiles = async (files: File[]) => {
        if (imageBusy || preparingRef.current || assistant.streaming || assistant.modelBusy || !files.length) return;
        if (files.some(file => !assistantFileKind(file))) { message.error('支持图片、MP4/WebM 视频、MP3/WAV/OGG/M4A 音频，以及 TXT/MD/JSON/CSV/SRT/VTT 文字文件'); return; }
        if (files.filter(file => assistantFileKind(file) === 'image').length + images.length > 8 || files.filter(file => assistantFileKind(file) !== 'image').length + media.length > 8) { message.error('一条消息最多带 8 张图片和 8 个其他附件'); return; }
        const generation = imageGeneration.current; preparingRef.current = true; setImageBusy(true);
        try {
            for (const file of files) {
                if (generation !== imageGeneration.current) return;
                if (assistantFileKind(file) === 'image') {
                    const image = await prepareAssistantImage(file, file.name); assertUserScope(scope);
                    if (generation === imageGeneration.current) setImages(current => [...current, image]);
                } else {
                    const attachment = await prepareAssistantMedia(file, scope); assertUserScope(scope);
                    if (generation === imageGeneration.current) setMedia(current => [...current, attachment]);
                }
            }
        } catch (error) { message.error(error instanceof Error ? error.message : '准备附件失败，已完成的附件会保留'); }
        finally { if (generation === imageGeneration.current) { preparingRef.current = false; setImageBusy(false); } }
    };
    const [selectedSkill, setSelectedSkill] = useState<HubSkill | null>(null);
    useEffect(() => { setSelectedSkill(null); }, [assistant.projectId]);
    useEffect(() => { if (props.prefill) setDraft(props.prefill.text); }, [props.prefill]);
    const [selectionAttached, setSelectionAttached] = useState(true);
    const logRef = useRef<HTMLDivElement | null>(null);
    const logContentRef = useRef<HTMLDivElement | null>(null);
    const sidebarRef = useRef<HTMLDivElement | null>(null);
    const followLatestRef = useRef(true);
    const [showLatest, setShowLatest] = useState(false);
    useLayoutEffect(() => {
        followLatestRef.current = true;
        setShowLatest(false);
    }, [assistant.projectId, assistant.sessionId]);
    useEffect(() => {
        const content = logContentRef.current;
        if (!content) return;
        let frame = 0;
        const observer = new ResizeObserver(() => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                const log = logRef.current;
                if (log && followLatestRef.current) log.scrollTop = log.scrollHeight;
            });
        });
        observer.observe(content);
        return () => { observer.disconnect(); cancelAnimationFrame(frame); };
    }, [dockable, assistant.open]);

    // 新的一条选择又可以被带上：用户移除只对当前这条消息生效。
    useEffect(() => {
        setSelectionAttached(true);
    }, [selectedNodeIds.join(",")]);

    const turnCount = assistant.turns.length;
    useLayoutEffect(() => {
        const node = logRef.current;
        if (node && followLatestRef.current) node.scrollTop = node.scrollHeight;
    }, [turnCount, assistant.streamed, assistant.pendingUserText, assistant.lifecycleNotice, assistant.toolActivity, assistant.execution, proposalFeedback]);

    const notice = assistant.status && !assistant.status.available && assistant.status.reason !== "host_starting" ? assistantStatusNotice(assistant.status.reason) : null;
    const composerDisabled = readOnly;
    const composerReason = readOnly ? "这个画布是只读的，不能让助手改动。" : undefined;
    const attachedIds = selectionAttached ? selectedNodeIds : [];

    const dispatchMessage = useCallback(async (text: string, nodeIds: string[], options: { queued?: boolean; onAdmitted?: () => void } = {}) => {
        if (!text || readOnly || assistant.streaming || assistant.sessionBusy || preparingRef.current) return false;
        const queued = Boolean(options.queued);
        const attachedImages = queued ? [] : images;
        const attachedMedia = queued ? [] : media;
        const requestedSkill = queued ? undefined : selectedSkill ?? undefined;
        // @ 引用到的素材库素材由界面按用户原文推导后交给后端校验归属：
        // 模型不能自己声明要读哪些素材。
        const assetReferences = [...new Set([...referencedAssetIdsInPrompt(text), ...attachedMedia.flatMap(item => item.assetId ? [item.assetId] : [])])]
            .map((id) => ({ kind: "asset" as const, id }));
        const generation = imageGeneration.current;
        preparingRef.current = true; setImageBusy(true);
            try {
                const available = [...references, ...(props.includeAssetLibrary !== false ? buildAssetMentionReferences(assets) : [])];
                const mediaReferences = [...new Map([...attachedMedia, ...assistantReferencedMedia(text, nodeIds, available)].map(item => [item.assetId || item.nodeId || item.id, item])).values()];
                if (mediaReferences.length > 8) throw new Error('附件和音视频引用合计最多 8 项，请减少引用或选区');
                const referenced = await assistantReferenceImages(text, assistant.status?.model?.maxImages ? nodeIds : [], available, assistant.projectId);
                const editing = await props.resolveVisualReferences?.(text) || [];
                assertUserScope(scope);
                if (generation !== imageGeneration.current) return false;
                const visual = [...attachedImages, ...referenced, ...editing];
                if (visual.length > ASSISTANT_IMAGE_LIMIT) throw new Error('附件和引用合计最多 8 张图片，请减少引用或取消部分选区');
                await mediaActions.resume();
                assertUserScope(scope);
                if (generation !== imageGeneration.current) return false;
                followLatestRef.current = true;
                if (!queued) { setDraft(''); setImages([]); setMedia([]); setSelectedSkill(null); }
                preparingRef.current = false; setImageBusy(false);
                const allAssetReferences = [...new Map([...assetReferences, ...mediaReferences.flatMap(item => item.assetId ? [{ kind: 'asset' as const, id: item.assetId }] : [])].map(item => [item.id, item])).values()];
                const admitted = await assistant.send(text, nodeIds, allAssetReferences, requestedSkill, visual, mediaReferences, { onAdmitted: options.onAdmitted });
                if (admitted === false && !queued && generation === imageGeneration.current) { setImages(images); setMedia(media); setDraft(current => current || draft); setSelectedSkill(current => current || selectedSkill); }
                return admitted === true;
            } catch (error) { message.error(error instanceof Error ? error.message : '读取引用图片失败'); return false; }
            finally { if (generation === imageGeneration.current) { preparingRef.current = false; setImageBusy(false); } }
    }, [assistant, draft, readOnly, selectedSkill, images, media, references, assets, props.includeAssetLibrary, props.resolveVisualReferences, scope, message, mediaActions.resume]);
    const submitQueued = useCallback((item: QueuedAssistantMessage, onAdmitted: () => void) => dispatchMessage(item.text, item.selectedNodeIds, { queued: true, onAdmitted }), [dispatchMessage]);
    const queued = useAssistantMessageQueue({ assistant, submit: submitQueued, disabled: readOnly || !assistant.open, busy: imageBusy || Boolean(images.length || media.length || selectedSkill) });
    pendingUserQueue.current = Boolean(queued.messages.length || queued.busyId);
    useEffect(() => { mediaActions.notifyUserQueueChanged(); }, [queued.messages.length, queued.busyId, mediaActions.notifyUserQueueChanged]);
    const [queueSaving, setQueueSaving] = useState(false);
    const send = useCallback(() => {
        const text = draft.trim() || (images.length || media.length ? '请分析这些附件。' : '');
        if (!text || readOnly || assistant.sessionBusy || imageBusy || queueSaving || preparingRef.current) return;
        if (assistant.streaming || queued.messages.length) {
            if (selectedSkill || images.length || media.length) { message.info('排队消息支持文字和素材引用；附件与技能请在当前轮结束后发送。'); return; }
            setQueueSaving(true);
            void queued.enqueue(text, attachedIds).then(() => setDraft(current => current === draft ? '' : current))
                .catch(error => message.error(error instanceof Error ? error.message : '排队失败，消息仍保留在输入框'))
                .finally(() => setQueueSaving(false));
            return;
        }
        if (queued.paused) void queued.resume().then(() => dispatchMessage(text, attachedIds)).catch(error => message.error(error instanceof Error ? error.message : '发送失败'));
        else void dispatchMessage(text, attachedIds);
    }, [assistant.streaming, assistant.sessionBusy, queued, queueSaving, draft, images, media, selectedSkill, readOnly, imageBusy, attachedIds, message, dispatchMessage]);

    const startResize = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = sidebarRef.current?.getBoundingClientRect().width ?? assistant.width;
        const move = (moveEvent: PointerEvent) => assistant.setWidth(startWidth + (startX - moveEvent.clientX));
        const done = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", done);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", done);
    }, [assistant]);

    const sessionItems = assistant.sessions.length
        ? assistant.sessions.map((session) => ({
              key: session.sessionId,
              label: session.title || "还没有内容的对话",
              onClick: () => void assistant.activateSession(session.sessionId),
          }))
        : [{ key: "empty", label: "还没有别的对话", disabled: true }];

    const content = (
        <div className="canvas-assistant-panel" data-canvas-no-zoom>
            <header className="canvas-assistant-header">
                <div className="canvas-assistant-heading"><h2>创作助手</h2><span title={canvasTitle}>{canvasTitle}</span></div>
                <Tooltip title="新对话">
                    <Button type="text" size="small" aria-label="新对话" disabled={assistant.streaming || assistant.sessionBusy} icon={<MessageSquarePlus className="size-4" />} onClick={() => void assistant.startNewSession()} />
                </Tooltip>
                <Dropdown trigger={["click"]} placement="bottomRight" menu={{ items: sessionItems, selectedKeys: assistant.sessionId ? [assistant.sessionId] : [] }}>
                    <Button type="text" size="small" aria-label="历史对话" disabled={assistant.streaming || assistant.sessionBusy} icon={<History className="size-4" />} />
                </Dropdown>
                <Tooltip title="关闭助手">
                    <Button type="text" size="small" aria-label="关闭助手" icon={<X className="size-4" />} onClick={() => assistant.setOpen(false)} />
                </Tooltip>
            </header>

            {notice ? (
                <div className="canvas-assistant-notice" role="status">
                    <span>{notice.text}</span>
                    {notice.action === "model-settings" ? (
                        <Button size="small" onClick={onOpenModelSettings}>{notice.actionLabel}</Button>
                    ) : notice.action === "retry" ? (
                        <Button size="small" loading={assistant.statusBusy} onClick={() => void assistant.restartHost()}>{notice.actionLabel}</Button>
                    ) : null}
                </div>
            ) : null}

            <div ref={logRef} className="canvas-assistant-log" tabIndex={0} aria-label="对话记录" onScroll={() => {
                const node = logRef.current;
                if (node) {
                    followLatestRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
                    setShowLatest(!followLatestRef.current);
                }
            }}>
                <div ref={logContentRef} className="canvas-assistant-log-content">
                {assistant.historyError ? <div className="canvas-assistant-notice" role="status"><span>{assistant.historyError}</span><Button size="small" onClick={() => void assistant.reloadHistory()}>重新读取</Button></div> : !assistant.historyLoaded ? <p className="canvas-assistant-meta" role="status">正在读取对话…</p> : null}
                {assistant.historyLoaded && turnCount === 0 && !assistant.pendingUserText ? (
                    <div className="canvas-assistant-empty">
                        <Clapperboard className="canvas-assistant-empty-icon" aria-hidden="true" />
                        <h3>让想法成为画面</h3>
                        <p>从一句灵感开始，一起完善这张画布。</p>
                        {ASSISTANT_STARTER_PROMPTS.map((prompt) => (
                            <button key={prompt} type="button" className="canvas-assistant-starter" onClick={() => setDraft(prompt)}>
                                <span>{prompt}</span><ArrowUpRight size={14} aria-hidden="true" />
                            </button>
                        ))}
                    </div>
                ) : null}

                    <CanvasAssistantHistory
                        turns={assistant.turns}
                        turnStatus={assistant.turnStatus}
                        logRef={logRef}
                        projectId={assistant.projectId}
                        resumeDisabled={resuming || assistant.streaming || assistant.sessionBusy || readOnly}
                        onResumeWorkflow={resumeWorkflow}
                        handledProposals={assistant.handledProposals}
                        proposalFeedback={proposalFeedback}
                        onLocate={locateNodes}
                          onUndo={undoTurn}
                        onRunProposal={runProposal}
                        proposalActionLabel={props.proposalActionLabel}
                        onDismissProposal={assistant.markProposalDismissed}
                    />
                <CreatorMediaTasks assistant={assistant} readOnly={readOnly} items={mediaActions.items} onOutcome={mediaActions.onOutcome} onReject={proposal=>void mediaActions.reject(proposal).catch(error=>message.error(error instanceof Error?error.message:'拒绝失败'))} onStart={proposal => void mediaActions.start(proposal)} feedback={mediaActions.feedback} />

                {assistant.pendingUserText ? (
                    <div className="canvas-assistant-turn">
                        <CanvasAssistantUserMessage text={assistant.pendingUserText} selectedCount={assistant.pendingSelectedNodeIds.length} requestedSkill={assistant.pendingRequestedSkill} />
                        {assistant.instructions?.map(item => <p className="canvas-assistant-meta" key={item.instructionId}>补充要求：{item.message} · {item.state === 'received' ? '已交给助手' : item.state === 'queued' ? '等待当前步骤结束' : '尚未处理'}</p>)}
                        <AssistantExecutionProcess execution={assistant.execution} items={assistant.toolActivity} live />
                        {assistant.streamed && !assistant.execution.some(item => item.kind === 'message') ? <CanvasAssistantReply text={assistant.streamed} isStreaming={assistant.streaming} /> : null}
                        {assistant.streaming && !assistant.toolActivity.some(item => item.status === 'running') ? (
                            <p className="canvas-assistant-meta canvas-assistant-working" role="status"><WorkingDots dotSize={3} /><span>{assistant.lifecycleNotice || (assistant.streamed ? "助手正在回复…" : "助手正在处理…")}</span></p>
                        ) : null}
                    </div>
                ) : null}

                {assistant.error ? (
                    <div className="canvas-assistant-card">
                        <span className="canvas-assistant-failed">{assistant.error}</span>
                        <div className="canvas-assistant-card-actions">
                            {assistant.canRetry ? <Button size="small" onClick={assistant.retryLast}>重试</Button> : null}
                            {!assistant.canRetry && !assistant.historyError ? <Button size="small" onClick={() => void assistant.reloadHistory()}>重新读取</Button> : null}
                            <Button size="small" type="text" onClick={assistant.dismissError}>知道了</Button>
                        </div>
                    </div>
                ) : null}
                </div>
            </div>
            {showLatest ? <Button className="canvas-assistant-latest" size="small" onClick={() => {
                followLatestRef.current = true;
                setShowLatest(false);
                const log = logRef.current;
                if (log) log.scrollTop = log.scrollHeight;
            }}>回到最新消息</Button> : null}

            {assistant.instructionError ? <p className="canvas-assistant-failed" role="status">{assistant.instructionError}</p> : null}
            {mediaActions.permissionError ? <p className="canvas-assistant-failed" role="status">{mediaActions.permissionError}</p>:null}
            {images.length > 0 && assistant.status?.model?.maxImages === 0 ? <div className="canvas-assistant-notice" role="status"><span>当前助手模型未开启图片输入。</span><Button size="small" onClick={onOpenModelSettings}>配置视觉模型</Button></div> : null}
            <AssistantMessageQueueView queue={queued} streaming={assistant.streaming} canGuide={assistant.canSupplement} disabled={readOnly} onCheck={() => void assistant.reloadHistory()} />
            <CanvasAssistantComposer
                permissionMode={mediaActions.mode} permissionBusy={mediaActions.permissionBusy} mediaBusy={mediaActions.pending}
                onPermissionModeChange={mode=>void mediaActions.changeMode(mode).catch(error=>message.error(error instanceof Error?error.message:'切换权限失败'))}
                images={images} imageBusy={imageBusy || queueSaving}
                media={media} onRemoveMedia={id => setMedia(current => current.filter(item => item.id !== id))}
                onAddFiles={files => void addFiles(files)}
                onRemoveImage={id => setImages(current => current.filter(image => image.id !== id))}
                onCapturePreview={props.captureVisual ? () => void addImages(() => props.captureVisual!('preview')) : undefined}
                onCaptureSelection={props.captureVisual ? () => void addImages(() => props.captureVisual!('selection')) : undefined}
                value={draft}
                onChange={setDraft}
                onSend={send}
                onStop={() => { if (queued.loaded) void queued.pause().catch(() => {}); void mediaActions.stop().catch(error=>message.error(error instanceof Error?error.message:'停止制作失败')); }}
                streaming={assistant.streaming}
                canSupplement={Boolean(assistant.sessionId) && queued.loaded && !queueSaving}
                disabled={composerDisabled}
                disabledReason={composerReason}
                references={references}
                includeAssetLibrary={props.includeAssetLibrary}
                workspaceLabel={props.workspaceLabel}
                referencesLabel={props.referencesLabel}
                selectedCount={selectedNodeIds.length}
                selectionAttached={selectionAttached}
                onDetachSelection={() => setSelectionAttached(false)}
                modelBusy={assistant.modelBusy}
                selectedSkill={selectedSkill}
                onSelectSkill={setSelectedSkill}
            />
        </div>
    );

    if (!dockable) {
        return (
            <AppDrawer
                flush
                open={assistant.open}
                placement="right"
                title={null}
                closable={false}
                onClose={() => assistant.setOpen(false)}
                size="min(380px, 92vw)"
                aria-label="助手"
            >
                {content}
            </AppDrawer>
        );
    }

    return (
        <aside ref={sidebarRef} className="canvas-assistant-sidebar" aria-label="助手" style={{ width: assistant.width, flexBasis: assistant.width }}>
            <button
                type="button"
                className="canvas-assistant-resize"
                aria-label="调整助手宽度"
                onPointerDown={startResize}
                onKeyDown={(event) => {
                    if (event.key === "ArrowLeft") assistant.setWidth(Math.min(ASSISTANT_MAX_WIDTH, assistant.width + 16));
                    if (event.key === "ArrowRight") assistant.setWidth(Math.max(ASSISTANT_MIN_WIDTH, assistant.width - 16));
                }}
            />
            {content}
        </aside>
    );
}
