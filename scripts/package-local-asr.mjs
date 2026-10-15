import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ASR_VERSION = '1.9.2';
export const BASE_MODEL_SHA256 = '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe';
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

export function verifyLocalAsrRuntime(root, target) {
  if (!root) throw new Error('BEEFTV_ASR_RUNTIME is required for local recognition packaging');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'runtime-manifest.json'), 'utf8'));
  if (manifest.format !== 'beeftv.local-asr@1' || manifest.target !== target || manifest.version !== ASR_VERSION || manifest.model.sha256 !== BASE_MODEL_SHA256) throw new Error('ASR runtime target/version mismatch');
  for (const [relative, expected] of Object.entries(manifest.files)) {
    const file = path.resolve(root, relative);
    if (!file.startsWith(path.resolve(root) + path.sep) || !fs.lstatSync(file).isFile() || hash(file) !== expected) throw new Error('ASR runtime digest mismatch: ' + relative);
  }
  const version = execFileSync(path.join(root, manifest.executable), ['--version'], { encoding: 'utf8', windowsHide: true });
  if (!version.includes(`version: ${ASR_VERSION}`)) throw new Error('ASR executable does not match the pinned release');
  return manifest;
}

export function packageLocalAsr({ binRoot, model, license, destination, target = 'windows/amd64' }) {
  if (!['windows/amd64', 'darwin/arm64', 'darwin/amd64'].includes(target)) throw new Error('Unsupported ASR runtime target');
  const darwin = target.startsWith('darwin/');
  if (darwin && (process.platform !== 'darwin' || process.arch !== (target.endsWith('/amd64') ? 'x64' : 'arm64'))) throw new Error('Package macOS ASR on a matching native runner');
  if (!destination || fs.existsSync(destination)) throw new Error('Use a new ASR runtime destination');
  if (hash(model) !== BASE_MODEL_SHA256) throw new Error('Whisper Base model digest mismatch');
  const executableName = darwin ? 'whisper-cli' : 'whisper-cli.exe';
  const executable = path.join(binRoot, executableName);
  const version = execFileSync(executable, ['--version'], { encoding: 'utf8', windowsHide: true });
  if (!version.includes(`version: ${ASR_VERSION}`)) throw new Error('Use the pinned whisper.cpp CPU release');
  fs.mkdirSync(path.join(destination, 'bin'), { recursive: true }); fs.mkdirSync(path.join(destination, 'models'));
  for (const name of fs.readdirSync(binRoot)) {
    if (name === executableName || (!darwin && /^(whisper|ggml.*)\.dll$/i.test(name))) fs.copyFileSync(path.join(binRoot, name), path.join(destination, 'bin', name));
  }
  if (darwin) fs.chmodSync(path.join(destination, 'bin', executableName), 0o755);
  fs.copyFileSync(model, path.join(destination, 'models/ggml-base.bin'));
  fs.copyFileSync(license, path.join(destination, 'WHISPER-LICENSE'));
  const manifest = { format: 'beeftv.local-asr@1', target, version: ASR_VERSION, executable: `bin/${executableName}`,
    origin: 'https://github.com/ggml-org/whisper.cpp/releases/tag/v1.9.2',
    model: { name: 'Whisper Base multilingual', file: 'models/ggml-base.bin', size: 147951465, sha256: BASE_MODEL_SHA256,
      origin: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.bin' }, files: {} };
  function walk(dir) { for (const item of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, item.name); if (item.isDirectory()) walk(file); else manifest.files[path.relative(destination, file).replaceAll('\\', '/')] = hash(file); } }
  walk(destination);
  fs.writeFileSync(path.join(destination, 'runtime-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return verifyLocalAsrRuntime(destination, target);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [binRoot, model, license, destination, target = 'windows/amd64'] = process.argv.slice(2);
  const manifest = packageLocalAsr({ binRoot, model, license, destination, target });
  console.log(JSON.stringify({ target: manifest.target, version: manifest.version, modelBytes: manifest.model.size, files: Object.keys(manifest.files).length }));
}
