// 一轮对话的画布影响与付费生成提议：从成功的工具结果里当场累计，
// 而不是把工具结果正文留在日志里（画布读取结果很大，也没必要外发）。
//
// 供应商定义同样放在这里：协议决定用哪个 pi-ai 适配器，宿主不再假设一切都是
// OpenAI 兼容接口，地址形状由后端按协议整理好后下发。

export const SUPPORTED_APIS = ['openai-completions', 'openai-responses', 'anthropic-messages'];
import { workflowHistory } from './workflow-journal.mjs';
import { TOOL_CHECKPOINT_TYPE } from './turn-context.mjs';
import { turnInstructions } from './turn-instructions.mjs';
import { createTurnObserver } from './lifecycle-events.mjs';

export function newTurnAccumulator() {
  return { turnId: '', seq: 0, toolSeq: 0, revisionBefore: 0, revisionAfter: 0,
    createdNodeIds: [], updatedNodeIds: [], createdEdgeIds: [], operationIds: [], proposals: [] };
}

export function resetTurnAccumulator(turn, revisionBefore, turnId = '') {
  turn.seq += 1;
  turn.toolSeq = 0;
  turn.turnId = String(turnId || '');
  turn.revisionBefore = Number(revisionBefore || 0);
  turn.revisionAfter = 0;
  turn.createdNodeIds.length = 0;
  turn.updatedNodeIds.length = 0;
  turn.createdEdgeIds.length = 0;
  turn.operationIds.length = 0;
  turn.proposals.length = 0;
  return turn;
}

