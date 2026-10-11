import { expect, test } from "bun:test";
import { settleToolActivity, toolActivityLabel, updateToolActivity } from "../src/pages/canvas/assistant-tool-activity";
import type { AgentToolEvent } from "../src/services/api/agent-assistant";

test("parallel tool events keep completion order independent, coalesce updates, and reject late starts", () => {
    const event = (toolCallId: string, phase: AgentToolEvent['phase'], isError = false): AgentToolEvent => ({ type: 'tool', toolCallId, tool: 'edit_read', phase, isError });
    let items = updateToolActivity([], event('first', 'start'));
    items = updateToolActivity(items, event('second', 'update'));
    expect(items[1].updated).toBe(true);
    expect(updateToolActivity(items, event('second', 'update'))).toBe(items);
    items = updateToolActivity(items, event('second', 'end', true));
    expect(updateToolActivity(items, event('second', 'start'))).toBe(items);
    expect(settleToolActivity(items).map(item => item.status)).toEqual(['interrupted', 'error']);
    expect(items[0].status).toBe('running');
    items = updateToolActivity(items, event('first', 'end'));
    expect(items.map(item => item.status)).toEqual(['completed', 'error']);
});

test("tool labels describe actual work and keep unknown internal names out of the UI", () => {
    expect(toolActivityLabel('hyperframes_context')).toBe('读取剪辑工程');
    expect(toolActivityLabel('hyperframes_export')).toBe('提交视频导出');
    expect(toolActivityLabel('unknown_tool_123')).toBe('执行操作');
});

test('tool details retain input across updates and receive the actual final output', () => {
    const start: AgentToolEvent = { type: 'tool', phase: 'start', toolCallId: 'detail', tool: 'read', detail: { input: 'skills/hyperframes/SKILL.md' } };
    const initial = updateToolActivity([], start);
    const updated = updateToolActivity(initial, { ...start, phase: 'update', detail: { output: '读取中' } });
    const end = updateToolActivity(updated, { ...start, phase: 'end', detail: { output: '当前工程 1080×1920' } });
    expect(end[0].detail).toEqual({ input: 'skills/hyperframes/SKILL.md', output: '当前工程 1080×1920' });
    expect(updateToolActivity(end, start)).toBe(end);
});
