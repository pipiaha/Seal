// SDK 会话所有者：SessionManager 是唯一 transcript；createAgentSession 装配官方会话。
// 替换走官方 abort()+dispose()（与 AgentSessionRuntime.teardownCurrent 相同）。
// 每张画布一条预约队列：ensure / replace / chat 占 busy 互斥；不同画布不互相等待。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createAgentSession, SessionManager } from '@earendil-works/pi-coding-agent';
import { sessionActionIdentity } from './session-identity.mjs';
import { newTurnAccumulator, projectTurnHistory, sessionTitle } from './canvas-turn.mjs';
import { workflowJournal } from './workflow-journal.mjs';
import { createFullControlLoader } from './full-control-loader.mjs';
import { createHostSettingsManager } from './session-settings.mjs';
import { createTurnObserver } from './lifecycle-events.mjs';
import { createContextTools } from './turn-context.mjs';
import { observeTurnInstruction } from './turn-instructions.mjs';
import { limitVisualContext } from './visual-input.mjs';

export const TURN_ENTRY_TYPE = 'beeftv.canvas.turn';

export function canvasKey(canvasId) {
  return crypto.createHash('sha256').update(canvasId).digest('hex').slice(0, 24);
}

function pointerFailed(message, cause) {
  const error = new Error(message);
  error.reason = 'session_pointer_failed';
  if (cause) error.cause = cause;
  return error;
}

function storeClosedError() {
  const error = new Error('session_store_closed');
  error.reason = 'session_store_closed';
  return error;
}