function asStringList(value) {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

export function collectTurnEffects(turn, opID, result, operationId) {
  if (!turn || !result || typeof result !== 'object') return turn;
  if (typeof result.revision === 'number' && result.revision > turn.revisionAfter) {
    turn.revisionAfter = result.revision;
    if (operationId) turn.operationIds.push(String(operationId));
  }
  switch (opID) {
    case 'canvas.nodes.create':
      for (const node of Array.isArray(result.created) ? result.created : []) {
        if (node && node.id) turn.createdNodeIds.push(String(node.id));
      }
      break;
    case 'canvas.node.update':
    case 'canvas.task.bind':
      if (result.nodeId) turn.updatedNodeIds.push(String(result.nodeId));
      break;
    case 'canvas.edge.create':
      // 重复连线会幂等返回（没有新增），这时不能算作本轮新建了连线。
      if (result.created && result.edgeId) turn.createdEdgeIds.push(String(result.edgeId));
      break;
    case 'canvas.generation.propose':
      if (result.proposalId) {
        turn.proposals.push({ proposalId: String(result.proposalId), kind: String(result.kind || ''),
          nodeIds: asStringList(result.nodeIds), model: String(result.model || ''),
          modelKey: String(result.modelKey || ''), note: String(result.note || ''),
          ...(result.source ? { source: { canvasId: result.source.canvasId,
            canvasRevision: result.source.canvasRevision, modelConfigRevision: result.source.modelConfigRevision } } : {}) });
      }
      break;
    default:
      break;
  }
  return turn;
}

// 刚创建、官方会话文件还没落盘的当前会话，历史应是空对话，而不是 404。
// 不是当前会话又找不到文件时返回 null，调用方必须保持 session_not_found。
export function unflushedSessionHistory(sessionId, activeSessionId) {
  if (!sessionId) return { sessionId: null, turns: [] };
  if (activeSessionId && sessionId === activeSessionId) return { sessionId, turns: [] };
  return null;
}

// turnChange 只在这一轮真的推进了画布版本时给出变更摘要；没写过画布时是 null。
export function turnChange(turn) {
  if (!turn || turn.revisionAfter <= turn.revisionBefore) return null;
  const change = { revisionBefore: turn.revisionBefore, revisionAfter: turn.revisionAfter,
    createdNodeIds: [...new Set(turn.createdNodeIds)], updatedNodeIds: [...new Set(turn.updatedNodeIds)],
    createdEdgeIds: [...new Set(turn.createdEdgeIds)] };
  if (turn.operationIds.length) change.operationIds = [...turn.operationIds];
  return change;
}

// sessionTitle 用第一条用户原文当标题（截到 40 字），而不是加过画布前缀的那份。
export function sessionTitle(turns) {
  const first = (turns || []).find((turn) => String(turn?.userText || '').trim());
  const text = String(first?.userText || '').trim();
  return text.length > 40 ? text.slice(0, 40) : text;
}

// turnContextPrefix 把后端验证过、随 Chat 信封下发的范围交给模型当固定上下文。
// 这里只是「告诉模型可以引用什么」，真正的授权仍在后端按回合记录裁决：
// 模型即使编造别的 assetId/canvasId，工具调用也会在共享操作层被 scope_denied 拒绝。
export function turnContextPrefix({ canvasId, selectedNodeIds = [], references = [] }) {
  const parts = [`当前画布 ${canvasId}`];
  const selected = selectedNodeIds.map((id) => String(id)).filter(Boolean);
  if (selected.length > 0) parts.push(`选中对象: ${selected.join(', ')}`);
  const assets = references.filter((item) => item?.kind === 'asset' && item.id).map((item) => String(item.id));
  const canvases = references.filter((item) => item?.kind === 'canvas' && item.id).map((item) => String(item.id));
  if (assets.length > 0) parts.push(`已引用素材: ${assets.join(', ')}`);
  if (canvases.length > 0) parts.push(`已引用画布（只读）: ${canvases.join(', ')}`);
  return `[${parts.join('｜')}]`;
}

// providerRegistration 构造要登记给 pi 的供应商：
// 密钥以环境变量引用形式传入，宿主进程内解析，不写进 auth.json。
export function providerRegistration({ api, baseUrl, modelId, maxTokens, contextWindow, maxImages = 0, maxImageBytes = 0, reasoningPolicy }) {
  return {
    name: 'Seal', baseUrl, apiKey: '$BEEFTV_AGENT_API_KEY', api,
    models: [{ id: modelId, name: modelId, reasoning: false, ...reasoningPolicy?.model, input: maxImages > 0 ? ['text', 'image'] : ['text'],
      ...(maxImages > 0 && maxImageBytes > 0 ? { inputLimits: { images: { maxPerMessage: maxImages, maxPerRequest: maxImages,
        resize: { maxWidth: 2048, maxHeight: 2048, maxBytes: Math.floor(maxImageBytes * 4 / 3), jpegQuality: 85 } } } } : {}),
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow, maxTokens }],
  };
}

// providerUnavailableReason 给出机器可读原因，交给后端的状态投影使用。
export function providerUnavailableReason({ modelId, baseUrl, apiKey, api }) {
  if (!modelId || !baseUrl || !apiKey) return 'model_not_configured';
  if (!SUPPORTED_APIS.includes(api)) return 'model_protocol_unsupported';
  return '';
}

// SDK 终态消息而不是 Promise 是否 reject 决定模型调用是否成功。
export function modelTurnCompletion(lastAssistantMessage, promptError = null, budgetFailure = null, { cancelled = false, timedOut = false, idleTimedOut = false } = {}) {
  const reply = (lastAssistantMessage?.content || [])
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text).join('');
  if (budgetFailure) return { reply, error: budgetFailure.message, errorReason: budgetFailure.reason };
  if (idleTimedOut) return { reply, error: '模型长时间没有返回内容或进度，已停止等待。已有结果已保留，请检查网络或模型渠道后继续。', errorReason: 'model_idle_timeout' };
  if (timedOut) return { reply, error: '这一轮处理超时，已停止继续执行。', errorReason: 'turn_timeout' };
  if (cancelled) return { reply, error: null, errorReason: null };
  if (promptError) return { reply, error: String(promptError), errorReason: 'model_request_failed' };
  if (lastAssistantMessage?.stopReason === 'error') {
    return { reply, error: lastAssistantMessage.errorMessage || '模型调用没有完成', errorReason: 'model_request_failed' };
  }
  if (lastAssistantMessage?.stopReason === 'length') {
    return { reply, error: '模型达到本次输出上限，制作尚未完成。已有操作与结果已保留；可继续任务，并检查模型输出限制，复杂场景需分段编写。', errorReason: 'model_output_truncated' };
  }
  if (lastAssistantMessage?.stopReason === 'aborted') {
    return { reply, error: '模型响应被上游中断，制作尚未完成。已有结果已保留，请核对后继续。', errorReason: 'model_response_aborted' };
  }
  return { reply, error: null, errorReason: null };
}

