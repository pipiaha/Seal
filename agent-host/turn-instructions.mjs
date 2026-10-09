export const INSTRUCTION_ENTRY_TYPE = 'seal.turn-instruction';

export function turnInstructions(entries, turnId) {
  const latest = new Map();
  for (const entry of entries) if (entry.type === 'custom' && entry.customType === INSTRUCTION_ENTRY_TYPE && entry.data?.turnId === turnId)
    latest.set(entry.data.instructionId, entry.data);
  return [...latest.values()];
}

export async function queueTurnInstruction(entry, { sessionId, turnId, instructionId, message }) {
  if (!entry || entry.sessionId !== sessionId || entry.turn.turnId !== turnId)
    throw Object.assign(new Error('turn_not_current'), { reason: 'turn_not_current' });
  const previous = turnInstructions(entry.manager.getEntries(), turnId).find(item => item.instructionId === instructionId);
  if (previous) {
    if (previous.message !== message) throw Object.assign(new Error('instruction_conflict'), { reason: 'instruction_conflict' });
    return previous;
  }
  if (!entry.busy || !entry.session.isStreaming || entry.generation.aborted)
    throw Object.assign(new Error('turn_not_running'), { reason: 'turn_not_running' });
  if (turnInstructions(entry.manager.getEntries(), turnId).length >= 32) throw new Error('instruction_limit');
  const record = { turnId, instructionId, message, state: 'queued', createdAt: new Date().toISOString() };
  entry.manager.appendCustomEntry(INSTRUCTION_ENTRY_TYPE, record);
  try {
    // Official queue, literal text: no skill expansion or additional model loop.
    await entry.session.sendUserMessage(message, { deliverAs: 'steer', expandPromptTemplates: false });
  } catch (error) {
    entry.manager.appendCustomEntry(INSTRUCTION_ENTRY_TYPE, { ...record, state: 'failed' });
    throw error;
  }
  return turnInstructions(entry.manager.getEntries(), turnId).find(item => item.instructionId === instructionId);
}

export function observeTurnInstruction(entry, event) {
  if (event?.type !== 'message_start' || event.message?.role !== 'user') return;
  const text = (event.message.content || []).filter(part => part.type === 'text').map(part => part.text).join('');
  const instruction = turnInstructions(entry.manager.getEntries(), entry.turn.turnId).find(item => item.state === 'queued' && item.message === text);
  if (instruction) {
    const received = { ...instruction, state: 'received' };
    entry.manager.appendCustomEntry(INSTRUCTION_ENTRY_TYPE, received);
    return received;
  }
}
