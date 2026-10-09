import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyRuntime, NODE_VERSION } from './package-agent-host.mjs';
import { verifyLocalAsrRuntime } from './package-local-asr.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const HYPIT_COMMIT = '7f730abf72fa1e4a543eed8cd1807319d9f18196';
const modules = ['bundled-runtime.mjs', 'hyperframes.mjs', 'hyperframes-media-clock.mjs', 'hypit-audio.mjs', 'hypit-inputs.mjs', 'hypit-production-worker.mjs',
  'hypit-productions.mjs', 'hypit-scenes.mjs', 'hyperframes-scenes.mjs', 'library-media.mjs', 'project-store.mjs', 'render-snapshots.mjs',
  'render-worker.mjs', 'render-workers.mjs', 'saved-exports.mjs', 'starter.mjs', 'studio-gateway.mjs', 'studio-localization.mjs',
  'studio-product.mjs', 'studio-product-source.mjs', 'studio-product-client.js', 'studio-product.css',
  'visual-frames.mjs', 'studio-product-icons.json', 'studio-icons-LICENSE.txt', 'studio-ui-sans.woff2', 'studio-ui-mono.woff2',
  'studio-font-sans-LICENSE.txt', 'studio-font-mono-LICENSE.txt'];
const targets = { 'windows/amd64': ['win32', 'x64'], 'darwin/amd64': ['darwin', 'x64'], 'darwin/arm64': ['darwin', 'arm64'] };
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 180000, windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`${path.basename(command)} failed: ${result.error?.message || result.stderr || result.stdout}`);
  return result.stdout.trim();
}
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function verifyEditInputs({ runtime, target, hypitRoot, browserRoot, ffmpegRoot, asrRoot }) {
  const node = verifyRuntime(runtime, target), [platform, arch] = targets[target];
  for (const [name, value] of Object.entries({ hypitRoot, browserRoot, ffmpegRoot })) if (!value) throw new Error(name + ' is required for the editing release');
  if (run('git', ['rev-parse', 'HEAD'], hypitRoot) !== HYPIT_COMMIT
    || run('git', ['status', '--porcelain', '--', 'skills/hypit'], hypitRoot)) throw new Error('Official Hypit Skill must match the pinned clean commit');
  if (!fs.existsSync(path.join(hypitRoot, 'skills/hypit/SKILL.md'))) throw new Error('Official Hypit Skill is missing');
  const browser = path.join(browserRoot, platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell');
  const ffmpeg = path.join(ffmpegRoot, 'bin', platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  const ffprobe = path.join(ffmpegRoot, 'bin', platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
  for (const file of [browser, ffmpeg, ffprobe, path.join(ffmpegRoot, 'LICENSE')]) if (!fs.existsSync(file)) throw new Error('Missing editing runtime file: ' + file);
  const browserVersion = run(browser, ['--version']);
  if (!browserVersion.includes('153.0.8010.36')) throw new Error('Editing release requires Chrome Headless Shell 153.0.8010.36');
  const ffmpegVersion = run(ffmpeg, ['-version']).split('\n')[0].trim(), ffprobeVersion = run(ffprobe, ['-version']).split('\n')[0].trim();
  if (platform === 'darwin') {
    for (const executable of [ffmpeg, ffprobe]) {
      const links = run('/usr/bin/otool', ['-L', executable]).split('\n').slice(1).map(line => line.trim().split(' ')[0]).filter(Boolean);
      if (links.some(link => !link.startsWith('/usr/lib/') && !link.startsWith('/System/'))) throw new Error('FFmpeg release tools require a portable build without non-system dylibs');
    }
  }
  return { node, platform, arch, browserVersion, ffmpegVersion, ffprobeVersion };
}
export function packageEditHost(options) {
  const { runtime, target, hypitRoot, browserRoot, ffmpegRoot, destination, source = path.join(repo, 'edit-host') } = options;
  const inputs = verifyEditInputs(options);
  const asrManifest = verifyLocalAsrRuntime(options.asrRoot, target);
  if (!destination || fs.existsSync(destination)) throw new Error('A new edit-host destination is required');
  if (!process.versions.bun) throw new Error('Run editing packaging with Bun and its frozen lockfile');
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'beeftv editing package '));
  const editing = path.join(stage, 'edit-host'); fs.mkdirSync(editing);
  try {
    for (const name of ['server.mjs', 'studio-client.js', 'package.json', 'bun.lock', ...modules]) fs.copyFileSync(path.join(source, name), path.join(editing, name));
    if (fs.existsSync(path.join(source, 'patches'))) fs.cpSync(path.join(source, 'patches'), path.join(editing, 'patches'), { recursive: true });
    run(process.execPath, ['install', '--production', '--frozen-lockfile', '--backend', 'copyfile', '--network-concurrency', '4', '--os', inputs.platform, '--cpu', inputs.arch], editing);
    const hypit = path.join(editing, 'node_modules/@hypit/hypit');
    // Only committed Skill files are included; ignored local credentials and scratch files are not release inputs.
    const skillFiles = run('git', ['ls-files', '-z', '--', 'skills/hypit'], hypitRoot).split('\0').filter(Boolean);
    for (const relative of skillFiles) {
      const original = path.join(hypitRoot, relative), copy = path.join(hypit, relative);
      if (!fs.lstatSync(original).isFile()) throw new Error('Official Skill input must be a regular file: ' + relative);
      fs.mkdirSync(path.dirname(copy), { recursive: true }); fs.copyFileSync(original, copy);
    }
    fs.mkdirSync(path.join(stage, 'agent-host'));
    fs.copyFileSync(path.join(repo, 'agent-host/hypit-distribution.mjs'), path.join(stage, 'agent-host/hypit-distribution.mjs'));
    const nodeFile = inputs.platform === 'win32' ? 'runtime/node.exe' : 'runtime/bin/node';
    fs.mkdirSync(path.dirname(path.join(editing, nodeFile)), { recursive: true });
    fs.copyFileSync(inputs.node, path.join(editing, nodeFile)); fs.chmodSync(path.join(editing, nodeFile), 0o755);
    fs.copyFileSync(path.join(runtime, 'LICENSE'), path.join(editing, 'runtime/NODE-LICENSE'));
    fs.cpSync(browserRoot, path.join(editing, 'media/browser'), { recursive: true, dereference: true });
    fs.cpSync(path.join(ffmpegRoot, 'bin'), path.join(editing, 'media/ffmpeg/bin'), { recursive: true, dereference: true });
    fs.cpSync(options.asrRoot, path.join(editing, 'media/asr'), { recursive: true, dereference: true });
    fs.copyFileSync(path.join(ffmpegRoot, 'LICENSE'), path.join(editing, 'media/ffmpeg/LICENSE'));
    if (fs.existsSync(path.join(ffmpegRoot, 'README.txt'))) fs.copyFileSync(path.join(ffmpegRoot, 'README.txt'), path.join(editing, 'media/ffmpeg/README.txt'));
    const manifest = { format: 'beeftv.edit-runtime@1', platform: inputs.platform, arch: inputs.arch, nodeVersion: NODE_VERSION,
      hyperframesVersion: '0.8.130', hypitVersion: '0.2.17', hypitSkillCommit: HYPIT_COMMIT,
      asr: { version: asrManifest.version, model: asrManifest.model.name, modelSHA256: asrManifest.model.sha256 } };
    for (const [name, relative, version] of [['browser', `media/browser/chrome-headless-shell${inputs.platform === 'win32' ? '.exe' : ''}`, inputs.browserVersion],
      ['ffmpeg', `media/ffmpeg/bin/ffmpeg${inputs.platform === 'win32' ? '.exe' : ''}`, inputs.ffmpegVersion],
      ['ffprobe', `media/ffmpeg/bin/ffprobe${inputs.platform === 'win32' ? '.exe' : ''}`, inputs.ffprobeVersion]]) {
      manifest[name] = { file: relative, version, sha256: hash(path.join(editing, relative)) };
    }
    fs.writeFileSync(path.join(editing, 'runtime-manifest.json'), JSON.stringify(manifest, null, 2));
    const bundled = path.join(editing, nodeFile);
    const imports = modules.filter(name => name.endsWith('.mjs') && !name.endsWith('-worker.mjs')).map(name => `await import(${JSON.stringify('./' + name)});`).join('\n');
    run(bundled, ['--input-type=module', '-e', imports + '\nconst {configureBundledRuntime}=await import("./bundled-runtime.mjs");configureBundledRuntime();'], editing);
    run(bundled, [path.join(hypit, 'bin/hypit.mjs'), '--version'], editing);
    fs.cpSync(editing, destination, { recursive: true, dereference: true });
    console.log(`Packaged editing runtime for ${target}: ${destination}`);
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [target, destination] = process.argv.slice(2);
    const options = { target, destination, runtime: process.env.BEEFTV_NODE_RUNTIME, hypitRoot: process.env.BEEFTV_HYPIT_ROOT,
      browserRoot: process.env.BEEFTV_EDIT_BROWSER_ROOT, ffmpegRoot: process.env.BEEFTV_EDIT_FFMPEG_ROOT, asrRoot: process.env.BEEFTV_ASR_RUNTIME };
    if (destination === '--verify-inputs') verifyEditInputs(options); else packageEditHost(options);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
