import { App, Button } from "antd";
import { Copy, Crosshair, Undo2 } from "lucide-react";
import { memo } from "react";
import { GenerationToolCard } from "@/components/ai/generation-tool-card";
import { AssistantExecutionProcess } from './assistant-execution-process';
import { CanvasAssistantReply } from './canvas-assistant-reply';
export { CanvasAssistantReply } from './canvas-assistant-reply';

import { agentAssistantFailureText, type AssistantGenerationProposal, type AssistantTurn, type AssistantWorkflow, type AssistantSkillUse, type AssistantImageInfo, type AssistantMedia } from "@/services/api/agent-assistant";
import { CreatorWorkflow } from './creator-workflow';
import { assistantChangeSummary, assistantChangedNodeIds, assistantProposalText, assistantUndoFailureText, assistantVisibleReply } from "./canvas-assistant-copy";
import { dismissedProposalKey, type AssistantTurnStatus } from "./use-canvas-assistant";

export type AssistantTurnViewProps = {
    projectId?: string;
    resumeDisabled?: boolean;
    onResumeWorkflow?: (workflow: AssistantWorkflow, turn: AssistantTurn) => void;
    turn: AssistantTurn;
    status?: AssistantTurnStatus;
    handledProposals: Set<string>;
    proposalFeedback?: Record<string, string>;
    onLocate: (nodeIds: string[]) => void;
    onUndo: (turnId: string) => void;
    onRunProposal: (proposal: AssistantGenerationProposal) => void;
    onDismissProposal: (proposalId: string) => void;
    proposalActionLabel?: string;
};

export function CanvasAssistantUserMessage({ text, selectedCount, requestedSkill, images = [], media = [] }: { text: string; selectedCount: number; requestedSkill?: AssistantSkillUse | null; images?: AssistantImageInfo[]; media?: AssistantMedia[] }) {
    return (
        <div className="canvas-assistant-user">
            <span style={{ whiteSpace: "pre-wrap" }}>{text}</span>
            {images.length ? <span className="canvas-assistant-meta">已附 {images.length} 张图片：{images.map(image => image.name).join('、')}</span> : null}
            {media.length ? <span className="canvas-assistant-meta">已附文件：{media.map(file => file.name).join('、')}</span> : null}
            {requestedSkill ? <span className="canvas-assistant-meta">指定技能：{requestedSkill.displayName || requestedSkill.name}</span> : null}
            {selectedCount > 0 ? <span className="canvas-assistant-meta">带上了已选的 {selectedCount} 个节点</span> : null}
        </div>
    );
}

