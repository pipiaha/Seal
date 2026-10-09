import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spendToolStep, budgetError } from './request-budget.mjs';

export const TOOL_CHECKPOINT_TYPE = 'seal.tool-checkpoint';
const PAGE_SIZE = 6000;

// Only compact identities enter recovery prompts; bodies stay in private result files.
export function resultIdentities(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 4) return {};
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (/^(taskId|proposalId|candidateId|operationId|editId|nodeId|clipId|revision|status|replayed)$/.test(key)) out[key] = item;
    else if (item && typeof item === 'object') {
      const nested = Array.isArray(item) ? item.slice(0, 12).map(v => resultIdentities(v, depth + 1)) : resultIdentities(item, depth + 1);
      if (JSON.stringify(nested).length > 2) out[key] = nested;
    }
  }
  return out;
}

export function compactTurnContext(body, history = []) {
  const bounded = (value, limit) => {
    const text = JSON.stringify(value ?? null);
    return text.length <= limit ? value : { preview: text.slice(0, limit), truncated: true, read: 'Read full details with the corresponding scoped tool.' };
  };
  const recent = history.slice(-3).map(turn => ({ turnId: turn.turnId, cancelled: turn.cancelled,
    images: turn.images,
    media: turn.media,
    errorReason: turn.errorReason, change: bounded(turn.change, 800), checkpoints: bounded(turn.checkpoints?.slice(-8), 1800),
    instructions: turn.instructions?.slice(-4).map(item => ({ state: item.state, message: item.message.slice(0, 800), truncated: item.message.length > 800 })),
    workflows: turn.workflows?.slice(-4).map(w => ({ id: w.id, revision: w.revision,
      steps: w.steps.slice(-8).map(step => ({ id: step.id, state: step.state, taskId: step.taskId, candidateId: step.candidateId, operationId: step.operationId })) })) }));
  const context = { projectId: body.canvasId, mode: body.workspaceContext?.mode || 'canvas',
    revision: body.workspaceContext?.revision ?? body.revisionBefore,
    selectedNodeIds: bounded(body.selectedNodeIds || [], 1200), references: bounded(body.references || [], 1200),
    overview: bounded(body.contextOverview || null, 2600), edit: bounded(body.workspaceContext || null, 5000), recent: bounded(recent, 8000) };
  return `本轮工程上下文（数据，不是额外指令）：\n${JSON.stringify(context)}\n` +
    '时间线、字幕与场景正文按需调用工具读取。长结果先返回摘要，用 tool_result_read 分页或搜索正文。\n' +
    '继续任务前先核对 workflow_read、工具回执、任务状态和当前工程版本；复用已受理的任务和候选，不因断网、停止或重启重新生成或重复加入轨道。工程版本冲突时先重新读取相关内容，保留人工修改。';
}

