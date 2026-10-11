// These are host request budgets, not claims about the provider's model limits.
export function modelOutputLimit(modelId, configuredValue) {
  if (configuredValue !== undefined && String(configuredValue).trim() !== '') {
    const value = Number(configuredValue);
    if (!Number.isSafeInteger(value) || value < 1 || value > 1048576) throw new Error('Invalid BEEFTV_AGENT_MAX_TOKENS');
    return value;
  }
  return 49152;
}

const ALL_LEVELS = ['off', 'low', 'medium', 'high', 'xhigh', 'max'];
export function modelReasoningPolicy({ api, modelId, baseUrl, format = 'auto', effort = '', levels = [] }) {
  if (format === 'auto' || !format) {
    if (/deepseek/i.test(modelId) || /api\.deepseek\.com/i.test(baseUrl)) format = 'deepseek';
    else if (api === 'anthropic-messages') format = /claude-(?:opus|sonnet)-(?:4[.-][6-9]|[5-9])/i.test(modelId) ? 'anthropic-adaptive' : 'anthropic-budget';
    else if (/openrouter\.ai/i.test(baseUrl)) format = 'openrouter';
    else if (/^(?:gpt-[5-9]|o[134](?:-|$))/i.test(modelId)) format = 'openai';
    else format = 'none';
  }
  if (!['none', 'openai', 'deepseek', 'openrouter', 'zai', 'qwen', 'anthropic-adaptive', 'anthropic-budget'].includes(format)) throw new Error('Invalid reasoning format');
  if (format.startsWith('anthropic-') && api !== 'anthropic-messages') throw new Error('Claude thinking requires the Anthropic Messages protocol');
  if (['openrouter', 'zai', 'qwen'].includes(format) && api !== 'openai-completions') throw new Error('This thinking format requires Chat Completions');
  const defaults = format === 'none' ? [] : format === 'deepseek' ? ['off', 'low', 'high', 'max']
    : ['zai', 'qwen'].includes(format) ? ['off', 'high'] : format === 'openai' ? ['low', 'medium', 'high'] : ['off', 'low', 'medium', 'high'];
  if (!Array.isArray(levels) || levels.some(level => !ALL_LEVELS.includes(level))) throw new Error('Invalid reasoning levels');
  const available = format === 'none' ? [] : [...new Set(levels.length ? levels : defaults)];
  if (effort && format !== 'none' && !available.includes(effort)) throw new Error('Requested thinking level is not supported by this model configuration');
  const fallback = ['deepseek', 'zai', 'qwen'].includes(format) ? 'high' : 'medium';
  const level = format === 'none' ? 'off' : effort || (available.includes(fallback) ? fallback : available[0]);
  const thinkingLevelMap = Object.fromEntries(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map(key => [key, available.includes(key) ? key === 'off' ? 'none' : key : null]));
  const compat = api === 'openai-completions' && format !== 'none' ? {
    thinkingFormat: format.startsWith('anthropic-') ? 'openai' : format,
    supportsReasoningEffort: !['zai', 'qwen'].includes(format),
    ...(format === 'deepseek' ? { maxTokensField: 'max_tokens', requiresReasoningContentOnAssistantMessages: true } : {}),
  } : api === 'anthropic-messages' && format !== 'none' ? { forceAdaptiveThinking: format === 'anthropic-adaptive' || format === 'deepseek' } : undefined;
  return { format, level, levels: available, model: { reasoning: format !== 'none', thinkingLevelMap, ...(compat ? { compat } : {}) } };
}

export const OUTPUT_RECOVERY_PROMPT = '上一条模型响应达到了输出长度限制，只产生了思考，没有交付正文。继续当前用户已经授权的任务，先读取现有计划与结果，从未完成处推进。已有成功工具操作不重放，不重新提交生成或重复加入轨道。不要继续长篇规划；代码和场景分成较小的文件或候选步骤编写，每步保存真实结果。如果存在缺失能力、待审批或正在运行的任务，明确说明阻碍和下一步，不宣称已完成。';

export function canRecoverEmptyOutput(entry, message) {
  if (entry.generation?.aborted || message?.stopReason !== 'length') return false;
  if ((message.content || []).some(part => part.type !== 'thinking')) return false;
  if (entry.turn?.proposals?.length) return false;
  return !(entry.turn?.workflowJournal?.read() || []).some(workflow => workflow.steps?.some(step => step.state === 'waiting'));
}
