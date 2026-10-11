// 把官方 AgentSession 事件收成宿主 NDJSON。
// agent_end 只表示一次底层 run 结束，仍可能自动重试/压缩恢复；终态用 agent_settled + message_end + prompt 错误。
const toolPhases = new Map([['tool_execution_start', 'start'], ['tool_execution_update', 'update'], ['tool_execution_end', 'end']]);
import { toolDisplay } from './tool-display.mjs';

export function mapSessionEvent(event, previousInput = '') {
  if (!event || typeof event !== 'object') return null;
  const phase = toolPhases.get(event.type);
  if (phase) {
    // 展示详情经过过滤和限长；完整参数、媒体数据及凭据不进入进度事件。
    if (typeof event.toolCallId !== 'string' || !event.toolCallId || event.toolCallId.length > 256 ||
        typeof event.toolName !== 'string' || !/^[\w.:-]{1,128}$/.test(event.toolName)) return null;
    const detail = toolDisplay(event, previousInput);
    return { type: 'tool', phase, toolCallId: event.toolCallId, tool: event.toolName,
      ...(detail ? { detail } : {}),
      ...(phase === 'end' ? { isError: event.isError === true } : {}) };
  }
  if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
    return { type: 'text_delta', delta: event.assistantMessageEvent.delta };
  }
  if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'thinking_start') {
    return { type: 'lifecycle', phase: 'thinking' };
  }
  if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'thinking_end') {
    return { type: 'lifecycle', phase: 'thinking_end' };
  }
  if (event.type === 'compaction_start') {
    return { type: 'lifecycle', phase: 'compaction', reason: event.reason };
  }
  if (event.type === 'compaction_end') {
    return { type: 'lifecycle', phase: 'compaction_end', reason: event.reason, aborted: Boolean(event.aborted), willRetry: Boolean(event.willRetry) };
  }
  if (event.type === 'auto_retry_start') {
    return { type: 'lifecycle', phase: 'retry', attempt: event.attempt, maxAttempts: event.maxAttempts };
  }
  if (event.type === 'auto_retry_end') {
    return { type: 'lifecycle', phase: 'retry_end', success: Boolean(event.success), attempt: event.attempt };
  }
  return null;
}

export function createTurnObserver() {
  let lastAssistantMessage = null;
  let settled = false;
  let lastAgentEnd = null;
  const activities = new Map();
  const execution = [];
  let currentMessage = null;
  let finalMessageId = null;
  let messageCount = 0;
  let lifecycle = null;
  const ensureMessage = () => {
    if (!currentMessage) {
      currentMessage = { kind: 'message', id: `message-${++messageCount}`, text: '' };
      execution.push(currentMessage);
    }
    return currentMessage;
  };
  return {
    // 只保存可见正文与工具身份；不保存模型思考、工具参数或工具结果。
    get execution() { return execution.map(item => ({ ...item })); },
    get finalMessageId() { return finalMessageId; },
    get lifecycle() { return lifecycle ? { ...lifecycle } : null; },
    get activeToolActivity() { return [...activities.values()].map(item => ({ ...item })); },
    // 未收到结束事件的工具不能冒充成功，包括取消、断流和宿主异常。
    get toolActivity() { return [...activities.values()].map(item => ({ ...item, status: item.status === 'running' ? 'interrupted' : item.status })); },
    get lastAssistantMessage() { return lastAssistantMessage; },
    get settled() { return settled; },
    get lastAgentEnd() { return lastAgentEnd; },
    beginRun() { settled = false; lastAssistantMessage = null; lastAgentEnd = null; currentMessage = null; finalMessageId = null; },
    handle(event) {
      if (event?.type === 'message_start' && event.message?.role === 'assistant') {
        currentMessage = null;
        finalMessageId = null;
        return null;
      }
      if (event?.type === 'message_end' && event.message?.role === 'assistant') {
        lifecycle = null;
        lastAssistantMessage = event.message;
        finalMessageId = null;
        const text = (event.message.content || []).filter(item => item.type === 'text').map(item => item.text).join('');
        if (text || currentMessage) {
          const message = ensureMessage();
          message.text = text;
          finalMessageId = text ? message.id : null;
          currentMessage = null;
          return { type: 'assistant_message', messageId: message.id, text };
        }
        return null;
      }
      if (event?.type === 'agent_settled') {
        settled = true;
        return null;
      }
      if (event?.type === 'agent_end') {
        lastAgentEnd = event;
        return null;
      }
      const previousTool = activities.get(event?.toolCallId);
      if (event?.type === 'tool_execution_update' && (previousTool?.updated || previousTool && previousTool.status !== 'running')) return null;
      const payload = mapSessionEvent(event, previousTool?.detail?.input);
      if (payload?.type === 'text_delta') {
        lifecycle = null;
        const message = ensureMessage();
        message.text += payload.delta;
        return { ...payload, messageId: message.id };
      }
      if (payload?.type === 'tool') {
        lifecycle = null;
        const previous = activities.get(payload.toolCallId);
        if (!previous) execution.push({ kind: 'tool', toolCallId: payload.toolCallId });
        if (payload.phase === 'update' && (previous?.updated || previous && previous.status !== 'running')) return null;
        if (!previous || previous.status === 'running') activities.set(payload.toolCallId, {
          toolCallId: payload.toolCallId, tool: previous?.tool || payload.tool,
          status: payload.phase === 'end' ? (payload.isError ? 'error' : 'completed') : 'running',
          ...(previous?.detail || payload.detail ? { detail: { ...previous?.detail, ...payload.detail } } : {}),
          ...(payload.phase === 'update' || previous?.updated ? { updated: true } : {}),
        });
      }
      if (payload?.type === 'lifecycle') lifecycle = ['thinking', 'compaction', 'retry'].includes(payload.phase) ? payload : null;
      return payload;
    },
  };
}
