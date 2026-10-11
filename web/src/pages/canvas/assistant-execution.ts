import type { AssistantExecutionEntry } from '@/services/api/agent-assistant';

export function updateExecutionMessage(entries: AssistantExecutionEntry[], id: string, text: string, append = false): AssistantExecutionEntry[] {
    const index = entries.findIndex(item => item.kind === 'message' && item.id === id);
    const previous = entries[index];
    const message: AssistantExecutionEntry = { kind: 'message', id, text: append && previous?.kind === 'message' ? previous.text + text : text };
    return index < 0 ? [...entries, message] : entries.map((item, i) => i === index ? message : item);
}

export function appendExecutionTool(entries: AssistantExecutionEntry[], toolCallId: string): AssistantExecutionEntry[] {
    return entries.some(item => item.kind === 'tool' && item.toolCallId === toolCallId) ? entries : [...entries, { kind: 'tool', toolCallId }];
}

export function assistantElapsedLabel(totalMs?: number): string {
    if (totalMs === undefined || !Number.isFinite(totalMs) || totalMs < 0) return '查看过程';
    if (totalMs < 1000) return '用时不足 1 秒';
    const seconds = Math.ceil(totalMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    return `用时 ${hours ? `${hours} 小时 ` : ''}${minutes % 60 ? `${minutes % 60} 分 ` : ''}${seconds % 60 || !minutes ? `${seconds % 60} 秒` : ''}`.trim();
}
