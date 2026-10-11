import { BookOpen, ChevronRight } from 'lucide-react';
import { memo, useState } from 'react';
import type { AssistantExecutionEntry, AssistantSkillUse, AssistantToolActivity } from '@/services/api/agent-assistant';
import { AssistantToolActivityView } from './assistant-tool-activity-view';
import { assistantElapsedLabel } from './assistant-execution';
import { CanvasAssistantReply } from './canvas-assistant-reply';

type Props = {
    execution?: AssistantExecutionEntry[];
    items: AssistantToolActivity[];
    skills?: AssistantSkillUse[];
    finalMessageId?: string | null;
    totalMs?: number;
    live?: boolean;
};

export const AssistantExecutionProcess = memo(function AssistantExecutionProcess({ execution = [], items, skills = [], finalMessageId, totalMs, live = false }: Props) {
    const [expanded, setExpanded] = useState(false);
    const byId = new Map(items.map(item => [item.toolCallId, item]));
    const blocks: Array<{ kind: 'message'; id: string; text: string } | { kind: 'tools'; id: string; items: AssistantToolActivity[] }> = [];
    const included = new Set<string>();
    for (const entry of execution) {
        if (entry.kind === 'message') {
            if (entry.id !== finalMessageId && entry.text.trim()) blocks.push(entry);
        } else {
            const item = byId.get(entry.toolCallId);
            if (!item || included.has(item.toolCallId)) continue;
            included.add(item.toolCallId);
            const previous = blocks.at(-1);
            if (previous?.kind === 'tools') previous.items.push(item);
            else blocks.push({ kind: 'tools', id: item.toolCallId, items: [item] });
        }
    }
    const remaining = items.filter(item => !included.has(item.toolCallId));
    if (remaining.length) blocks.push({ kind: 'tools', id: remaining[0].toolCallId, items: remaining });
    if (!blocks.length && !skills.length && totalMs === undefined) return null;

    const content = <div className="canvas-assistant-execution-body">
        {skills.length ? <div className="canvas-assistant-used-skills">{skills.map(skill => <span key={skill.id} title={`版本 ${skill.version}`}><BookOpen size={13} aria-hidden />{skill.displayName || skill.name}</span>)}</div> : null}
        {blocks.map((block, index) => block.kind === 'message'
            ? <CanvasAssistantReply key={block.id} text={block.text} isStreaming={live && index === blocks.length - 1} />
            : <AssistantToolActivityView key={block.id} items={block.items} />)}
        {!blocks.length ? <span className="canvas-assistant-meta">本轮未调用工具。</span> : null}
    </div>;
    return live ? <div className="canvas-assistant-execution-live">{content}</div> : <details className="canvas-assistant-execution" onToggle={event => setExpanded(event.currentTarget.open)}>
        <summary aria-label={`${assistantElapsedLabel(totalMs)}，展开或收起执行过程`}><span>{assistantElapsedLabel(totalMs)}</span><ChevronRight size={13} aria-hidden /></summary>
        {expanded ? content : null}
    </details>;
});