export function createSessionStore({ sessionRoot, workspaceRoot, agentDir, runId, getModelRuntime, getModel, resourceLoader: suppliedResourceLoader, resourceLoaderFactory, turnBudgetContext }) {
  const sessions = new Map();
  const canvasLocks = new Map();
  let closed = false;
  let inFlightLocks = 0;
  let idleResolvers = [];

  function notifyLocksIdle() {
    if (inFlightLocks !== 0) return;
    const waiting = idleResolvers;
    idleResolvers = [];
    for (const resolve of waiting) resolve();
  }

  function waitForCanvasLocks() {
    if (inFlightLocks === 0) return Promise.resolve();
    return new Promise((resolve) => { idleResolvers.push(resolve); });
  }

  function withCanvasLock(canvasId, fn) {
    inFlightLocks += 1;
    const previous = canvasLocks.get(canvasId) || Promise.resolve();
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    canvasLocks.set(canvasId, previous.then(() => held, () => held));
    return previous.then(() => {
      if (closed) throw storeClosedError();
      return fn();
    }, () => {
      if (closed) throw storeClosedError();
      return fn();
    }).finally(() => {
      release();
      inFlightLocks -= 1;
      notifyLocksIdle();
    });
  }

  function canvasWorkspace(canvasId) {
    return path.join(workspaceRoot, canvasKey(canvasId));
  }

  function canvasSessionDir(canvasId) {
    const dir = path.join(sessionRoot, canvasKey(canvasId));
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  function currentSessionPointerPath(canvasId) {
    return path.join(canvasSessionDir(canvasId), 'current.json');
  }

  function readCurrentSessionId(canvasId) {
    const file = currentSessionPointerPath(canvasId);
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return '';
      throw pointerFailed(`当前会话指针无法读取（${error.code || error.message}）`, error);
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw pointerFailed('当前会话指针内容无效', error);
    }
    if (typeof parsed?.sessionId !== 'string' || !parsed.sessionId.trim()) {
      throw pointerFailed('当前会话指针缺少 sessionId');
    }
    return parsed.sessionId;
  }

  function writeCurrentSessionId(canvasId, sessionId) {
    const dest = currentSessionPointerPath(canvasId);
    const tmp = path.join(canvasSessionDir(canvasId), `current.${crypto.randomUUID()}.tmp`);
    try {
      fs.writeFileSync(tmp, JSON.stringify({ sessionId }), { mode: 0o600 });
      fs.renameSync(tmp, dest);
    } catch (error) {
      try { fs.unlinkSync(tmp); } catch { /* 临时文件尽量清掉 */ }
      throw pointerFailed(`当前会话指针无法写入（${error.code || error.message}）`, error);
    }
  }

  function turnEntries(manager) {
    const active = [...sessions.values()].find((entry) => entry.busy && entry.sessionId === manager.getSessionId());
    return projectTurnHistory(manager.getEntries(), TURN_ENTRY_TYPE, active?.turn.turnId || '');
  }

  async function listCanvasSessions(canvasId) {
    const cwd = canvasWorkspace(canvasId);
    fs.mkdirSync(cwd, { recursive: true });
    const sessionDir = canvasSessionDir(canvasId);
    const known = await SessionManager.list(cwd, sessionDir);
    const out = [];
    for (const info of known) {
      let turns = [];
      try { turns = turnEntries(SessionManager.open(info.path, sessionDir, cwd)); } catch { turns = []; }
      out.push({
        sessionId: info.id,
        title: sessionTitle(turns),
        updatedAt: new Date(info.modified).toISOString(),
        turnCount: turns.length,
      });
    }
    out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return out;
  }

  function openSessionManager(canvasId, sessionId) {
    const cwd = canvasWorkspace(canvasId);
    fs.mkdirSync(cwd, { recursive: true });
    const sessionDir = canvasSessionDir(canvasId);
    if (sessionId) {
      const file = SessionManager.findById(cwd, sessionId, sessionDir);
      if (!file) { const error = new Error('session_not_found'); error.reason = 'session_not_found'; throw error; }
      return { manager: SessionManager.open(file, sessionDir, cwd), persistence: `restored:${sessionId}` };
    }
    return { manager: SessionManager.create(cwd, sessionDir), persistence: 'created' };
  }

  async function createLiveSession({ canvasId, sessionId, buildTools }) {
    const resourceLoader = resourceLoaderFactory?.() || suppliedResourceLoader || createFullControlLoader();
    const cwd = canvasWorkspace(canvasId);
    const log = [];
    const generation = { aborted: false };
    const turn = newTurnAccumulator();
    let opened;
    try {
      opened = openSessionManager(canvasId, sessionId);
    } catch (error) {
      if (error?.reason === 'session_not_found') throw error;
      throw new Error(`会话持久化不可用（SessionManager 恢复失败）：${error.message}`);
    }
    const { manager, persistence } = opened;
    const persistedId = (typeof manager.getSessionId === 'function' && manager.getSessionId()) ||
      (typeof manager.getSessionFile === 'function' && manager.getSessionFile() ? path.basename(String(manager.getSessionFile())) : '') || '';
    const identity = sessionActionIdentity({ persistedId, runId });
    turn.workflowJournal = workflowJournal(manager, identity.prefix);
    console.error(`agent-host: 会话 ${canvasId} 的动作身份来源 = ${identity.source}（persistence=${persistence}）`);
    const contextTools = createContextTools({ directory: path.join(canvasSessionDir(canvasId), 'tool-results', canvasKey(persistedId)), manager, turn, generation, turnBudgetContext,
      visualLimits: { maxImages: Number(process.env.BEEFTV_AGENT_MAX_IMAGES || 0), maxImageBytes: Number(process.env.BEEFTV_AGENT_MAX_IMAGE_BYTES || 0) } });
    const tools = [...contextTools.wrap([...buildTools(canvasId, log, generation, turn, identity.prefix), contextTools.imageReader]), contextTools.reader];
    const { session } = await createAgentSession({
      cwd,
      agentDir,
      modelRuntime: getModelRuntime() || undefined,
      model: getModel() || undefined,
      thinkingLevel: 'off',
      noTools: 'builtin',
      customTools: tools,
      resourceLoader,
      settingsManager: createHostSettingsManager(),
      sessionManager: manager,
    });
    const prepareRequest = session.agent.prepareRequest;
    session.agent.prepareRequest = async (request, signal) => {
      const prepared = await prepareRequest?.(request, signal);
      const context = prepared?.context || request.context;
      return { ...prepared, context: { ...context, messages: limitVisualContext(context.messages, {
        maxImages: Number(process.env.BEEFTV_AGENT_MAX_IMAGES || 0), maxImageBytes: Number(process.env.BEEFTV_AGENT_MAX_IMAGE_BYTES || 0),
      }) } };
    };
    return {
      resourceLoader,
      skillRevision: null,
      skillUserScope: null,
      sessionId: manager.getSessionId(),
      session,
      manager,
      log,
      busy: false,
      disposed: false,
      generation,
      turn,
      identity,
      persistence,
    };
  }

  async function disposeOwnedSession(entry) {
    if (!entry || entry.disposed) return;
    entry.disposed = true;
    if (!entry.session) return;
    try {
      if (typeof entry.session.abort === 'function') await entry.session.abort();
    } catch { /* 释放必须继续 */ }
    try {
      if (typeof entry.session.dispose === 'function') entry.session.dispose();
    } catch { /* 释放必须继续 */ }
  }

  function sessionBusyError() {
    const error = new Error('session_busy');
    error.reason = 'session_busy';
    return error;
  }

  function sessionNotCurrentError() {
    const error = new Error('session_not_current');
    error.reason = 'session_not_current';
    return error;
  }

  async function replaceSessionUnlocked(canvasId, factory) {
    const previous = sessions.get(canvasId);
    if (previous?.busy) throw sessionBusyError();
    const next = await factory();
    try {
      writeCurrentSessionId(canvasId, next.sessionId);
    } catch (error) {
      if (next && next !== previous) await disposeOwnedSession(next);
      throw error;
    }
    sessions.set(canvasId, next);
    if (previous && previous !== next) await disposeOwnedSession(previous);
    return next;
  }

  async function restoreOrCreateUnlocked(canvasId, buildTools) {
    const pointed = readCurrentSessionId(canvasId);
    if (pointed) {
      try {
        return await replaceSessionUnlocked(canvasId, () => createLiveSession({ canvasId, sessionId: pointed, buildTools }));
      } catch (error) {
        if (error?.reason !== 'session_not_found') throw error;
      }
    }
    const known = await listCanvasSessions(canvasId);
    if (known.length > 0) {
      return replaceSessionUnlocked(canvasId, () => createLiveSession({ canvasId, sessionId: known[0].sessionId, buildTools }));
    }
    return replaceSessionUnlocked(canvasId, () => createLiveSession({ canvasId, sessionId: '', buildTools }));
  }

  async function ensureSessionUnlocked(canvasId, buildTools) {
    const existing = sessions.get(canvasId);
    if (existing) return existing;
    return restoreOrCreateUnlocked(canvasId, buildTools);
  }

  function replaceSession(canvasId, factory) {
    return withCanvasLock(canvasId, () => replaceSessionUnlocked(canvasId, factory));
  }

  function ensureSession(canvasId, buildTools) {
    return withCanvasLock(canvasId, () => ensureSessionUnlocked(canvasId, buildTools));
  }

  function acquireChatSession(canvasId, buildTools, requestedSessionId = '', skillSnapshot) {
    return withCanvasLock(canvasId, async () => {
      const entry = await ensureSessionUnlocked(canvasId, buildTools);
      if (requestedSessionId && requestedSessionId !== entry.sessionId) throw sessionNotCurrentError();
      if (entry.busy) throw sessionBusyError();
      if (skillSnapshot) {
        if (entry.skillUserScope && entry.skillUserScope !== skillSnapshot.userScope) throw new Error('skill_user_scope_mismatch');
        if (entry.skillRevision !== skillSnapshot.revision) {
          entry.resourceLoader.setSnapshot(skillSnapshot);
          await entry.session.reload();
          entry.skillRevision = skillSnapshot.revision;
          entry.skillUserScope = skillSnapshot.userScope;
        }
      }
      entry.busy = true;
      entry.generation.aborted = false;
      return entry;
    });
  }

  function releaseChatSession(entry) {
    if (entry) entry.busy = false;
  }

  async function runOwnedPrompt(entry, message, { onEvent, runWithBudget, timeoutMs, images = [] }) {
    const observer = createTurnObserver();
    const unsubscribe = entry.session.subscribe((event) => {
      const instruction = observeTurnInstruction(entry, event);
      if (instruction) onEvent({ type: 'instruction', instruction });
      const payload = observer.handle(event);
      if (payload) onEvent(payload);
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      entry.generation.aborted = true;
      entry.session.abort().catch(() => {});
    }, timeoutMs);
    let error = null;
    try {
      await runWithBudget(async () => {
        await entry.session.prompt(message, { expandPromptTemplates: false, source: 'rpc', images });
      });
      if (!observer.settled) {
        try { await entry.session.waitForIdle(); } catch { /* 仍按未 settle 处理 */ }
      }
    } catch (promptError) {
      error = `${promptError?.name || 'Error'}: ${promptError?.message || promptError}`;
    } finally {
      clearTimeout(timer);
      unsubscribe();
    }
    if (!observer.settled && !error) {
      error = 'Error: agent run did not settle';
    }
    return { observer, error, timedOut };
  }

  async function disposeAll() {
    closed = true;
    await waitForCanvasLocks();
    const entries = [...sessions.values()];
    sessions.clear();
    for (const entry of entries) await disposeOwnedSession(entry);
    return entries.length;
  }

  return {
    sessions,
    canvasWorkspace,
    canvasSessionDir,
    currentSessionPointerPath,
    readCurrentSessionId,
    writeCurrentSessionId,
    turnEntries,
    listCanvasSessions,
    openSessionManager,
    createLiveSession,
    disposeOwnedSession,
    replaceSession,
    ensureSession,
    acquireChatSession,
    releaseChatSession,
    runOwnedPrompt,
    disposeAll,
  };
}
