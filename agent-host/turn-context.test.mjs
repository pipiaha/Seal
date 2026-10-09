import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { createContextTools, compactTurnContext } from './turn-context.mjs';
import { projectTurnHistory, newTurnAccumulator, resetTurnAccumulator } from './canvas-turn.mjs';
import { queueTurnInstruction, observeTurnInstruction, turnInstructions } from './turn-instructions.mjs';

test('long results can be searched and read after reopening the official journal; interrupted work retains successful receipts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seal-context-test-'));
  try {
    const manager = SessionManager.create(dir, path.join(dir, 'sessions'));
    manager.appendMessage({ role: 'user', content: [{ type: 'text', text: 'edit' }], timestamp: Date.now() });
    manager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'working' }], api: 'openai-completions', provider: 'test', model: 'test',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: Date.now() });
    manager.appendCustomEntry('test.turn.started', { turnId: 't1', userText: 'edit' });
    const turn = resetTurnAccumulator(newTurnAccumulator(), 1, 't1');
    const tools = createContextTools({ directory: path.join(dir, 'results'), manager, turn, generation: {} });
    const body = { taskId: 'accepted-task', content: 'x'.repeat(20000) + 'subtitle-target', apiKey: 'never-copy-to-recovery' };
    const [tool] = tools.wrap([{ name: 'read_scene', execute: async () => {
      turn.revisionAfter = 2; turn.createdNodeIds.push('n1');
      return { content: [{ type: 'text', text: JSON.stringify(body) }], details: body };
    } }]);
    const summarized = await tool.execute('call1', {});
    const summary = JSON.parse(summarized.content[0].text);
    expect(summary.truncated).toBe(true);
    expect(summarized.details).toBeUndefined();
    expect(summary.identities.taskId).toBe('accepted-task');
    const reopened = SessionManager.open(manager.getSessionFile(), path.join(dir, 'sessions'), dir);
    const restored = createContextTools({ directory: path.join(dir, 'results'), manager: reopened, turn, generation: {} });
    const page = JSON.parse((await restored.reader.execute('read', { resultId: summary.resultId, search: 'subtitle-target' })).content[0].text);
    expect(page.content).toContain('subtitle-target');
    expect(page.nextOffset).toBeNull();
    await expect(restored.reader.execute('read', { resultId: '../secret' })).rejects.toThrow('invalid_result_id');
    const history = projectTurnHistory(reopened.getEntries(), 'test.turn');
    expect(history[0].errorReason).toBe('turn_interrupted');
    expect(history[0].change.createdNodeIds).toEqual(['n1']);
    expect(history[0].checkpoints[0].identities.taskId).toBe('accepted-task');
    expect(JSON.stringify(history)).not.toContain('never-copy-to-recovery');
    expect(compactTurnContext({ canvasId: 'project', revisionBefore: 2, selectedNodeIds: ['n1'] }, history)).toContain('accepted-task');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('supplements use one official queue, deduplicate retry IDs and preserve unprocessed instructions', async () => {
  const entries = [];
  let sent = 0;
  const manager = { getEntries: () => entries, appendCustomEntry: (customType, data) => entries.push({ type: 'custom', customType, data }) };
  const entry = { manager, turn: { turnId: 't1' }, sessionId: 's1', busy: true, generation: {},
    session: { isStreaming: true, sendUserMessage: async (_text, options) => { expect(options.expandPromptTemplates).toBe(false); expect(options.deliverAs).toBe('steer'); sent++; } } };
  const instruction = { sessionId: 's1', turnId: 't1', instructionId: 'i1', message: '/literal white subtitles' };
  await queueTurnInstruction(entry, instruction);
  await queueTurnInstruction(entry, instruction);
  expect(sent).toBe(1);
  await expect(queueTurnInstruction(entry, { ...instruction, message: 'changed' })).rejects.toThrow('instruction_conflict');
  await expect(queueTurnInstruction(entry, { ...instruction, turnId: 'other' })).rejects.toThrow('turn_not_current');
  observeTurnInstruction(entry, { type: 'message_start', message: { role: 'user', content: [{ type: 'text', text: instruction.message }] } });
  expect(turnInstructions(entries, 't1')[0].state).toBe('received');
  await queueTurnInstruction(entry, { ...instruction, instructionId: 'i2', message: 'next instruction' });
  manager.appendCustomEntry('test.turn.started', { turnId: 't1' });
  const history = projectTurnHistory(entries, 'test.turn');
  expect(history[0].instructions[1].state).toBe('not_processed');
  entry.generation.aborted = true;
  await expect(queueTurnInstruction(entry, { ...instruction, instructionId: 'i3' })).rejects.toThrow('turn_not_running');
});
