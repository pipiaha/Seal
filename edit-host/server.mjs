import http from 'node:http';
import { createVisualFrames } from './visual-frames.mjs';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { createReadStream } from 'node:fs';
import { createProjectStore, failure } from './project-store.mjs';
import { createStudioGateway, readBody, sendError } from './studio-gateway.mjs';
import { initializeProject } from './starter.mjs';
import { createHypitScenes } from './hypit-scenes.mjs';
import { createLibraryMedia } from './library-media.mjs';
import { listSavedExports, savedExport } from './saved-exports.mjs';
import { createHypitProductions } from './hypit-productions.mjs';
import { configureBundledRuntime } from './bundled-runtime.mjs';
import { createHyperframesScenes } from './hyperframes-scenes.mjs';

configureBundledRuntime();

const token = process.env.BEEFTV_EDIT_HOST_TOKEN;
const dataDir = process.env.BEEFTV_EDIT_DATA_DIR;
if (!token || !dataDir || !path.isAbsolute(dataDir)) throw new Error('The product must provide an absolute edit data directory and a private host token');
const store = createProjectStore(dataDir);
const gateway = createStudioGateway(store);
const scenes = createHypitScenes(store, gateway);
const media = createLibraryMedia(store, gateway);
const productions = createHypitProductions(store, scenes);
const hyperframes = createHyperframesScenes(store);
const visuals = createVisualFrames(store);
const sameToken = value => typeof value === 'string' && value.length === token.length
  && crypto.timingSafeEqual(Buffer.from(value), Buffer.from(token));
