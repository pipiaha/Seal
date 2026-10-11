import { expect, test } from 'bun:test';
import { modelOutputLimit, modelReasoningPolicy, canRecoverEmptyOutput } from './output-policy.mjs';

test('48K defaults and unsupported configured effort fails explicitly', () => {
  expect(modelOutputLimit('anything')).toBe(49152);
  expect(modelOutputLimit('anything', '32768')).toBe(32768);
  expect(() => modelOutputLimit('anything', '0')).toThrow();
  const policy = modelReasoningPolicy({ api: 'openai-completions', modelId: 'deepseek-flash', baseUrl: 'https://relay.invalid/v1' });
  expect(policy.levels).toEqual(['off', 'low', 'high', 'max']);
  expect(policy.level).toBe('high');
  expect(() => modelReasoningPolicy({ api: 'openai-completions', modelId: 'deepseek-flash', effort: 'medium' })).toThrow();
});

test('truncation never automatically resumes partial code, approvals, async work or cancellation', () => {
  const message = { stopReason: 'length', content: [{ type: 'thinking', thinking: 'unfinished' }] };
  const entry = { generation: {}, turn: { workflowJournal: { read: () => [] } } };
  expect(canRecoverEmptyOutput(entry, message)).toBe(true);
  expect(canRecoverEmptyOutput(entry, { ...message, content: [{ type: 'text', text: '<html>' }] })).toBe(false);
  expect(canRecoverEmptyOutput(entry, { ...message, content: [{ type: 'toolCall', name: 'create' }] })).toBe(false);
  expect(canRecoverEmptyOutput({ ...entry, generation: { aborted: true } }, message)).toBe(false);
  expect(canRecoverEmptyOutput({ ...entry, turn: { proposals: [{}] } }, message)).toBe(false);
  expect(canRecoverEmptyOutput({ ...entry, turn: { workflowJournal: { read: () => [{ steps: [{ state: 'waiting' }] }] } } }, message)).toBe(false);
});
