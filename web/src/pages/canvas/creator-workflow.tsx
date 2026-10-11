import { useState } from 'react';
import { App, Button } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { captureUserScope, assertUserScope } from '@/lib/user-scope-guard';
import { getAsrTask, getMediaProposalTask } from '@/services/api/creator';
import { cancelGenerationTask } from '@/services/api/task-center';
import { ChevronRight } from 'lucide-react';
import type { AssistantWorkflow } from '@/services/api/agent-assistant';
import type { TimelineTranscriptionResult } from '@/services/api/timeline-tasks';

export function CreatorWorkflow({ workflow, projectId, disabled, onResume }: { workflow: AssistantWorkflow; projectId: string; disabled: boolean; onResume: () => void }) {
    return <div className="canvas-assistant-workflow">
        <details className="canvas-assistant-execution">
        <summary><span>{workflow.title} · {workflow.steps.filter(step => step.state === 'done').length}/{workflow.steps.length} 步已记录</span><ChevronRight size={13} aria-hidden /></summary>
        <div className="canvas-assistant-execution-body">
        <p className="canvas-assistant-meta">任务状态以运行端结果为准。</p>
        <ul className="space-y-3">
            {workflow.steps.map(step => <li key={step.id}>
                <span>{step.label} · {step.state === 'done' ? '已记录完成' : step.state === 'waiting' ? '等待结果' : '待处理'}</span>
                {step.note ? <p className="canvas-assistant-meta">{step.note}</p> : null}
                {step.candidateId ? <p className="canvas-assistant-meta">候选结果：{step.candidateId}</p> : null}
            </li>)}
        </ul>
        </div>
        </details>
        {workflow.steps.filter(step => step.taskId && step.taskKind).map(step => <div key={step.id}><span className="canvas-assistant-meta">{step.label}</span><WorkflowTaskState projectId={projectId} taskId={step.taskId!} kind={step.taskKind!} /></div>)}
        <Button type="text" size="small" disabled={disabled} onClick={onResume}>{workflow.steps.every(step => step.state === 'done') ? '继续调整' : '从现有结果继续'}</Button>
    </div>;
}

function WorkflowTaskState({ projectId, taskId, kind }: { projectId: string; taskId: string; kind: 'asr' | 'generation' }) {
    const [scope] = useState(() => captureUserScope());
    const { message } = App.useApp();
    const [cancelling, setCancelling] = useState(false);
    const task = useQuery<{ status: string; stage?: string; progress?: number; error?: string; resultJson?: string }>({ queryKey: ['workflow-task', scope.userScope, scope.epoch, projectId, taskId],
        queryFn: async ({ signal }) => kind === 'asr' ? await getAsrTask(projectId, taskId, scope, signal) : await getMediaProposalTask(projectId, taskId, scope, signal),
        refetchInterval: query => !query.state.data || ['queued', 'running'].includes(query.state.data.status) ? 3000 : false });
    const data = task.data;
    let transcript: TimelineTranscriptionResult | null = null;
    if (kind === 'asr' && data?.status === 'succeeded' && data.resultJson) try { transcript = JSON.parse(data.resultJson) as TimelineTranscriptionResult; } catch { /* The task status remains visible if an older result cannot be decoded. */ }
    async function cancel() {
        setCancelling(true);
        try { assertUserScope(scope); await cancelGenerationTask(taskId); assertUserScope(scope); await task.refetch(); }
        catch (error) { message.error(error instanceof Error ? error.message : '取消失败'); } finally { setCancelling(false); }
    }
    return <div className="canvas-assistant-meta">
        <p role="status">{task.isError ? task.error.message : data ? `${data.stage || data.status} · ${data.progress || 0}%` : '读取实际任务状态…'}</p>
        {data?.error ? <p role="alert">{data.error}</p> : null}
        {data && ['queued', 'running'].includes(data.status) ? <Button size="small" loading={cancelling} onClick={() => void cancel()}>取消任务</Button> : null}
        {transcript?.segments?.length ? <details><summary>识别结果 · {transcript.segments.length} 段 · {transcript.timingLevel === 'token' ? '近似 token 时间戳' : '句段时间戳'}</summary>
            {transcript.segments.map((segment, index) => <p key={index}>{(segment.startMs / 1000).toFixed(2)}–{(segment.endMs / 1000).toFixed(2)} 秒：{segment.text}</p>)}
        </details> : null}
        {task.isError ? <Button size="small" onClick={() => void task.refetch()}>重新读取</Button> : null}
    </div>;
}
