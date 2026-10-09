import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { visualFrameTimes } from '../visual-frames.mjs';
import { createVisualFrames } from '../visual-frames.mjs';
import { createProjectStore } from '../project-store.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('project video samples real timed frames and preserves explicit times; ASR source detects file changes', { skip: process.env.SEAL_MEDIA_READ_TEST !== '1' }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'seal-video-frames-'));
  const store = createProjectStore(root); const edit = await store.ensure('video-project');
  const visual = createVisualFrames(store); const owned = { history: { flush: async () => {} } };
  t.after(async () => { visual.close(); await fs.rm(root, { recursive: true, force: true }); });
  const directory = store.workDir(edit.editId); await fs.mkdir(path.join(directory,'assets'),{ recursive:true });
  const file = path.join(directory,'assets/video.mp4');
  await promisify(execFile)(process.env.PRODUCER_FFMPEG_PATH, ['-v','error','-f','lavfi','-i','testsrc2=size=160x90:rate=10:duration=1','-f','lavfi','-i','sine=frequency=440:duration=1','-c:v','libx264','-c:a','aac','-shortest',file],{ windowsHide:true });
  const bytes = await fs.readFile(file); const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  const html = `<html><body><div data-composition-id="main" data-duration="1"><video id="clip" class="clip" src="assets/video.mp4" data-start="2" data-duration="0.5" data-media-start="0.1" data-playback-rate="1.5" data-beeftv-resource-id="resource" data-beeftv-asset-id="asset" data-beeftv-resource-sha256="${digest}"></video></div></body></html>`;
  await fs.writeFile(path.join(directory,'index.html'),html);
  const result = await visual.read(edit.editId,{file:'assets/video.mp4'},owned);
  assert.equal(result.images.length,3); assert.equal(result.hasAudio,true); assert.equal(result.width,160);
  for (const image of result.images) assert.equal(Buffer.from(image.data,'base64').subarray(0,2).toString('hex'),'ffd8');
  assert.ok(result.images[2].time>result.images[1].time);
  const explicit=await visual.read(edit.editId,{file:'assets/video.mp4',times:[0.1,0.6],count:1},owned);
  assert.deepEqual(explicit.images.map(image=>image.time),[0.1,0.6]);
  const info=await visual.info(edit.editId,{file:'assets/video.mp4',expectedRevision:0},owned);
  assert.deepEqual(info.source,{resourceId:'resource',assetId:'asset',sha256:digest}); assert.equal(info.placements[0].sourceStart,0.1); assert.equal(info.placements[0].playbackRate,1.5);
  await assert.rejects(visual.read(edit.editId,{file:'assets/video.mp4',times:[10]},owned),{reason:'invalid_frame_time'});
  assert.equal((await fs.readdir(path.join(store.editDir(edit.editId),'visual'))).length,0);
  assert.deepEqual(await fs.readFile(file),bytes);
  await fs.appendFile(file,Buffer.from('changed'));
  await assert.rejects(visual.info(edit.editId,{file:'assets/video.mp4'},owned),{reason:'media_changed'});
});

test('selected clip timestamps use authored bounds, reject stale selection and invalid times', () => {
  const { document } = parseHTML('<html><body><div data-composition-id="main" data-duration="8"><video id="clip-a" class="clip" data-start="2" data-duration="4"></video><audio id="sound" class="clip" data-start="0" data-duration="2"></audio></div></body></html>');
  assert.deepEqual(visualFrameTimes(document, { clipIds: ['clip-a'] }), [4]);
  assert.deepEqual(visualFrameTimes(document, { time: 1.25 }), [1.25]);
  assert.ok(visualFrameTimes(document, { time: 8 })[0] < 8);
  assert.throws(() => visualFrameTimes(document, { clipIds: ['missing'] }), /已变化/);
  assert.throws(() => visualFrameTimes(document, { clipIds: ['sound'] }), /音频/);
  assert.throws(() => visualFrameTimes(document, { time: 9 }), /范围/);
});

test('actual pinned snapshot returns image pixels without changing the source or revision', { skip: process.env.SEAL_VISUAL_RENDER_TEST !== '1' }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'seal-visual-render-'));
  const store = createProjectStore(root);
  const edit = await store.ensure('fixture-project');
  const html = '<!doctype html><html><head><style>html,body{margin:0}#main{position:relative;width:640px;height:360px;background:#112233}#title{position:absolute;left:40px;top:80px;color:white;font:48px Arial}</style></head><body><div id="main" data-composition-id="main" data-width="640" data-height="360" data-duration="1" data-fps="30" data-no-timeline><div id="title" class="clip" data-start="0" data-duration="1" data-track-index="0">Seal</div></div></body></html>';
  const file = path.join(store.workDir(edit.editId), 'index.html');
  await fs.writeFile(file, html);
  const visual = createVisualFrames(store);
  t.after(async () => { visual.close(); await fs.rm(root, { recursive: true, force: true }); });
  const owned = { history: { flush: async () => {} } };
  const result = await visual.read(edit.editId, { time: 0.25, expectedRevision: 0 }, owned);
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].time, 0.25);
  assert.equal(Buffer.from(result.images[0].data, 'base64').subarray(0, 2).toString('hex'), 'ffd8');
  assert.equal(await fs.readFile(file, 'utf8'), html);
  assert.equal((await store.state(edit.editId)).revision, 0);
  assert.equal((await fs.readdir(path.join(store.editDir(edit.editId), 'visual'))).length, 0);
  await assert.rejects(visual.read(edit.editId, { time: 0.25, expectedRevision: 1 }, owned), { reason: 'revision_conflict' });
  await assert.rejects(visual.read(edit.editId, { file: '../private.png' }, owned), { reason: 'media_not_found' });
});
