import { expect, test } from 'bun:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { canvasKey } from './session-owner.mjs';
import { readFileSync, readdirSync } from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('真实宿主：附图通过官方 SDK 成为视觉请求，恢复后仍保留图片', async () => {
  await withHost(async ({ api, modelInputs, directory }) => {
    const image = { id: 'attachment-1', name: 'image.png', mimeType: 'image/png', source: 'upload',
      data: readFileSync(path.join(root, 'assets/seal/mark-white.png')).toString('base64') };
    const result = await api('/chat', { canvasId: 'visual-canvas', message: '检查附图', turnId: 'visual1', images: [image],
      skillSnapshot: { revision: 'test', userScope: '0'.repeat(64), skills: [] } });
    expect(result.status).toBe(200);
    const events = result.text.trim().split('\n').map(line => JSON.parse(line));
    expect(events.at(-1).error).toBeNull();
    const parts = modelInputs[0].messages.flatMap(message => Array.isArray(message.content) ? message.content : []);
    expect(parts.some(part => part.type === 'image_url' && part.image_url.url.startsWith('data:image/'))).toBe(true);
    const history = await api('/history?canvasId=visual-canvas');
    expect(history.payload.turns[0].images[0].name).toBe('image.png');
    expect(JSON.stringify(history.payload.turns)).not.toContain(image.data);
    const sessionDir = path.join(directory, 'sessions', canvasKey('visual-canvas'));
    const sessionFile = readdirSync(sessionDir).find(file => file.endsWith('.jsonl'));
    expect(readFileSync(path.join(sessionDir, sessionFile), 'utf8')).toContain('"type":"image"');
  }, { BEEFTV_AGENT_MAX_IMAGES: '8', BEEFTV_AGENT_MAX_IMAGE_BYTES: '2097152' });
}, 35000);

test('真实宿主：视频抽帧成为视觉请求，文字文件内容进入 SDK，历史不重复存大正文', async () => {
  const pixels = readFileSync(path.join(root, 'assets/seal/mark-white.png')).toString('base64');
  await withHost(async ({ api, modelInputs, directory }) => {
    const content = '1\n00:00:00,000 --> 00:00:01,000\n字幕原文 Seal';
    const result = await api('/chat', { canvasId:'media-canvas', turnId:'media1', message:'检查视频和字幕',
      media:[{id:'v1',kind:'video',name:'video.mp4',assetId:'video-asset'},{id:'t1',kind:'text',name:'字幕.srt',content}],
      references:[{kind:'asset',id:'video-asset'}],skillSnapshot:{revision:'test',userScope:'0'.repeat(64),skills:[]} });
    expect(result.status).toBe(200);
    expect(result.text.trim().split('\n').map(line=>JSON.parse(line)).at(-1).error).toBeNull();
    expect(modelInputs.length).toBe(2);
    expect(JSON.stringify(modelInputs[0].messages)).toContain('字幕原文 Seal');
    const parts = modelInputs[1].messages.flatMap(message=>Array.isArray(message.content)?message.content:[]);
    expect(parts.filter(part=>part.type==='image_url').length).toBe(2);
    expect(JSON.stringify(modelInputs[1].messages)).toContain('仅检查指定时间点');
    const history=await api('/history?canvasId=media-canvas');
    expect(history.payload.turns[0].media.map(item=>item.kind)).toEqual(['video','text']);
    expect(JSON.stringify(history.payload.turns)).not.toContain('字幕原文 Seal');
    const sessionDir=path.join(directory,'sessions',canvasKey('media-canvas'));
    const sessionFile=readdirSync(sessionDir).find(file=>file.endsWith('.jsonl'));
    const journal=readFileSync(path.join(sessionDir,sessionFile),'utf8');
    expect(journal).toContain('字幕原文 Seal'); expect(journal).toContain('"type":"image"');
  }, {BEEFTV_AGENT_MAX_IMAGES:'8',BEEFTV_AGENT_MAX_IMAGE_BYTES:'2097152'}, {frames:[{time:0,mimeType:'image/png',data:pixels},{time:1,mimeType:'image/png',data:pixels}]});
},35000);

