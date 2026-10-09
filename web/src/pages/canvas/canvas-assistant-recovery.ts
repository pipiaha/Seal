import type { AssistantHistory } from "@/services/api/agent-assistant";

export type PendingAssistantRecovery = {
    sessionId: string | null;
    knownTurnIds: string[];
    text: string;
    selectedNodeIds: string[];
    turnId?: string;
};

/** Only a new, unambiguous receipt in the sending session can settle a lost stream. */
export function findRecoveredAssistantTurn(pending: PendingAssistantRecovery | null, history: AssistantHistory) {
    if (!pending?.sessionId || pending.sessionId !== history.sessionId) return undefined;
    const known = new Set(pending.knownTurnIds);
    if (pending.turnId) return history.turns.find(turn => turn.turnId === pending.turnId);
    const fresh = history.turns.filter((turn) => !known.has(turn.turnId));
    if (fresh.length !== 1) return undefined;
    const turn = fresh[0];
    if (turn.userText !== pending.text || JSON.stringify([...(turn.selectedNodeIds || [])].sort()) !== JSON.stringify([...pending.selectedNodeIds].sort())) return undefined;
    return turn;
}
