#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ "$(uname -s)" == Darwin ]] || { echo 'Use a native macOS runner' >&2; exit 1; }
ARCH="$(uname -m)"
[[ "$ARCH" != x86_64 ]] || ARCH=amd64
TARGET="darwin/$ARCH"
CACHE="$ROOT_DIR/.local/cache/seal-macos-runtime-$ARCH"
[[ ! -e "$CACHE" ]] || { echo 'Runtime staging directory must be new' >&2; exit 1; }
mkdir -p "$CACHE/downloads" "$CACHE/ffmpeg/bin"
export SEAL_MAC_RUNTIME_CACHE="$CACHE" SEAL_MAC_RUNTIME_ARCH="$ARCH"

# Browser generation and checksum are pinned to Google's stored object;
# FFmpeg and model downloads use upstream SHA-256 digests.
python3 - <<'PY'
import hashlib, json, os, pathlib, urllib.request, zipfile
root = pathlib.Path(os.environ['SEAL_MAC_RUNTIME_CACHE'])
pin = json.loads(pathlib.Path('release/macos-runtime.json').read_text())
platform = pin['platforms'][os.environ['SEAL_MAC_RUNTIME_ARCH']]
def download(item, output):
    with urllib.request.urlopen(item['url'], timeout=120) as response, output.open('wb') as file:
        while chunk := response.read(1024 * 1024):
            file.write(chunk)
    algorithm = 'sha256' if 'sha256' in item else 'md5'
    if hashlib.file_digest(output.open('rb'), algorithm).hexdigest() != item[algorithm]:
        raise RuntimeError('Runtime download digest mismatch: ' + output.name)
download(platform['browser'], root / 'downloads/browser.zip')
with zipfile.ZipFile(root / 'downloads/browser.zip') as archive:
    for entry in archive.infolist():
        if not (root / entry.filename).resolve().is_relative_to(root):
            raise RuntimeError('Unsafe browser archive path')
    archive.extractall(root)
    for entry in archive.infolist():
        mode = entry.external_attr >> 16
        if mode:
            (root / entry.filename).chmod(mode & 0o777)
for name in ['ffmpeg', 'ffprobe']:
    download(platform[name], root / 'ffmpeg/bin' / name)
    (root / 'ffmpeg/bin' / name).chmod(0o755)
download(platform['license'], root / 'ffmpeg/LICENSE')
download(platform['readme'], root / 'ffmpeg/README.txt')
download(pin['whisperModel'], root / 'ggml-base.bin')
PY

WHISPER_COMMIT="$(node -p 'JSON.parse(require("fs").readFileSync("release/macos-runtime.json")).whisperCommit')"
git init "$CACHE/whisper"
git -C "$CACHE/whisper" remote add origin https://github.com/ggml-org/whisper.cpp.git
git -C "$CACHE/whisper" fetch --depth 1 origin "$WHISPER_COMMIT"
git -C "$CACHE/whisper" checkout --detach FETCH_HEAD
cmake -S "$CACHE/whisper" -B "$CACHE/whisper/build" -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF -DGGML_METAL=OFF -DGGML_BLAS=OFF -DGGML_NATIVE=OFF \
  -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF -DCMAKE_OSX_DEPLOYMENT_TARGET=12.0
cmake --build "$CACHE/whisper/build" --config Release --target whisper-cli -j 3
bun scripts/package-local-asr.mjs "$CACHE/whisper/build/bin" "$CACHE/ggml-base.bin" \
  "$CACHE/whisper/LICENSE" "$CACHE/asr" "$TARGET"
# Verify actual recognition, not just the executable version.
"$CACHE/asr/bin/whisper-cli" -m "$CACHE/asr/models/ggml-base.bin" \
  -f "$CACHE/whisper/samples/jfk.wav" -otxt -of "$CACHE/asr-smoke" -l en -t 2
grep -iq 'ask not' "$CACHE/asr-smoke.txt"

CHROME_PLATFORM=mac-arm64
[[ "$ARCH" != amd64 ]] || CHROME_PLATFORM=mac-x64
export BEEFTV_EDIT_BROWSER_ROOT="$CACHE/chrome-headless-shell-$CHROME_PLATFORM"
export BEEFTV_EDIT_FFMPEG_ROOT="$CACHE/ffmpeg"
export BEEFTV_ASR_RUNTIME="$CACHE/asr"
for binary in "$BEEFTV_ASR_RUNTIME/bin/whisper-cli" "$CACHE/ffmpeg/bin/ffmpeg" "$CACHE/ffmpeg/bin/ffprobe"; do
  if /usr/bin/otool -L "$binary" | tail -n +2 | awk '{print $1}' | grep -Ev '^(/usr/lib/|/System/|$)'; then
    echo "Non-system dynamic library in $binary" >&2; exit 1
  fi
done
if [[ -n "${GITHUB_ENV:-}" ]]; then
  printf 'BEEFTV_EDIT_BROWSER_ROOT=%s\nBEEFTV_EDIT_FFMPEG_ROOT=%s\nBEEFTV_ASR_RUNTIME=%s\n' \
    "$BEEFTV_EDIT_BROWSER_ROOT" "$BEEFTV_EDIT_FFMPEG_ROOT" "$BEEFTV_ASR_RUNTIME" >> "$GITHUB_ENV"
fi
echo "Prepared $TARGET browser, codecs and local Whisper Base"