async function withHost(run, envExtra = {}, fixture = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'beeftv session lifecycle '));
  const hostToken = 'synthetic-lifecycle-host';
  let child;
  let base;
  let log = '';
  let modelCalls = 0;
  const modelInputs = [];
  const listen = (server) => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
  const jsonBody = async (req) => {
    let text = '';
    for await (const part of req) text += part;
    return JSON.parse(text || '{}');
  };
  const api = async (route, body) => {
    const response = await fetch(base + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', 'X-Beeftv-Agent-Token': hostToken },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    const text = await response.text();
    let payload = null;
    try { payload = JSON.parse(text); } catch { payload = text; }
    return { status: response.status, payload, text };
  };
  const ops = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.headers['x-beeftv-agent-token'] !== hostToken) { res.writeHead(403).end('{}'); return; }
    if (req.url === '/api/ops') {
      res.end(JSON.stringify({ code: 0, data: { ops: [{ id: 'canvas.get', summary: 'Read', readOnly: true, scope: 'canvas', params: { type: 'object', properties: { canvasId: { type: 'string' } }, required: ['canvasId'] } }] } }));
      return;
    }
    if (fixture.frames && req.url.endsWith('/media/read')) { res.end(JSON.stringify({code:0,data:{assetId:'video-asset',kind:'video',info:{durationMs:2000,hasAudio:true,frames:fixture.frames,coverage:'仅检查指定时间点'}}})); return; }
    res.end(JSON.stringify({ code: 0, data: { result: { canvas: { revision: 1 } } } }));
  });
  const model = createServer(async (req, res) => {
    modelInputs.push(await jsonBody(req));
    modelCalls += 1;
    if (modelCalls === 1) {
      await delay(8000);
      if (res.writableEnded) return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (fixture.frames && modelCalls===1) {
      res.write('data: '+JSON.stringify({id:'s',object:'chat.completion.chunk',created:1,model:'synthetic',choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'read-video',type:'function',function:{name:'media_read',arguments:JSON.stringify({assetId:'video-asset',frames:true,times:[0,1]})}}]},finish_reason:null}]})+'\n\n');
      res.write('data: '+JSON.stringify({id:'s',object:'chat.completion.chunk',created:1,model:'synthetic',choices:[{index:0,delta:{},finish_reason:'tool_calls'}]})+'\n\n');
      res.end('data: [DONE]\n\n'); return;
    }
    res.write('data: ' + JSON.stringify({ id: 's', object: 'chat.completion.chunk', created: 1, model: 'synthetic', choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: null }] }) + '\n\n');
    res.write('data: ' + JSON.stringify({ id: 's', object: 'chat.completion.chunk', created: 1, model: 'synthetic', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n');
    res.end('data: [DONE]\n\n');
  });
  const waitFor = async (check, ms) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (await check()) return;
      await delay(50);
    }
    throw new Error('fixture condition timed out: ' + log.slice(-1500));
  };
  try {
    const opsPort = await listen(ops);
    const modelPort = await listen(model);
    const reservation = createServer();
    const port = await listen(reservation);
    await new Promise((resolve) => reservation.close(resolve));
    base = `http://127.0.0.1:${port}`;
    const env = {
      ...process.env,
      BEEFTV_AGENT_DATA_DIR: directory,
      BEEFTV_AGENT_HOST_TOKEN: hostToken,
      BEEFTV_AGENT_PORT: String(port),
      BEEFTV_OPS_URL: `http://127.0.0.1:${opsPort}/api`,
      BEEFTV_AGENT_API: 'openai-completions',
      BEEFTV_AGENT_MODEL: 'synthetic',
      BEEFTV_AGENT_API_KEY: 'synthetic-only',
      BEEFTV_AGENT_BASE_URL: `http://127.0.0.1:${modelPort}/v1`,
      BEEFTV_AGENT_TURN_TIMEOUT_MS: '20000',
      ...envExtra,
    };
    child = spawn('node', [path.join(root, 'agent-host/server.mjs')], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (chunk) => { log += chunk; });
    child.stderr.on('data', (chunk) => { log += chunk; });
    await waitFor(async () => {
      if (child.exitCode !== null) throw new Error('host exited: ' + log);
      try { return (await fetch(base + '/health', { signal: AbortSignal.timeout(500) })).ok; }
      catch { return false; }
    }, 10000);
    await run({ api, waitFor, directory, child, getLog: () => log, getModelCalls: () => modelCalls, modelInputs });
  } finally {
    if (child && child.exitCode === null) {
      const exited = new Promise((resolve) => child.once('close', resolve));
      child.kill('SIGTERM');
      await Promise.race([exited, delay(3000)]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    for (const server of [ops, model]) {
      if (server.listening) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
    }
    rmSync(directory, { recursive: true, force: true });
  }
}

test('真实宿主：新建会话替换会释放上一条，忙碌时拒绝替换', async () => {
  await withHost(async ({ api, waitFor, getModelCalls }) => {
    const created = await api('/sessions', { canvasId: 'life-canvas' });
    expect(created.status).toBe(200);
    const firstId = created.payload.sessionId;
    expect(firstId).toBeTruthy();

    const replaced = await api('/sessions', { canvasId: 'life-canvas' });
    expect(replaced.status).toBe(200);
    expect(replaced.payload.sessionId).not.toBe(firstId);
    const listed = await api('/sessions?canvasId=life-canvas');
    expect(listed.payload.currentSessionId).toBe(replaced.payload.sessionId);

    const chat = api('/chat', { canvasId: 'life-canvas', message: 'Keep this turn busy.', turnId: 'busyturn1', revisionBefore: 1 });
    await waitFor(() => getModelCalls() >= 1, 8000);
    const busyReplace = await api('/sessions', { canvasId: 'life-canvas' });
    expect(busyReplace.status).toBe(409);
    expect(busyReplace.payload.reason).toBe('session_busy');
    await api('/cancel', { canvasId: 'life-canvas' });
    await chat;
  });
}, 35000);

test('真实宿主：并发新建会话最终只有一条当前会话', async () => {
  await withHost(async ({ api }) => {
    const [a, b] = await Promise.all([
      api('/sessions', { canvasId: 'parallel-canvas' }),
      api('/sessions', { canvasId: 'parallel-canvas' }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.payload.sessionId).not.toBe(b.payload.sessionId);
    const listed = await api('/sessions?canvasId=parallel-canvas');
    expect(listed.status).toBe(200);
    expect([a.payload.sessionId, b.payload.sessionId]).toContain(listed.payload.currentSessionId);
    const health = await api('/health');
    expect(health.status).toBe(200);
    expect(health.payload.sessions).toBe(1);
  });
}, 35000);

test('真实宿主：指针写成目录后替换失败，当前会话仍是旧的', async () => {
  await withHost(async ({ api, directory }) => {
    const created = await api('/sessions', { canvasId: 'pointer-canvas' });
    expect(created.status).toBe(200);
    const firstId = created.payload.sessionId;
    const pointer = path.join(directory, 'sessions', canvasKey('pointer-canvas'), 'current.json');
    rmSync(pointer, { force: true });
    mkdirSync(pointer);
    const replaced = await api('/sessions', { canvasId: 'pointer-canvas' });
    expect(replaced.status).toBe(500);
    expect(replaced.payload.reason).toBe('session_pointer_failed');
    const listed = await api('/sessions?canvasId=pointer-canvas');
    expect(listed.status).toBe(200);
    expect(listed.payload.currentSessionId).toBe(firstId);
  });
}, 35000);

test('真实宿主：chat 与 replace 并发时不是 500，忙碌则拒绝替换', async () => {
  await withHost(async ({ api }) => {
    const created = await api('/sessions', { canvasId: 'mix-canvas' });
    expect(created.status).toBe(200);
    const [chat, replaced] = await Promise.all([
      api('/chat', { canvasId: 'mix-canvas', message: 'Keep this turn busy.', turnId: 'mixturn1', revisionBefore: 1 }),
      api('/sessions', { canvasId: 'mix-canvas' }),
    ]);
    expect(chat.status).toBe(200);
    expect([200, 409]).toContain(replaced.status);
    if (replaced.status === 409) expect(replaced.payload.reason).toBe('session_busy');
    const listed = await api('/sessions?canvasId=mix-canvas');
    expect(listed.status).toBe(200);
    expect(listed.payload.currentSessionId).toBeTruthy();
    const health = await api('/health');
    expect(health.status).toBe(200);
    expect(health.payload.sessions).toBe(1);
  });
}, 35000);

test('真实宿主：SIGTERM 释放活动会话后退出', async () => {
  await withHost(async ({ api, child, getLog }) => {
    const created = await api('/sessions', { canvasId: 'shutdown-canvas' });
    expect(created.status).toBe(200);
    const exited = new Promise((resolve) => child.once('close', resolve));
    child.kill('SIGTERM');
    const code = await Promise.race([exited, delay(3000).then(() => 'timeout')]);
    expect(code).not.toBe('timeout');
    expect(getLog()).toContain('关闭，释放');
  });
}, 35000);

test('真实宿主：补充指令在同一回合进入官方队列，重试不重复，刷新可追踪活动回合', async () => {
  await withHost(async ({ api, waitFor, getModelCalls, modelInputs }) => {
    const canvasId = 'steer-canvas';
    const session = await api('/sessions', { canvasId });
    const sessionId = session.payload.sessionId;
    const chat = api('/chat', { canvasId, sessionId, turnId: 'steerturn1', revisionBefore: 1, message: '制作字幕',
      skillSnapshot: { revision: 'test', userScope: '0'.repeat(64), skills: [] } });
    await waitFor(() => getModelCalls() === 1, 8000);
    const history = await api('/history?canvasId=' + canvasId);
    expect(history.payload.activeTurn.turnId).toBe('steerturn1');
    const body = { canvasId, sessionId, turnId: 'steerturn1', instructionId: 'i1', message: '字幕改成白色，其他继续' };
    expect((await api('/steer', body)).status).toBe(200);
    expect((await api('/steer', body)).status).toBe(200);
    expect((await api('/steer', { ...body, turnId: 'other' })).status).toBe(409);
    const result = await chat;
    expect(result.status).toBe(200);
    const events = result.text.trim().split('\n').map(line => JSON.parse(line));
    expect(events.find(e => e.type === 'turn_start').sessionId).toBe(sessionId);
    expect(events.find(e => e.type === 'instruction').instruction.state).toBe('received');
    expect(events.at(-1).instructions).toHaveLength(1);
    expect(events.at(-1).instructions[0].state).toBe('received');
    expect(getModelCalls()).toBe(2);
    expect(JSON.stringify(modelInputs[1].messages)).toContain(body.message);
    const completed = await api('/history?canvasId=' + canvasId);
    expect(completed.payload.activeTurn).toBeNull();
    expect(completed.payload.turns[0].instructions[0].state).toBe('received');
  });
}, 35000);

test('真实宿主：停止后未处理的补充指令保留，不进入下一回合', async () => {
  await withHost(async ({ api, waitFor, getModelCalls }) => {
    const canvasId = 'stopped-steer';
    const sessionId = (await api('/sessions', { canvasId })).payload.sessionId;
    const chat = api('/chat', { canvasId, sessionId, turnId: 'stopturn1', message: '制作', revisionBefore: 1,
      skillSnapshot: { revision: 'test', userScope: '0'.repeat(64), skills: [] } });
    await waitFor(() => getModelCalls() === 1, 8000);
    await api('/steer', { canvasId, sessionId, turnId: 'stopturn1', instructionId: 'i1', message: '不要遗失这个要求' });
    await api('/cancel', { canvasId });
    const result = await chat;
    const end = result.text.trim().split('\n').map(line => JSON.parse(line)).at(-1);
    expect(end.cancelled).toBe(true);
    expect(end.instructions[0].state).toBe('not_processed');
    const next = await api('/chat', { canvasId, sessionId, turnId: 'stopturn2', message: '新需求', revisionBefore: 1,
      skillSnapshot: { revision: 'test', userScope: '0'.repeat(64), skills: [] } });
    expect(next.status).toBe(200);
    expect(next.text.trim().split('\n').map(line => JSON.parse(line)).at(-1).instructions).toEqual([]);
  });
}, 35000);