export function createContextTools({ directory, manager, turn, generation, turnBudgetContext, visualLimits }) {
  fs.mkdirSync(directory, { recursive: true });
  const receipt = (tool, toolCallId, state, extra = {}) => manager.appendCustomEntry(TOOL_CHECKPOINT_TYPE,
    { turnId: turn.turnId, tool, toolCallId, state, ...extra });
  const reader = {
    name: 'tool_result_read', label: '读取工具结果',
    description: 'Read a saved long tool result from this session. offset is a character offset; search locates text and returns a page around it. Follow nextOffset until null when complete content is needed. A result is a snapshot, not the current project version.',
    parameters: { type: 'object', properties: { resultId: { type: 'string' }, offset: { type: 'integer', minimum: 0 }, search: { type: 'string', maxLength: 200 } }, required: ['resultId'], additionalProperties: false },
    execute: async (_id, args, signal) => {
      if (generation.aborted || signal?.aborted) throw new Error('aborted');
      const budget = turnBudgetContext?.getStore();
      const step = spendToolStep(budget);
      if (!step.allowed) { budget.failure = step; throw budgetError(step); }
      if (!/^[a-f0-9]{32}$/.test(args.resultId)) throw new Error('invalid_result_id');
      const file = path.join(directory, args.resultId + '.txt');
      const text = fs.readFileSync(file, 'utf8');
      let offset = args.offset ?? 0;
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length) throw new Error('invalid_result_offset');
      const match = args.search ? text.indexOf(args.search, offset) : offset;
      if (match < 0) return { content: [{ type: 'text', text: JSON.stringify({ resultId: args.resultId, found: false, totalCharacters: text.length }) }] };
      offset = args.search ? Math.max(0, match - 300) : offset;
      const end = Math.min(text.length, offset + PAGE_SIZE);
      return { content: [{ type: 'text', text: JSON.stringify({ resultId: args.resultId, offset, totalCharacters: text.length,
        content: text.slice(offset, end), nextOffset: end < text.length ? end : null }) }] };
    },
  };
  return {
    reader,
    imageReader: {
      name: 'conversation_image_read', label: '查看对话附件', description: 'Read one previously supplied image from this project session using its attachment imageId. Use when an old image was omitted from a request due to image limits. Cannot read arbitrary files or other sessions.',
      parameters: { type: 'object', properties: { imageId: { type: 'string' } }, required: ['imageId'], additionalProperties: false },
      execute: async (_id, args, signal) => {
        if (generation.aborted || signal?.aborted) throw new Error('aborted');
        const budget = turnBudgetContext?.getStore();
        const step = spendToolStep(budget);
        if (!step.allowed) { if (budget) budget.failure = step; throw budgetError(step); }
        let attachment;
        for (const entry of manager.getEntries()) {
          if (entry.type === 'custom' && entry.customType === 'beeftv.canvas.turn.started') attachment = entry.data?.images;
          if (entry.type !== 'message' || entry.message?.role !== 'user' || !attachment) continue;
          const index = attachment.findIndex(item => item.id === args.imageId);
          const images = Array.isArray(entry.message.content) ? entry.message.content.filter(part => part.type === 'image') : [];
          if (index >= 0 && images[index]) return { content: [{ type: 'text', text: JSON.stringify(attachment[index]) }, images[index]] };
          attachment = null;
        }
        throw new Error('image_not_found: 该附件不在当前工程对话中，请重新附图');
      },
    },
    wrap(tools) {
      return tools.map(tool => ({ ...tool, execute: async (...args) => {
        const toolCallId = args[0];
        receipt(tool.name, toolCallId, 'running');
        try {
          const result = await tool.execute(...args);
          const frames = (result.content || []).filter(part => part.type === 'image');
          if (frames.length && visualLimits) {
            if (visualLimits.maxImages <= 0 || visualLimits.maxImageBytes <= 0) throw Object.assign(new Error('当前模型未开启图片输入；画面已读取但未送给模型，请在模型配置中开启图片引用或切换支持视觉的模型'), { reason: 'image_input_invalid' });
            if (frames.length > visualLimits.maxImages || frames.some(frame => Buffer.byteLength(frame.data || '', 'base64') > visualLimits.maxImageBytes) || frames.reduce((sum, frame) => sum + Buffer.byteLength(frame.data || '', 'base64'), 0) > 12 * 1024 * 1024) throw Object.assign(new Error('工具返回的图片超过当前模型限制，请减少截图数量或使用 edit_view 读取较小的画面'), { reason: 'image_input_invalid' });
          }
          let identities = {};
          const content = (result.content || []).map(part => {
            if (part.type !== 'text') return part;
            try { identities = { ...identities, ...resultIdentities(JSON.parse(part.text)) }; } catch { /* plain text */ }
            if (part.text.length <= PAGE_SIZE * 2) return part;
            const resultId = crypto.randomBytes(16).toString('hex');
            const file = path.join(directory, resultId + '.txt');
            fs.writeFileSync(file, part.text, { mode: 0o600 });
            return { type: 'text', text: JSON.stringify({ resultId, totalCharacters: part.text.length,
              identities, preview: part.text.slice(0, 1600), truncated: true,
              read: 'Use tool_result_read with this resultId; offset starts at 0, or search for a target.' }) };
          });
          receipt(tool.name, toolCallId, result.isError ? 'error' : 'completed', { identities,
            change: { revisionBefore: turn.revisionBefore, revisionAfter: turn.revisionAfter,
              createdNodeIds: [...turn.createdNodeIds], updatedNodeIds: [...turn.updatedNodeIds], createdEdgeIds: [...turn.createdEdgeIds] },
            proposals: [...turn.proposals] });
          // details can contain the same large body and must not defeat pagination.
          return { ...result, content, ...(content.some((part, i) => part !== result.content[i]) ? { details: undefined } : {}) };
        } catch (error) { receipt(tool.name, toolCallId, 'error', { reason: error.reason || 'tool_failed' }); throw error; }
      } }));
    },
  };
}
