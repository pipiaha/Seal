import { describe, expect, test } from 'bun:test';
import { createTurnObserver, mapSessionEvent } from './lifecycle-events.mjs';

describe('官方会话事件映射', () => {
  test('执行详情沿真实事件保存读取目标与结果，同时过滤凭据和媒体数据', () => {
    const observer = createTurnObserver();
    const start = observer.handle({ type: 'tool_execution_start', toolCallId: 'details', toolName: 'read', args: { path: 'skills/hyperframes/SKILL.md', apiKey: 'credential-fixture' } });
    expect(start.detail.input).toContain('skills/hyperframes/SKILL.md');
    expect(start.detail.input).not.toContain('credential-fixture');
    const end = observer.handle({ type: 'tool_execution_end', toolCallId: 'details', toolName: 'read', result: { content: [
      { type: 'text', text: '当前工程 1080×1920，30fps。 Authorization: Bearer credential-fixture' },
      { type: 'image', data: 'private-base64', mimeType: 'image/png' },
    ] }, isError: false });
    expect(end.detail.output).toContain('1080×1920');
    expect(end.detail.output).not.toContain('credential-fixture');
    expect(JSON.stringify(end)).not.toContain('private-base64');
    expect(observer.toolActivity[0].detail).toEqual({ ...start.detail, ...end.detail });
  });
  test('详情限长、敏感文件不展示内容、结果 JSON 和签名网址过滤凭据', () => {
    const observer = createTurnObserver();
    observer.handle({ type: 'tool_execution_start', toolCallId: 'sensitive', toolName: 'read', args: { path: 'C:/project/.env' } });
    const hidden = observer.handle({ type: 'tool_execution_end', toolCallId: 'sensitive', toolName: 'read', result: { content: [{ type: 'text', text: 'unlabelled-secret' }] } });
    expect(hidden.detail.output).not.toContain('unlabelled-secret');
    const value = mapSessionEvent({ type: 'tool_execution_end', toolCallId: 'json', toolName: 'workspace_run', result: { content: [{ type: 'text', text: JSON.stringify({ stdout: 'finished', apiKey: 'json-secret', url: 'https://example.com/out?token=url-secret', long: 'x'.repeat(9000) }) }] } });
    expect(value.detail.output).toContain('finished');
    expect(value.detail.output).not.toMatch(/json-secret|url-secret/);
    expect(value.detail.output.length).toBeLessThan(6100);
    expect(value.detail.truncated).toBe(true);
  });
  test('实时工具事件只包含身份与状态，不转发参数或结果', () => {
    for (const [type, phase] of [['tool_execution_start', 'start'], ['tool_execution_update', 'update'], ['tool_execution_end', 'end']]) {
      const event = { type, toolCallId: 'call-1', toolName: 'edit_read', isError: true,
        args: { apiKey: 'secret' }, result: { path: 'C:/private' }, partialResult: 'private-result' };
      expect(mapSessionEvent(event)).toEqual({ type: 'tool', phase, toolCallId: 'call-1', tool: 'edit_read', ...(phase === 'end' ? { isError: true } : {}) });
    }
    expect(mapSessionEvent({ type: 'tool_execution_start', toolName: 'read' })).toBeNull();
    expect(mapSessionEvent({ type: 'tool_execution_start', toolCallId: 'a', toolName: 'C:/private' })).toBeNull();
  });

  test('并行调用独立结算，重复更新合并，未结束调用保存为未确认', () => {
    const observer = createTurnObserver();
    const tool = (id, phase, isError = false) => ({ type: `tool_execution_${phase}`, toolCallId: id, toolName: 'edit_read', isError });
    observer.handle(tool('one', 'start'));
    observer.handle(tool('two', 'start'));
    expect(observer.activeToolActivity.map(item => item.status)).toEqual(['running', 'running']);
    expect(observer.handle(tool('one', 'update')).phase).toBe('update');
    expect(observer.handle(tool('one', 'update'))).toBeNull();
    observer.handle(tool('two', 'end', true));
    observer.handle(tool('two', 'start'));
    expect(observer.toolActivity).toEqual([
      { toolCallId: 'one', tool: 'edit_read', status: 'interrupted', updated: true },
      { toolCallId: 'two', tool: 'edit_read', status: 'error' },
    ]);
    observer.handle(tool('one', 'end'));
    expect(observer.toolActivity[0].status).toBe('completed');
  });
  test('只转发 text_delta 与有用的压缩/重试生命周期，不把 agent_end 当成回合结束', () => {
    expect(mapSessionEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: '雨夜' },
    })).toEqual({ type: 'text_delta', delta: '雨夜' });
    expect(mapSessionEvent({ type: 'compaction_start', reason: 'threshold' }))
      .toEqual({ type: 'lifecycle', phase: 'compaction', reason: 'threshold' });
    expect(mapSessionEvent({ type: 'compaction_end', reason: 'threshold', aborted: false, willRetry: true }))
      .toEqual({ type: 'lifecycle', phase: 'compaction_end', reason: 'threshold', aborted: false, willRetry: true });
    expect(mapSessionEvent({ type: 'auto_retry_start', attempt: 1, maxAttempts: 3 }))
      .toEqual({ type: 'lifecycle', phase: 'retry', attempt: 1, maxAttempts: 3 });
    expect(mapSessionEvent({ type: 'auto_retry_end', success: false, attempt: 1 }))
      .toEqual({ type: 'lifecycle', phase: 'retry_end', success: false, attempt: 1 });
    expect(mapSessionEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_delta', delta: 'draft' },
    })).toBeNull();
    expect(mapSessionEvent({ type: 'agent_end', messages: [], willRetry: false })).toBeNull();
    expect(mapSessionEvent({ type: 'agent_end', messages: [], willRetry: true })).toBeNull();
    expect(mapSessionEvent({ type: 'agent_settled' })).toBeNull();
    expect(mapSessionEvent({ type: 'turn_end' })).toBeNull();
  });

  test('observer 用 message_end 与 agent_settled，不把 willRetry 的 agent_end 当成终态', () => {
    const observer = createTurnObserver();
    expect(observer.handle({ type: 'agent_end', messages: [], willRetry: true })).toBeNull();
    expect(observer.settled).toBe(false);
    const assistant = { role: 'assistant', content: [{ type: 'text', text: '整理后的回复' }], stopReason: 'stop' };
    expect(observer.handle({ type: 'message_end', message: assistant })).toEqual({ type: 'assistant_message', messageId: 'message-1', text: '整理后的回复' });
    expect(observer.lastAssistantMessage).toEqual(assistant);
    expect(observer.handle({ type: 'agent_settled' })).toBeNull();
    expect(observer.settled).toBe(true);
    expect(observer.lastAgentEnd.willRetry).toBe(true);
  });

  test('正文与并行工具保留开始顺序，最终摘要独立标识，不转发思考和工具参数', () => {
    const observer = createTurnObserver();
    const text = value => observer.handle({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: value } });
    text('先读取'); text('工程。');
    observer.handle({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: '先读取工程。' }, { type: 'thinking', thinking: 'private' }], stopReason: 'toolUse' } });
    observer.handle({ type: 'tool_execution_start', toolName: 'edit_read', toolCallId: 'read', args: { key: 'secret' } });
    observer.handle({ type: 'tool_execution_start', toolName: 'hyperframes_inspect', toolCallId: 'inspect' });
    observer.handle({ type: 'tool_execution_end', toolName: 'edit_read', toolCallId: 'read' });
    observer.beginRun();
    expect(text('已完成。')).toEqual({ type: 'text_delta', messageId: 'message-2', delta: '已完成。' });
    observer.handle({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: '已完成。' }], stopReason: 'stop' } });
    expect(observer.execution).toEqual([
      { kind: 'message', id: 'message-1', text: '先读取工程。' },
      { kind: 'tool', toolCallId: 'read' }, { kind: 'tool', toolCallId: 'inspect' },
      { kind: 'message', id: 'message-2', text: '已完成。' },
    ]);
    expect(observer.finalMessageId).toBe('message-2');
    expect(observer.toolActivity[1].status).toBe('interrupted');
  });
});
