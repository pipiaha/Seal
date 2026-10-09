(() => {
  const config = window.__BEEFTV_EDIT__;
  document.documentElement.lang = 'zh-CN';
  let productTheme = config.theme === 'light' ? 'light' : 'dark';
  const themeColors = {};
  const themeVariables = {
    background: ['--color-bg-0', '--color-bg-1', '--panel-shell-bg', '--panel-strip-bg', '--timeline-shell-bg', '--timeline-gutter-bg'],
    surface: ['--color-bg-2', '--color-surface', '--color-input', '--color-container', '--panel-card-bg', '--timeline-row-bg'],
    raised: ['--color-surface-alt', '--color-raised', '--color-hover', '--panel-tab-bg-hover'],
    foreground: ['--color-text-0', '--color-text-1', '--color-text-body', '--timeline-text-primary'],
    muted: ['--color-text-2', '--color-text-3', '--color-text-4', '--color-text-5', '--color-text-muted', '--timeline-text-secondary', '--timeline-tick-text'],
    border: ['--color-border', '--color-border-strong', '--color-border-input', '--color-hairline', '--panel-card-border', '--timeline-shell-border', '--timeline-row-border', '--timeline-ruler-border', '--timeline-gutter-border'],
    accent: ['--color-accent', '--color-accent-hover', '--color-playhead', '--timeline-accent', '--color-ring'],
    onAccent: ['--color-on-accent', '--color-accent-ink'],
  };
  function applyProductTheme() {
    const root = document.documentElement;
    if (productTheme === 'light') { if (root.dataset.theme !== 'paper') root.dataset.theme = 'paper'; }
    else if (root.hasAttribute('data-theme')) root.removeAttribute('data-theme');
    root.style.setProperty('color-scheme', productTheme, 'important');
    for (const [name, value] of Object.entries(themeColors)) for (const variable of themeVariables[name]) {
      if (root.style.getPropertyValue(variable) !== value) root.style.setProperty(variable, value, 'important');
    }
  }
  applyProductTheme();
  new MutationObserver(applyProductTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    // The product navigation owns the theme switch for the entire workspace.
    style.textContent = 'button[aria-label^="Switch to "][aria-label$=" theme"]{display:none}';
    document.head.append(style);
    parent.postMessage({ type: 'beeftv:edit-theme-ready', editId: config.editId }, config.parentOrigin);
    void reportCompositionSize();
  });
  async function reportCompositionSize() {
    try {
      const response = await window.fetch(`/api/projects/${encodeURIComponent(config.editId)}/files/index.html`);
      if (!response.ok) return;
      const source = (await response.json()).content;
      if (typeof source !== 'string') return;
      const document = new DOMParser().parseFromString(source, 'text/html');
      const root = document.querySelector('[data-composition-id="main"]') || document.querySelector('[data-composition-id]');
      const width = Number(root?.getAttribute('data-width'));
      const height = Number(root?.getAttribute('data-height'));
      if (Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0) {
        parent.postMessage({ type: 'beeftv:composition-size', editId: config.editId, width, height }, config.parentOrigin);
      }
    } catch { /* The editor can still work while the initial size read retries on reload. */ }
  }
  const originalFetch = window.fetch.bind(window);
  const originalAnchorClick = HTMLAnchorElement.prototype.click;
  const renderDownloadPrefix = `/api/projects/${encodeURIComponent(config.editId)}/renders/file/`;
  async function downloadRender(url, filename) {
    const response = await originalFetch(url, { credentials: 'same-origin' });
    if (!response.ok) {
      let message = '视频下载失败，请重新打开剪辑工程后重试';
      try { const error = await response.json(); message = error.msg || error.error || message; } catch { /* Keep the download error readable for non-JSON responses. */ }
      throw new Error(message);
    }
    const objectUrl = URL.createObjectURL(await response.blob());
    try {
      const link = document.createElement('a');
      link.href = objectUrl; link.download = filename;
      document.body.append(link);
      try { originalAnchorClick.call(link); } finally { link.remove(); }
    } finally { window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000); }
  }
  // Native Studio creates a detached download link. Browser downloads lose the
  // iframe's partitioned cookie; fetch inside this frame retains that session.
  HTMLAnchorElement.prototype.click = function () {
    const url = new URL(this.href, location.href);
    if (this.hasAttribute('download') && url.origin === location.origin && url.pathname.startsWith(renderDownloadPrefix)) {
      void downloadRender(url.href, this.download).catch(error => {
        parent.postMessage({ type: 'beeftv:export-download-error', editId: config.editId,
          error: error instanceof Error ? error.message : '视频下载失败，请重试' }, config.parentOrigin);
      });
      return;
    }
    return originalAnchorClick.call(this);
  };
  let revision = config.revision;
  let pending = Promise.resolve();
  let writeError = '';
  window.fetch = (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url || input, location.href);
    const local = url.origin === location.origin;
    const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const writing = local && url.pathname.startsWith('/api/') && method !== 'GET' && method !== 'HEAD';
    const perform = async () => {
      const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
      if (writing) {
        headers.set('X-Beeftv-Edit-Revision', String(revision));
        headers.set('X-Beeftv-Operation', crypto.randomUUID());
      }
      const response = await originalFetch(input, { ...init, headers, ...(local ? { credentials: 'same-origin' } : {}) });
      if (writing) writeError = response.ok ? '' : '剪辑操作尚未成功保存，请处理错误后再更新';
      const next = response.headers.get('X-Beeftv-Edit-Revision');
      if (next !== null) revision = Math.max(revision, Number(next));
      if (local) parent.postMessage({ type: 'beeftv:edit-state', editId: config.editId, revision }, config.parentOrigin);
      return response;
    };
    if (!writing) return perform();
    const result = pending.then(perform, perform);
    pending = result.then(() => undefined, () => { writeError = '剪辑保存请求失败，请重试保存后再更新'; });
    return result;
  };
  window.addEventListener('message', async event => {
    if (event.origin !== config.parentOrigin || event.source !== parent) return;
    if (event.data?.type === 'beeftv:visual-context' && event.data.editId === config.editId) {
      try {
        for (;;) { const current = pending; await current; if (current === pending) break; }
        if (writeError) throw new Error(writeError);
        const player = window.__BeeftvEditor?.player?.getState();
        if (!player) throw new Error('剪辑编辑器尚未就绪');
        const clipIds = player.elements.filter(clip => player.selectedElementIds?.has(clip.key || clip.id) || player.selectedElementId === (clip.key || clip.id)).map(clip => clip.id);
        parent.postMessage({ type: 'beeftv:visual-context-result', editId: config.editId, requestId: event.data.requestId,
          selection: { playheadTime: player.currentTime, clipIds } }, config.parentOrigin);
      } catch (error) {
        parent.postMessage({ type: 'beeftv:visual-context-result', editId: config.editId, requestId: event.data.requestId, error: error.message }, config.parentOrigin);
      }
      return;
    }
    if (event.data?.type === 'beeftv:prepare-update' && event.data.editId === config.editId) {
      // Wait through the queue, including writes added while an earlier write finishes.
      for (;;) { const current = pending; await current; if (current === pending) break; }
      parent.postMessage({ type: 'beeftv:update-prepared', editId: config.editId,
        requestId: event.data.requestId, error: writeError }, config.parentOrigin);
      return;
    }
    if (event.data?.type === 'beeftv:edit-theme' && event.data.editId === config.editId) {
      productTheme = event.data.theme === 'light' ? 'light' : 'dark';
      for (const name of Object.keys(themeVariables)) {
        const value = event.data.colors?.[name];
        if (typeof value === 'string' && CSS.supports('color', value)) themeColors[name] = value;
      }
      applyProductTheme(); return;
    }
    if (event.data?.type === 'beeftv:set-composition-size' && event.data.editId === config.editId
      && Number.isSafeInteger(event.data.width) && Number.isSafeInteger(event.data.height)) {
      try {
        const response = await window.fetch('/api/beeftv/composition-size', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ width: event.data.width, height: event.data.height }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '画面比例保存失败');
        parent.postMessage({ type: 'beeftv:composition-size-saved', editId: config.editId,
          requestId: event.data.requestId, width: result.width, height: result.height }, config.parentOrigin);
      } catch (error) {
        parent.postMessage({ type: 'beeftv:composition-size-error', editId: config.editId,
          requestId: event.data.requestId, error: error instanceof Error ? error.message : '画面比例保存失败' }, config.parentOrigin);
      }
      return;
    }
    if (event.data?.type !== 'beeftv:edit-context') return;
    await pending;
    const response = await window.fetch(`/api/projects/${encodeURIComponent(config.editId)}/selection`);
    const selection = response.ok ? await response.json() : { selection: null };
    parent.postMessage({ type: 'beeftv:edit-context', editId: config.editId, revision, selection }, config.parentOrigin);
  });
})();