// Starts and completions share the official SessionManager journal; no second chat database.
// A missing completion after restart is an interrupted turn, not an empty history.
export function projectTurnHistory(entries, turnType, activeTurnId = '') {
  const turns = new Map();
  for (const entry of entries) {
    if (entry.type !== 'custom' || !entry.data?.turnId) continue;
    const data = entry.data;
    if (entry.customType === turnType) {
      turns.set(data.turnId, { finished: true, data });
    } else if (entry.customType === `${turnType}.started` && !turns.has(data.turnId)) {
      turns.set(data.turnId, { finished: false, data: {
        ...data, reply: '', toolCalls: [], change: null, proposals: [], cancelled: false,
        error: '上一轮执行中断，请核对已落地的改动。', errorReason: 'turn_interrupted',
      } });
    }
  }
  const interrupted = new Map();
  let progress = null;
  for (const entry of entries) {
    if (entry.type === 'custom' && entry.customType === `${turnType}.started`) {
      progress = turns.get(entry.data?.turnId)?.finished ? null : createTurnObserver();
      if (progress) interrupted.set(entry.data.turnId, progress);
    } else if (entry.type === 'custom' && entry.customType === turnType) progress = null;
    if (!progress || entry.type !== 'message') continue;
    const message = entry.message;
    if (message?.role === 'assistant') {
      progress.handle({ type: 'message_start', message });
      progress.handle({ type: 'message_end', message });
      for (const part of message.content || []) if (part.type === 'toolCall') progress.handle({
        type: 'tool_execution_start', toolCallId: part.id, toolName: part.name, args: part.arguments,
      });
    } else if (message?.role === 'toolResult') progress.handle({ type: 'tool_execution_end',
      toolCallId: message.toolCallId, toolName: message.toolName, isError: message.isError, result: { content: message.content || [] } });
  }
  return [...turns.values()]
    .filter((entry) => entry.finished || entry.data.turnId !== activeTurnId)
    .map((entry) => {
      const checkpoints = entries.filter(item => item.type === 'custom' && item.customType === TOOL_CHECKPOINT_TYPE && item.data?.turnId === entry.data.turnId).map(item => item.data);
      const latest = new Map(checkpoints.map(item => [item.toolCallId, item]));
      const completed = checkpoints.filter(item => item.state === 'completed').at(-1);
      const instructions = turnInstructions(entries, entry.data.turnId).map(item => ({ ...item,
        state: item.state === 'queued' ? 'not_processed' : item.state }));
      const replayed = interrupted.get(entry.data.turnId);
      const activity = new Map((replayed?.toolActivity || []).map(item => [item.toolCallId, item]));
      for (const item of latest.values()) if (!activity.has(item.toolCallId) || activity.get(item.toolCallId).status === 'interrupted') {
        activity.set(item.toolCallId, { ...activity.get(item.toolCallId), toolCallId: item.toolCallId, tool: item.tool,
          status: item.state === 'running' ? 'interrupted' : item.state });
      }
      return { ...entry.data, ...(!entry.finished ? {
        execution: replayed?.execution || [], finalMessageId: null,
        toolCalls: [...activity.values()].map(item => ({ toolCallId: item.toolCallId, tool: item.tool, isError: item.status !== 'completed' })),
        toolActivity: [...activity.values()],
        change: completed?.change?.revisionAfter > completed?.change?.revisionBefore ? completed.change : null,
        proposals: completed?.proposals || [],
      } : {}), checkpoints: [...latest.values()].map(({ change, proposals, ...item }) => item), instructions,
        workflows: workflowHistory(entries).filter(item => item.turnId === entry.data.turnId) };
    });
}