const server = http.createServer(async (req, res) => {
  try {
    if (!sameToken(req.headers['x-beeftv-edit-host'])) throw failure('host_token_required', 'Private product control channel', 403);
    const url = new URL(req.url, 'http://127.0.0.1');
    const importing = req.method === 'POST' && /^\/edits\/[a-zA-Z0-9_-]+\/(?:hypit\/)?assets\/import$/.test(url.pathname);
    const body = importing ? JSON.parse(Buffer.from(String(req.headers['x-beeftv-media-metadata'] || ''), 'base64').toString())
      : ['GET', 'HEAD'].includes(req.method) ? {} : JSON.parse((await readBody(req)).toString() || '{}');
    let data;
    if (req.method === 'GET' && url.pathname === '/update/status') {
      data = { ready: store.busy() + gateway.busy() + productions.busy() + hyperframes.busy() + visuals.busy() === 0 };
    } else if (req.method === 'POST' && url.pathname === '/open') {
      const edit = await store.ensure(body.projectId);
      await store.locked(edit.editId, () => initializeProject(store.workDir(edit.editId)));
      data = (await gateway.open(edit.editId)).ticket(body.parentOrigin, body.theme);
    } else if (req.method === 'POST' && url.pathname === '/production/open') {
      const edit = await store.ensure(body.projectId);
      await store.locked(edit.editId, () => initializeProject(store.workDir(edit.editId)));
      data = await productions.open(edit.editId);
    } else {
      const match = /^\/edits\/([a-zA-Z0-9_-]+)(\/.*)?$/.exec(url.pathname);
      if (!match) throw failure('not_found', 'Unknown editor operation', 404);
      const [, editId, action = ''] = match;
      const state = await store.state(editId);
      if (state.projectId !== url.searchParams.get('projectId')) throw failure('edit_scope_mismatch', 'This edit belongs to another project', 403);
      const owned = await gateway.open(editId);
      if (req.method === 'POST' && action === '/vision') {
        data = await visuals.read(editId, body, owned);
      }
      else if (req.method === 'POST' && action === '/media-info') data = await visuals.info(editId, body, owned);
      else if (req.method === 'GET' && action === '') data = state;
      else if (req.method === 'POST' && action.startsWith('/hypit/')) {
        const command = action.slice('/hypit/'.length);
        if (command === 'open') data = await productions.open(editId);
        else if (command === 'read') data = await productions.read(editId, body);
        else if (command === 'write') data = await productions.write(editId, body);
        else if (command === 'start') data = await productions.start(editId, body);
        else if (command === 'status') data = await productions.status(editId, body.jobId);
        else if (command === 'list') data = await productions.list(editId);
        else if (command === 'cancel') data = await productions.cancel(editId, body.jobId);
        else if (command === 'publish') data = await productions.publish(editId, body);
        else if (command === 'assets/import' && importing) data = await productions.importAsset(editId, body, req);
        else if (command === 'frames') data = await productions.frames(editId, body);
        else throw failure('command_forbidden', 'Unknown Hypit operation', 403);
      }
      else if (importing) data = await media.importMedia(editId, body, req);
      else if (req.method === 'GET' && action === '/exports') data = await listSavedExports(store, editId);
      else if (req.method === 'GET' && action === '/materials') data = await store.locked(editId, async () => {
        const response = await owned.studio.app.request(`/api/projects/${editId}`);
        if (!response.ok) throw failure('materials_unavailable', '无法读取当前剪辑工程的素材', response.status);
        const { files } = await response.json();
        const { document } = parseHTML(await fs.readFile(path.join(store.workDir(editId), 'index.html'), 'utf8'));
        const labels = new Map([...document.querySelectorAll('[src][data-label]')].map(node => [node.getAttribute('src')?.replace(/^\.\//, ''), node.getAttribute('data-label')]));
        const kinds = { '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.gif': 'image', '.svg': 'image', '.avif': 'image',
          '.mp4': 'video', '.mov': 'video', '.webm': 'video', '.m4v': 'video', '.mp3': 'audio', '.wav': 'audio', '.m4a': 'audio', '.aac': 'audio', '.ogg': 'audio', '.flac': 'audio' };
        return { materials: files.filter(file => kinds[path.extname(file).toLowerCase()]).map(file => ({ file,
          title: labels.get(file) || path.basename(file), kind: kinds[path.extname(file).toLowerCase()] })) };
      });
      else if (req.method === 'GET' && /^\/exports\/[a-zA-Z0-9_]+\/file$/.test(action)) {
        const exported = await savedExport(store, editId, action.split('/')[2]);
        if (exported.summary.status !== 'complete' || exported.summary.format !== 'mp4') throw failure('export_not_ready', 'Only completed MP4 exports can enter the asset library', 409);
        const info = await fs.lstat(exported.file);
        if (!info.isFile() || info.isSymbolicLink()) throw failure('export_not_ready', 'Export file is unavailable', 409);
        res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': info.size, 'Cache-Control': 'no-store' });
        const stream = createReadStream(exported.file);
        res.once('close', () => stream.destroy()); stream.on('error', () => res.destroy()); stream.pipe(res); return;
      }
      else if (req.method === 'POST' && action === '/candidates') data = await scenes.create(editId, body);
      else if (req.method === 'GET' && action === '/candidates') data = await scenes.list(editId);
      else if (req.method === 'POST' && action === '/promote') data = await scenes.promote(editId, body);
      else if (req.method === 'POST' && action === '/hyperframes/context') data = await hyperframes.context(editId, gateway);
      else if (req.method === 'POST' && action === '/hyperframes/candidate') data = await hyperframes.create(editId, body);
      else if (req.method === 'POST' && action === '/hyperframes/inspect') data = await hyperframes.inspect(editId, body);
      else if (req.method === 'POST' && action === '/hyperframes/review') data = await hyperframes.review(editId, body.candidateId);
      else if (req.method === 'POST' && action === '/hyperframes/candidates') data = await scenes.list(editId);
      else if (req.method === 'POST' && action === '/hyperframes/export') data = await owned.render(body);
      else if (req.method === 'POST' && action === '/hyperframes/exports') data = await listSavedExports(store, editId);
      else if (req.method === 'POST' && action === '/mutate') {
        const allowed = /^(?:file-mutations\/(?:patch-element|split-element|remove-element)\/[^?]+|history\/(?:step|undo|restore))$/;
        if (typeof body.route !== 'string' || !allowed.test(body.route)) throw failure('mutation_not_allowed', 'Use a supported native editing command', 403);
        data = await store.transaction(editId, { operationId: body.operationId, expectedRevision: body.expectedRevision,
          requestKey: crypto.createHash('sha256').update(JSON.stringify({ route: body.route, payload: body.payload })).digest('hex') }, async () => {
          const window = body.route.startsWith('history/') ? null : await owned.history.beginWindow({ kind: 'agent', name: 'Seal' }, body.label || 'Edited by Agent');
          try {
            const response = await owned.studio.app.request(`/api/projects/${editId}/${body.route}`, { method: 'POST',
              headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body.payload) });
            const result = await response.json();
            if (!response.ok || result.matched === false || result.ok === false) throw failure('native_edit_rejected', result.error || 'Element not found or edit conflicts', response.ok ? 409 : response.status);
            return result;
          } finally { await window?.close(); }
        });
      }
      else if (req.method === 'POST' && action === '/read') {
        const file = String(body.file || 'index.html');
        data = await store.locked(editId, async () => {
          const response = await owned.studio.app.request(`/api/projects/${editId}/files/${file.split('/').map(encodeURIComponent).join('/')}`);
          if (!response.ok) throw failure('file_not_found', 'Project file not found', response.status);
          return { editId, revision: (await store.state(editId)).revision, file, content: await response.text(), version: response.headers.get('ETag') };
        });
      }
      else if (req.method === 'GET' && action === '/context') {
        data = await store.locked(editId, async () => {
          const response = await owned.studio.app.request(`/api/projects/${editId}/selection`);
          if (!response.ok) throw failure('selection_unavailable', 'Selection is unavailable', response.status);
          await owned.history.flush();
          const { document } = parseHTML(await fs.readFile(path.join(store.workDir(editId), 'index.html'), 'utf8'));
          const root = document.querySelector('[data-composition-id]');
          const clips = [...document.querySelectorAll('.clip')];
          return { projectId: state.projectId, editId, revision: (await store.state(editId)).revision, selection: await response.json(),
            overview: { width: Number(root?.getAttribute('data-width')), height: Number(root?.getAttribute('data-height')),
              duration: Number(root?.getAttribute('data-duration')), clipCount: clips.length,
              clips: clips.slice(0, 20).map(node => ({ id: node.id, label: (node.getAttribute('data-label') || '').slice(0, 120),
                start: Number(node.getAttribute('data-start')), duration: Number(node.getAttribute('data-duration')), track: Number(node.getAttribute('data-track-index')) })) },
            recentChanges: owned.history.list().slice(-5).map(entry => ({ id: entry.id, label: String(entry.label || '').slice(0, 160),
              who: entry.who, timestamp: entry.timestamp, createdAt: entry.createdAt })) };
        });
      } else if (req.method === 'POST' && action === '/history') {
        data = await store.locked(editId, async () => {
          await owned.history.flush();
          const response = await owned.studio.app.request(`/api/projects/${editId}/history`);
          if (!response.ok) throw failure('history_unavailable', 'Editing history is unavailable', response.status);
          return { editId, revision: (await store.state(editId)).revision, ...await response.json() };
        });
      } else throw failure('not_found', 'Unknown editor operation', 404);
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ code: 0, data, msg: '' }));
  } catch (error) { if (!res.headersSent) sendError(res, error); else res.destroy(); }
});

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await productions.close();
  await hyperframes.close();
  visuals.close();
  await gateway.close();
  process.exit(0);
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
if (process.env.BEEFTV_EDIT_LIFETIME_STDIN === '1') {
  process.stdin.resume();
  process.stdin.once('end', () => void shutdown());
}
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ endpoint: `http://127.0.0.1:${server.address().port}` })));
