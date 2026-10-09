import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseHTML } from 'linkedom';
import { failure, sourcePath, assertPlainTree } from './project-store.mjs';
import { hyperframesCLI } from './hyperframes.mjs';

const run = promisify(execFile);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export function visualFrameTimes(document, input) {
  const duration = Number(document.querySelector('[data-composition-id]')?.getAttribute('data-duration'));
  if (!Number.isFinite(duration) || duration <= 0) throw failure('visual_empty_project', '工程尚未包含可预览画面');
  const ids = input.clipIds || [];
  if (!Array.isArray(ids) || ids.length > 4 || ids.some(id => typeof id !== 'string' || id.length > 256)) throw failure('invalid_selection', '一次最多检查 4 个片段');
  if (ids.length) return [...new Set(ids.map(id => {
    const node = [...document.querySelectorAll('.clip')].find(node => node.id === id || node.getAttribute('data-hf-id') === id);
    if (!node) throw failure('clip_not_found', '选中片段已变化，请重新选择');
    if (node.tagName === 'AUDIO') throw failure('visual_input_required', '音频片段没有画面，请使用语音识别');
    const start = Number(node.getAttribute('data-start'));
    const length = Number(node.getAttribute('data-duration'));
    if (!Number.isFinite(start) || !Number.isFinite(length) || length <= 0) throw failure('invalid_clip_time', '片段时间无效');
    return Math.max(0, Math.min(duration - 1 / 120, start + length / 2));
  }))];
  if (!Number.isFinite(input.time) || input.time < 0 || input.time > duration) throw failure('invalid_frame_time', '请指定工程范围内的画面时间');
  return [Math.max(0, Math.min(duration - 1 / 120, input.time))];
}

