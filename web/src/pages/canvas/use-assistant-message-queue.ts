import { useEffect, useRef, useState } from 'react';
import { APP_STATE_STORE_NAME, localForageInstance } from '@/lib/localforage-storage';
import { scopedStorageKey } from '@/lib/user-scope';
import { assertUserScope, captureUserScope } from '@/lib/user-scope-guard';
import type { CanvasAssistantController } from './use-canvas-assistant';

export type QueuedAssistantMessage = {
    id: string;
    text: string;
    selectedNodeIds: string[];
    state: 'queued' | 'sending' | 'uncertain';
    mode?: 'send' | 'steer';
    knownTurnIds?: string[];
};
type Packet = { messages: QueuedAssistantMessage[]; paused: boolean; acknowledgedTurnId?: string };
type Snapshot = Packet & { key: string; loaded: boolean; error: string | null; busyId: string | null; editingId: string | null };
type Props = { assistant: CanvasAssistantController; disabled: boolean; busy: boolean; submit: (item: QueuedAssistantMessage, onAdmitted: () => void) => Promise<boolean> };
const storage = localForageInstance(APP_STATE_STORE_NAME);
const empty = (key: string): Snapshot => ({ key, messages: [], paused: false, loaded: false, error: null, busyId: null, editingId: null });

