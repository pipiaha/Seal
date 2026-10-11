const LIMIT = 6000;
const secretKey = /(?:api[_-]?key|private[_-]?key|access[_-]?key(?:[_-]?id)?|token|secret|password|authorization|cookie|credential|headers|env)$|^key$/i;
const sensitiveFile = /(?:^|[\\/])(?:\.env(?:\.[^\\/]*)?|\.settings-key|agent_config\.json|credentials(?:\.json)?|auth\.json|id_rsa|id_ed25519)(?:$|[?#])/i;

function redact(text) {
  return text
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, '[已隐藏凭据]')
    .replace(/\b(?:Bearer|Basic)\s+[^\s"'<>]+/gi, '[已隐藏凭据]')
    .replace(/\b(?:sk-[\w-]{12,}|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g, '[已隐藏凭据]')
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|authorization|cookie)\s*["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;}]+)/gi, '$1[已隐藏凭据]')
    .replace(/https?:\/\/[^\s"'<>]+/gi, value => {
      try {
        const url = new URL(value);
        if (url.username || url.password) { url.username = ''; url.password = ''; }
        for (const key of [...url.searchParams.keys()]) if (secretKey.test(key) || /signature|sign$|x-amz-|x-goog-/i.test(key)) url.searchParams.set(key, '[已隐藏凭据]');
        return url.href;
      } catch { return '[无效网址]'; }
    })
    .replace(/data:[\w/+.-]+;base64,[\w+/=\s]+/g, '[媒体数据已省略]');
}

function clean(value, depth = 0) {
  if (depth > 5) return '[嵌套内容已省略]';
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.slice(0, 32).map(item => clean(item, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 80)
    .filter(([key]) => !secretKey.test(key) && !/^(base64|imageData|binary|thinking)$/i.test(key))
    .map(([key, item]) => [key, clean(item, depth + 1)]));
  return value;
}

function preview(value) {
  const text = typeof value === 'string' ? redact(value) : JSON.stringify(clean(value), null, 2);
  return text.length > LIMIT ? { text: text.slice(0, LIMIT) + '\n…内容已截断', truncated: true } : { text };
}

// 展示副本有独立上限，不把完整参数、二进制结果或凭据写进流式记录。
export function toolDisplay(event, previousInput = '') {
  const detail = {};
  if (event.type === 'tool_execution_start' && event.args && typeof event.args === 'object') {
    const args = clean(event.args);
    for (const key of ['text', 'content', 'html', 'svml', 'svs', 'code']) if (typeof args[key] === 'string') args[key] = `[写入内容，${event.args[key].length} 字符]`;
    if (Object.keys(args).length) {
      const input = preview(args);
      detail.input = input.text;
      if (input.truncated) detail.truncated = true;
    }
  }
  const result = event.type === 'tool_execution_end' ? event.result : event.type === 'tool_execution_update' ? event.partialResult : null;
  if (Array.isArray(result?.content)) {
    const hidden = sensitiveFile.test(previousInput) || /"(?:path|script)"\s*:\s*"[^"\n]*(?:\.env|\.settings-key|agent_config\.json|credentials\.json|auth\.json|id_rsa|id_ed25519)/i.test(previousInput);
    const texts = result.content.filter(part => part.type === 'text' && typeof part.text === 'string').map(part => {
      try { return JSON.stringify(clean(JSON.parse(part.text)), null, 2); } catch { return redact(part.text); }
    });
    const mediaCount = result.content.filter(part => part.type !== 'text').length;
    const output = preview(hidden ? '该文件可能含有凭据，执行记录不展示文件内容。' : texts.join('\n\n') || (mediaCount ? `返回了 ${mediaCount} 项媒体内容（数据已省略）。` : '没有文本输出。'));
    detail.output = output.text;
    if (output.truncated) detail.truncated = true;
  }
  return Object.keys(detail).length ? detail : undefined;
}