export function createVisualFrames(store) {
  let pending = 0;
  const tasks = new Set();
  function execute(command, args, options = {}) {
    const task = run(command, args, { timeout: 90_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, ...options });
    tasks.add(task.child);
    return task.finally(() => tasks.delete(task.child));
  }
  async function jpeg(file, time) {
    const { stdout } = await execute(process.env.PRODUCER_FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-nostdin', '-protocol_whitelist', 'file,pipe',
      ...(time !== undefined ? ['-ss', String(time)] : []), '-i', file, '-frames:v', '1', '-vf', 'scale=2048:2048:force_original_aspect_ratio=decrease', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '3', 'pipe:1'], { encoding: 'buffer' });
    if (!stdout.length || stdout.length > 2 * 1024 * 1024) throw failure('frame_unavailable', '无法读取画面或图片过大');
    return { mimeType: 'image/jpeg', data: stdout.toString('base64') };
  }
  async function probe(file) {
    const ffmpeg = process.env.PRODUCER_FFMPEG_PATH;
    const executable = process.env.PRODUCER_FFPROBE_PATH || (ffmpeg && path.isAbsolute(ffmpeg) ? path.join(path.dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe') : 'ffprobe');
    const { stdout } = await execute(executable, ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_entries', 'format=duration:stream=codec_type,width,height,duration,avg_frame_rate', '-of', 'json', file], { encoding: 'utf8' });
    const metadata = JSON.parse(stdout);
    const streams = metadata.streams || [];
    const duration = Number(metadata.format?.duration || streams.find(stream => Number(stream.duration) > 0)?.duration || 0);
    const rate = streams.find(stream => stream.codec_type === 'video')?.avg_frame_rate?.split('/').map(Number) || [];
    const frameStep = rate[0] > 0 && rate[1] > 0 ? Math.max(0.05,rate[1]/rate[0]) : 0.05;
    return { duration, frameStep, width: streams.find(stream => stream.codec_type === 'video')?.width || 0,
      height: streams.find(stream => stream.codec_type === 'video')?.height || 0, hasAudio: streams.some(stream => stream.codec_type === 'audio') };
  }
  async function info(editId, input, owned) {
    return store.locked(editId, async () => {
      await owned.history.flush(); await assertPlainTree(store.workDir(editId));
      if (typeof input.file !== 'string' || !/\.(mp4|mov|m4v|webm|mkv|mp3|wav|m4a|ogg|aac|flac)$/i.test(input.file)) throw failure('unsupported_media', '请选择工程内的视频或音频');
      const file = sourcePath(store.workDir(editId), input.file);
      const metadata = await probe(file);
      const { document } = parseHTML(await fs.readFile(path.join(store.workDir(editId), 'index.html'), 'utf8'));
      const clips = [...document.querySelectorAll('.clip[src]')].filter(node => node.getAttribute('src').replace(/^\.\//, '') === input.file);
      const original = clips.find(node => node.getAttribute('data-beeftv-resource-id') && node.getAttribute('data-beeftv-resource-sha256'));
      let source = null;
      if (original) {
        if (sha(await fs.readFile(file)) !== original.getAttribute('data-beeftv-resource-sha256')) throw failure('media_changed', '工程中的文件已变化，请先将当前版本保存到资产库再转写', 409);
        source = { resourceId: original.getAttribute('data-beeftv-resource-id'), assetId: original.getAttribute('data-beeftv-asset-id'), sha256: original.getAttribute('data-beeftv-resource-sha256') };
      }
      const state = await store.state(editId);
      if (input.expectedRevision !== undefined && input.expectedRevision !== state.revision) throw failure('revision_conflict', '工程已变化，请重新读取', 409);
      return { editId, revision: state.revision, file: input.file, ...metadata, source,
        placements: clips.map(node => ({ clipId: node.id, start: Number(node.getAttribute('data-start') || 0), duration: Number(node.getAttribute('data-duration') || 0),
          sourceStart: Number(node.getAttribute('data-media-start') || 0), playbackRate: Number(node.getAttribute('data-playback-rate') || 1), automation: node.getAttribute('data-automation') })),
        timing: '转写及素材抽帧的时间是原素材时间，不是时间线时间；按片段入点、速度和变速曲线映射，不能直接当字幕落点。' };
    });
  }
  async function read(editId, input, owned) {
    if (pending) throw failure('visual_busy', '正在读取画面，请稍候重试', 409);
    pending++;
    let directory;
    try {
      const frozen = await store.locked(editId, async () => {
        await owned.history.flush();
        const state = await store.state(editId);
        if (input.expectedRevision !== undefined && input.expectedRevision !== state.revision) throw failure('revision_conflict', '工程发生变化，请重新读取画面', 409);
        await assertPlainTree(store.workDir(editId));
        const { document } = parseHTML(await fs.readFile(path.join(store.workDir(editId), 'index.html'), 'utf8'));
        const times = input.file ? [] : visualFrameTimes(document, input);
        if (input.file && (typeof input.file !== 'string' || !/\.(png|jpe?g|webp|gif|avif|mp4|mov|m4v|webm|mkv)$/i.test(input.file))) throw failure('visual_input_required', '请选择工程内的图片或视频');
        const files = await store.snapshot(editId);
        if (input.file && !files[input.file]) throw failure('media_not_found', '素材不属于当前工程', 404);
        const root = path.join(store.editDir(editId), 'visual');
        await fs.mkdir(root, { recursive: true });
        directory = await fs.mkdtemp(path.join(root, 'read-'));
        const project = path.join(directory, 'project');
        for (const [file, digest] of Object.entries(files)) {
          if (input.file && file !== input.file) continue;
          const bytes = await fs.readFile(path.join(store.root, 'blobs', digest));
          if (sha(bytes) !== digest) throw failure('checkpoint_changed', '画面快照发生变化', 409);
          const target = sourcePath(project, file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, bytes);
        }
        return { project, times, revision: state.revision };
      });
      if (input.file) {
        const file = sourcePath(frozen.project, input.file);
        const video = /\.(mp4|mov|m4v|webm|mkv)$/i.test(input.file);
        const metadata = video ? await probe(file) : {};
        const count = input.count ?? 3;
        if (!Number.isInteger(count) || count < 1 || count > 8) throw failure('invalid_frame_count', '一次读取 1 到 8 个时间点');
        const times = video ? input.times || (input.time !== undefined ? [input.time] : Array.from({ length: count }, (_, i) => count === 1 ? 0 : Math.max(0, metadata.duration - metadata.frameStep) * i / (count - 1))) : [0];
        if (!Array.isArray(times) || !times.length || times.length > 8 || times.some(time => !Number.isFinite(time) || time < 0 || video && time >= metadata.duration)) throw failure('invalid_frame_time', '素材时间点超出范围或数量过多');
        const images = [];
        for (const time of times) images.push({ ...await jpeg(file, video ? time : undefined), time, file: input.file });
        return { editId, revision: frozen.revision, file: input.file, ...metadata, images,
          coverage: '仅查看这些原素材时间点，不能据此声称整段视频都已检查。声音需另用 edit_transcribe，ASR 不代表已理解音乐和音效。' };
      }
      const output = path.join(directory, 'frames');
      await execute(process.execPath, [hyperframesCLI, 'snapshot', frozen.project, '--at', frozen.times.join(','), '--no-end', '--output', output], {
        cwd: frozen.project, env: { ...process.env, HYPERFRAMES_SKIP_SKILLS: '1', HYPERFRAMES_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1' } });
      const names = (await fs.readdir(output)).filter(name => /^frame-.*\.png$/.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      if (names.length !== frozen.times.length) throw failure('frame_unavailable', '截图没有完整生成，请重新检查');
      const images = [];
      for (let i = 0; i < names.length; i++) images.push({ ...await jpeg(path.join(output, names[i])), time: frozen.times[i], file: 'index.html' });
      return { editId, revision: frozen.revision, clipIds: input.clipIds || [], images };
    } finally {
      if (directory) await fs.rm(directory, { recursive: true, force: true });
      pending--;
    }
  }
  return { read, info, busy: () => pending + tasks.size, close: () => { for (const child of tasks) child.kill(); } };
}