/** 待发送消息先保存在会话范围内；只有显式引导才进入官方 Pi steer 队列。 */
export function useAssistantMessageQueue(props: Props) {
    const [scope] = useState(() => captureUserScope());
    const key = scopedStorageKey(`assistant:message-queue:${JSON.stringify([props.assistant.projectId, props.assistant.sessionId])}`, scope.userScope);
    const [view, setView] = useState(() => empty(key));
    const owner = useRef(view);
    const liveKey = useRef(key); liveKey.current = key;
    const latest = useRef(props); latest.current = props;
    const writes = useRef<Promise<unknown>>(Promise.resolve());
    const publish = (snapshot: Snapshot) => { if (liveKey.current === snapshot.key) { owner.current = snapshot; setView(snapshot); } };
    const fail = (message: string, expected = key) => { if (owner.current.key === expected) publish({ ...owner.current, error: message, paused: true }); };

    useEffect(() => {
        let cancelled = false;
        const snapshot = empty(key); owner.current = snapshot; setView(snapshot);
        writes.current = Promise.resolve();
        if (!props.assistant.sessionId) return;
        void storage.getItem<Packet>(key).then(packet => {
            assertUserScope(scope);
            if (cancelled || liveKey.current !== key) return;
            const messages = (Array.isArray(packet?.messages) ? packet.messages : []).filter(item => typeof item.id === 'string' && typeof item.text === 'string' && Array.isArray(item.selectedNodeIds))
                .map(item => ({ ...item, state: item.state === 'queued' ? 'queued' as const : 'uncertain' as const }));
            publish({ ...snapshot, messages, acknowledgedTurnId: packet?.acknowledgedTurnId, paused: Boolean(packet?.paused) || messages.some(item => item.state === 'uncertain'), loaded: true });
        }).catch(() => { if (!cancelled) fail('未能读取排队消息，请重新打开对话。', key); });
        return () => { cancelled = true; };
    }, [key, props.assistant.sessionId, scope]);

    const mutate = (fn: (packet: Packet) => Packet) => {
        const expected = key;
        const job = writes.current.catch(() => {}).then(async () => {
            assertUserScope(scope);
            if (liveKey.current !== expected || owner.current.key !== expected || !owner.current.loaded) throw new Error('对话已切换或队列未读取完成');
            const packet = fn({ messages: owner.current.messages, paused: owner.current.paused, acknowledgedTurnId: owner.current.acknowledgedTurnId });
            await storage.setItem(expected, packet);
            assertUserScope(scope);
            if (liveKey.current !== expected) throw new Error('对话已切换');
            publish({ ...owner.current, ...packet, error: null });
        });
        writes.current = job;
        return job.catch(error => { fail('排队消息未能保存，请重试。', expected); throw error; });
    };
    const remove = (id: string) => mutate(packet => ({ ...packet, messages: packet.messages.filter(item => item.id !== id) }));

    const dispatch = async (id: string, mode: 'send' | 'steer') => {
        const current = owner.current;
        const context = current.key;
        const item = current.messages.find(item => item.id === id);
        if (!item || item.state !== 'queued' || current.busyId || current.editingId === id || latest.current.disabled) return;
        if (mode === 'steer' && !latest.current.assistant.canSupplement) return;
        publish({ ...current, busyId: id });
        let accepted = false;
        let definitelyNotSent = false;
        try {
            await mutate(packet => ({ ...packet, messages: packet.messages.map(message => message.id === id ? { ...message, state: 'sending', mode, knownTurnIds: latest.current.assistant.turns.map(turn => turn.turnId) } : message) }));
            if (liveKey.current !== context) return;
            assertUserScope(scope);
            if (mode === 'steer') accepted = await latest.current.assistant.supplement(item.text, item.id);
            else {
                const submitted = await latest.current.submit(item, () => {
                    accepted = true;
                    if (liveKey.current === context) {
                        publish({ ...owner.current, busyId: null });
                        void remove(id).catch(() => {});
                    }
                });
                definitelyNotSent = submitted === false;
            }
            if (liveKey.current !== context) return;
            if (accepted) { if (mode === 'send' && owner.current.messages.some(message => message.id === id)) await remove(id); }
            else await mutate(packet => ({ ...packet, paused: true, messages: packet.messages.map(message => message.id === id ? { ...message, state: definitelyNotSent ? 'queued' : 'uncertain' } : message) }));
        } catch {
            if (liveKey.current === context) {
                try { await mutate(packet => ({ ...packet, paused: true, messages: packet.messages.map(message => message.id === id ? { ...message, state: 'uncertain' } : message) })); }
                catch { /* 持久层仍保留 sending，重开后作为待核对消息，绝不自动重发。 */ }
            }
        } finally { if (liveKey.current === context && owner.current.busyId === id) publish({ ...owner.current, busyId: null }); }
    };

    const visible = view.key === key ? view : empty(key);
    const lastTurn = props.assistant.turns.at(-1);
    useEffect(() => {
        if (!visible.loaded || visible.busyId || props.assistant.streaming || !visible.messages.length) return;
        if (props.assistant.error || ((lastTurn?.error || lastTurn?.cancelled) && visible.acknowledgedTurnId !== lastTurn.turnId)) {
            if (!visible.paused) void mutate(packet => ({ ...packet, paused: true })).catch(() => {});
            return;
        }
        const first = visible.messages[0];
        if (!visible.paused && !visible.error && !props.disabled && !props.busy && props.assistant.historyLoaded && !props.assistant.sessionBusy && first.state === 'queued' && visible.editingId !== first.id) void dispatch(first.id, 'send');
    }, [visible, props.assistant.streaming, props.assistant.error, props.assistant.historyLoaded, props.assistant.sessionBusy, lastTurn, props.disabled, props.busy]);

    useEffect(() => {
        if (!visible.loaded || visible.busyId || !props.assistant.historyLoaded) return;
        const instructions = [...props.assistant.instructions, ...props.assistant.turns.flatMap(turn => turn.instructions || [])];
        const pending = visible.messages.filter(item => item.state !== 'queued');
        const known = pending.filter(item => item.mode === 'steer'
            ? instructions.some(instruction => instruction.instructionId === item.id && instruction.state === 'received')
            : props.assistant.turns.some(turn => !(item.knownTurnIds || []).includes(turn.turnId) && turn.userText === item.text) || Boolean(props.assistant.activeTurnId && !(item.knownTurnIds || []).includes(props.assistant.activeTurnId) && props.assistant.pendingUserText === item.text));
        const notDelivered = pending.filter(item => item.mode === 'steer' && instructions.some(instruction => instruction.instructionId === item.id && ['not_processed', 'failed'].includes(instruction.state)));
        if (known.length || notDelivered.length) void mutate(packet => ({ ...packet, messages: packet.messages.filter(item => !known.some(sent => sent.id === item.id))
            .map(item => notDelivered.some(sent => sent.id === item.id) ? { ...item, state: 'queued', mode: undefined } : item) })).catch(() => {});
    }, [visible, props.assistant.turns, props.assistant.instructions, props.assistant.historyLoaded, props.assistant.activeTurnId, props.assistant.pendingUserText]);

    return {
        ...visible,
        enqueue: async (text: string, selectedNodeIds: string[]) => {
            if (!text.trim() || text.length > 8000) throw new Error('一条排队消息最多 8000 字符');
            await mutate(packet => {
                if (packet.messages.length >= 32) throw new Error('最多排队 32 条消息');
                return { ...packet, messages: [...packet.messages, { id: crypto.randomUUID(), text: text.trim(), selectedNodeIds: [...selectedNodeIds], state: 'queued' }] };
            });
        },
        remove,
        guide: (id: string) => dispatch(id, 'steer'),
        sendNow: (id: string) => dispatch(id, 'send'),
        edit: (id: string | null) => { if (!id || owner.current.messages.some(item => item.id === id && item.state === 'queued' && owner.current.busyId !== id)) publish({ ...owner.current, editingId: id }); },
        saveEdit: async (id: string, text: string) => {
            if (!text.trim() || text.length > 8000) throw new Error('消息不能为空，最多 8000 字符');
            await mutate(packet => ({ ...packet, messages: packet.messages.map(item => item.id === id && item.state === 'queued' ? { ...item, text: text.trim() } : item) }));
            publish({ ...owner.current, editingId: null });
        },
        pause: () => { publish({ ...owner.current, paused: true }); return mutate(packet => ({ ...packet, paused: true })); },
        resume: () => { if (latest.current.assistant.error && latest.current.assistant.canRetry) latest.current.assistant.dismissError(); return mutate(packet => ({ ...packet, paused: false, acknowledgedTurnId: latest.current.assistant.turns.at(-1)?.turnId })); },
    };
}