export const CanvasAssistantTurnView = memo(function CanvasAssistantTurnView({ turn, status, handledProposals, proposalFeedback, onLocate, onUndo, onRunProposal, onDismissProposal, projectId, onResumeWorkflow, resumeDisabled, proposalActionLabel = '生成' }: AssistantTurnViewProps) {
    const summary = assistantChangeSummary(turn.change);
    const changedNodeIds = assistantChangedNodeIds(turn.change);
    const undone = Boolean(status?.undone);
    const { message } = App.useApp();
    const activity = turn.toolActivity?.length ? turn.toolActivity : (turn.toolCalls || []).map((call, index) => ({ toolCallId: call.toolCallId || `legacy-${index}`, tool: call.tool, status: call.isError ? 'error' as const : 'completed' as const }));

    return (
        <div className="canvas-assistant-turn">
            <CanvasAssistantUserMessage text={turn.userText} selectedCount={turn.selectedNodeIds?.length ?? 0} requestedSkill={turn.requestedSkill} images={turn.images} media={turn.media} />
            {turn.instructions?.map(item => <p className="canvas-assistant-meta" key={item.instructionId}>补充要求：{item.message} · {item.state === 'received' ? '已交给助手' : '未处理，可在下一条消息中继续'}</p>)}
            <AssistantExecutionProcess execution={turn.execution} finalMessageId={turn.finalMessageId} items={activity} skills={turn.skillsUsed} totalMs={turn.metrics?.totalMs} />
            {turn.reply ? <CanvasAssistantReply text={turn.reply} /> : null}
            {!assistantVisibleReply(turn.reply) && !turn.error && !turn.cancelled ? <p className="canvas-assistant-meta">本轮没有生成文字摘要，可展开过程查看执行结果。</p> : null}
            {turn.cancelled ? <p className="canvas-assistant-meta">这一条已经停下了。</p> : null}
            {projectId && onResumeWorkflow ? turn.workflows?.map(workflow => <CreatorWorkflow key={workflow.id} workflow={workflow} projectId={projectId} disabled={Boolean(resumeDisabled)} onResume={() => onResumeWorkflow(workflow, turn)} />) : null}
            {turn.error ? <p className="canvas-assistant-failed" role="status">{agentAssistantFailureText(turn.errorReason ?? undefined, "这一轮没有全部完成，请核对已经落地的改动。")}</p> : null}
            {summary ? (
                <div className="canvas-assistant-change">
                    <strong>{summary}</strong>
                    {undone ? (
                        <span className="canvas-assistant-meta">已撤销</span>
                    ) : (
                        <>
                            <div className="canvas-assistant-card-actions">
                                {changedNodeIds.length > 0 ? (
                                    <Button type="text" size="small" icon={<Crosshair className="size-3.5" />} onClick={() => onLocate(changedNodeIds)}>
                                        在画布上查看
                                    </Button>
                                ) : null}
                                <Button type="text" size="small" icon={<Undo2 className="size-3.5" />} loading={status?.undoing} onClick={() => onUndo(turn.turnId)}>
                                    撤销这一轮
                                </Button>
                            </div>
                            {status?.undoFailure ? <span className="canvas-assistant-meta">{assistantUndoFailureText(status.undoFailure)}</span> : null}
                        </>
                    )}
                </div>
            ) : null}

            {(turn.proposals || []).map((proposal) => {
                const started = handledProposals.has(proposal.proposalId);
                const skipped = handledProposals.has(dismissedProposalKey(proposal.proposalId));
                return (
                    <div key={proposal.proposalId} className="canvas-assistant-card">
                        <GenerationToolCard status={started ? "running" : skipped ? "cancelled" : "ready"} heading={<strong>{proposal.kind === "image" ? "生成图片" : proposal.kind === "video" ? "生成视频" : "生成配音"}</strong>}>
                        <span style={{ whiteSpace: "pre-line", overflowWrap: "anywhere" }}>{assistantProposalText(proposal)}</span>
                        {!skipped && proposalFeedback?.[proposal.proposalId] ? <span className="canvas-assistant-meta" role="status">{proposalFeedback[proposal.proposalId]}</span> : null}
                        {started ? (
                            <span className="canvas-assistant-meta">已开始生成</span>
                        ) : skipped ? (
                            <span className="canvas-assistant-meta">这次没有生成</span>
                        ) : (
                            <div className="canvas-assistant-card-actions">
                                <Button size="small" type="primary" autoInsertSpace={false} onClick={() => onRunProposal(proposal)}>{proposal.assetGeneration ? '确认并生成' : proposalActionLabel}</Button>
                                <Button size="small" onClick={() => onDismissProposal(proposal.proposalId)}>先不用</Button>
                            </div>
                        )}
                        </GenerationToolCard>
                    </div>
                );
            })}
            {assistantVisibleReply(turn.reply) ? <div className="canvas-assistant-reply-actions"><button type="button" aria-label="复制回复" title="复制回复" onClick={() => {
                void navigator.clipboard.writeText(assistantVisibleReply(turn.reply)).then(() => message.success('已复制')).catch(() => message.error('复制失败，请选中文字复制'));
            }}><Copy size={14} aria-hidden /></button></div> : null}
        </div>
    );
});
