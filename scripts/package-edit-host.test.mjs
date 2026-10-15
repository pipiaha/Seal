import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { verifyEditInputs } from './package-edit-host.mjs';
import { fixture } from '../edit-host/test/author-fixture.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = promisify(execFile);
test('editing packaging rejects missing or mismatched release dependencies', () => {
  assert.throws(() => verifyEditInputs({ target: 'windows/amd64' }), /required/);
  if (process.env.BEEFTV_NODE_RUNTIME) assert.throws(() => verifyEditInputs({ runtime: process.env.BEEFTV_NODE_RUNTIME, target: process.platform === 'win32' ? 'windows/amd64' : `darwin/${process.arch === 'x64' ? 'amd64' : 'arm64'}` }), /hypitRoot is required/);
});

test('shipped Node, Hypit, Skill, Studio, browser and codecs build and export with empty PATH', {
  skip: !process.env.BEEFTV_SHIPPED_EDIT_HOST && (!process.env.BEEFTV_TEST_BUN || !process.env.BEEFTV_NODE_RUNTIME || !process.env.BEEFTV_EDIT_BROWSER_ROOT || !process.env.BEEFTV_EDIT_FFMPEG_ROOT || !process.env.BEEFTV_HYPIT_ROOT || !process.env.BEEFTV_ASR_RUNTIME),
  timeout: 300000,
}, async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'beeftv shipped editing '));
  const target = process.platform === 'win32' ? 'windows/amd64' : `darwin/${process.arch === 'x64' ? 'amd64' : 'arm64'}`;
  const destination = path.join(temporary, 'application with spaces', 'edit-host');
  const ffmpegRelative = `media/ffmpeg/bin/ffmpeg${process.platform === 'win32' ? '.exe' : ''}`;
  const ffprobeRelative = `media/ffmpeg/bin/ffprobe${process.platform === 'win32' ? '.exe' : ''}`;
  const node = path.join(destination, process.platform === 'win32' ? 'runtime/node.exe' : 'runtime/bin/node');
  let child, exited, log = '', base;
  t.after(async () => {
    if (child && child.exitCode === null) {
      child.stdin.end(); await Promise.race([exited, delay(5000)]);
      if (child.exitCode === null) { child.kill(); await exited; }
    }
    await fs.rm(temporary, { recursive: true, force: true });
  });
  if (process.env.BEEFTV_SHIPPED_EDIT_HOST) await fs.cp(process.env.BEEFTV_SHIPPED_EDIT_HOST, destination, { recursive: true });
  else await run(process.env.BEEFTV_TEST_BUN, [path.join(repo, 'scripts/package-edit-host.mjs'), target, destination], { cwd: repo, timeout: 180000, windowsHide: true });
  // The actual product ships this adjacent Agent module. No link back to the checkout is used.
  await fs.mkdir(path.join(destination, '../agent-host'), { recursive: true });
  await fs.copyFile(path.join(repo, 'agent-host/hypit-distribution.mjs'), path.join(destination, '../agent-host/hypit-distribution.mjs'));
  const emptyHome = path.join(temporary, 'empty home'); await fs.mkdir(emptyHome);
  const environment = { PATH: '', HOME: emptyHome, USERPROFILE: emptyHome, TEMP: temporary, TMP: temporary,
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    BEEFTV_EDIT_DATA_DIR: path.join(temporary, 'data'), BEEFTV_EDIT_HOST_TOKEN: 'synthetic-editing-only', BEEFTV_EDIT_LIFETIME_STDIN: '1', HYPERFRAMES_TELEMETRY_DISABLED: '1' };
  child = spawn(node, ['server.mjs'], { cwd: destination, env: environment, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  exited = new Promise(resolve => child.once('close', resolve));
  child.stdout.on('data', bytes => {
    log += bytes;
    for (const line of log.split('\n')) try { const value = JSON.parse(line); if (value.endpoint) base = value.endpoint; } catch {}
  });
  child.stderr.on('data', bytes => { log += bytes; });
  child.on('error', error => { log += error.message; });
  const startDeadline = Date.now() + 15000;
  while (!base && child.exitCode === null && Date.now() < startDeadline) await delay(100);
  assert.ok(base, log);
  async function api(route, body, metadata) {
    const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'X-Beeftv-Edit-Host': environment.BEEFTV_EDIT_HOST_TOKEN, 'Content-Type': metadata ? 'application/octet-stream' : 'application/json',
        ...(metadata ? { 'X-Beeftv-Media-Metadata': Buffer.from(JSON.stringify(metadata)).toString('base64') } : {}) },
      body: metadata ? body : body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    const text = await response.text(); assert.equal(response.status, 200, text + log.slice(-2000)); return JSON.parse(text).data;
  }
  const edit = await api('/production/open', { projectId: 'shipped_edit' });
  assert.equal(edit.hypitVersion, '0.2.17');
  const prefix = `/edits/${edit.editId}/`, route = action => prefix + action + '?projectId=shipped_edit';
  const skill = await api(route('hypit/read'), { area: 'skill', file: 'SKILL.md' }); assert.match(skill.content, /name: hypit/);
  const { stdout: png } = await run(path.join(destination, ffmpegRelative), ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x96', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'], { env: environment, encoding: 'buffer', windowsHide: true });
  const input = await api(route('hypit/assets/import'), png, { assetId: 'product', resourceId: 'product-resource', kind: 'image', mimeType: 'image/png', size: png.length, width: 64, height: 96, expectedRevision: 0, operationId: 'shipped_input' });
  const frames = await api(route('hypit/frames'), { inputId: input.inputId }); assert.ok(frames.frames[0].data.length > 100);
  for (const [file, text] of Object.entries(fixture)) await api(route('hypit/write'), { file, text: text.replace('__INPUT__', './' + input.file), expectedHash: null, operationId: 'shipped_source_' + Object.keys(fixture).indexOf(file) });
  const sized = await api(route('mutate'), { expectedRevision: 0, operationId: 'shipped_dimensions', route: 'file-mutations/patch-element/index.html', payload: { target: { id: 'main' }, operations: [
    { type: 'attribute', property: 'data-width', value: '320' }, { type: 'attribute', property: 'data-height', value: '480' },
  ] } });
  const job = await api(route('hypit/start'), { command: 'build', source: 'main.svrun', expectedRevision: sized.revision, operationId: 'shipped_build' });
  let state = job; const deadline = Date.now() + 90000;
  while (state.status === 'running' && Date.now() < deadline) { await delay(200); state = await api(route('hypit/status'), { jobId: job.jobId }); }
  assert.equal(state.status, 'complete', JSON.stringify(state));
  const candidate = await api(route('hypit/publish'), { jobId: job.jobId });
  const added = await api(route('promote'), { candidateId: candidate.candidateId, operationId: 'shipped_promote', actor: 'person' });
  const studio = await api('/open', { projectId: 'shipped_edit', parentOrigin: 'http://127.0.0.1:5173' });
  const launch = await fetch(studio.studioUrl + '/__session', { method: 'POST', headers: { Origin: 'http://127.0.0.1:5173' }, body: new URLSearchParams({ ticket: studio.ticket }), redirect: 'manual' });
  const cookie = launch.headers.get('set-cookie').split(';')[0];
  const rendering = await fetch(`${studio.studioUrl}/api/projects/${edit.editId}/render`, { method: 'POST', headers: { Cookie: cookie, Origin: studio.studioUrl,
    'Content-Type': 'application/json', 'X-Beeftv-Edit-Revision': String(added.revision), 'X-Beeftv-Operation': 'shipped_render' }, body: JSON.stringify({ fps: 30, quality: 'draft', format: 'mp4', telemetryOptOut: true }) });
  assert.equal(rendering.status, 200, await rendering.clone().text());
  const render = await rendering.json();
  const progress = await fetch(`${studio.studioUrl}/api/render/${render.jobId}/progress`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(120000) });
  assert.match(await progress.text(), /"status":"complete"/);
  const result = await fetch(base + route(`exports/${render.exportId}/file`), { headers: { 'X-Beeftv-Edit-Host': environment.BEEFTV_EDIT_HOST_TOKEN } });
  assert.equal(result.status, 200);
  const output = path.join(temporary, 'shipped.mp4'); await fs.writeFile(output, Buffer.from(await result.arrayBuffer()));
  const { stdout: probe } = await run(path.join(destination, ffprobeRelative), ['-v', 'error', '-show_streams', '-of', 'json', output], { env: environment, windowsHide: true });
  const video = JSON.parse(probe).streams.find(stream => stream.codec_type === 'video');
  assert.equal(video.width, 320); assert.equal(video.height, 480); assert.equal(Number(video.nb_frames), 90);
  if (process.env.BEEFTV_TEST_PACKAGE_ARTIFACT_DIR) {
    await fs.mkdir(process.env.BEEFTV_TEST_PACKAGE_ARTIFACT_DIR, { recursive: true });
    await fs.copyFile(output, path.join(process.env.BEEFTV_TEST_PACKAGE_ARTIFACT_DIR, 'shipped-hypit.mp4'));
    await fs.copyFile(path.join(destination, 'runtime-manifest.json'), path.join(process.env.BEEFTV_TEST_PACKAGE_ARTIFACT_DIR, 'runtime-manifest.json'));
  }
});
