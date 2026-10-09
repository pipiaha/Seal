export function visualInput(images, { maxImages = 0, maxImageBytes = 0 } = {}) {
  if (!Array.isArray(images)) throw Object.assign(new Error('Invalid image list'), { reason: 'image_input_invalid' });
  if (!images.length) return { images: [], metadata: [] };
  if (maxImages <= 0 || maxImageBytes <= 0) throw Object.assign(new Error('当前模型未开启图片输入，请在模型配置中开启图片引用'), { reason: 'image_input_invalid' });
  if (images.length > Math.min(maxImages, 8)) throw Object.assign(new Error('Too many images'), { reason: 'image_input_invalid' });
  let total = 0;
  const content = images.map(item => {
    if (!['image/jpeg', 'image/png'].includes(item.mimeType) || typeof item.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(item.data)) throw new Error('Invalid image encoding');
    const size = Buffer.byteLength(item.data, 'base64'); total += size;
    if (size > maxImageBytes || total > 12 * 1024 * 1024) throw new Error('Image size limit exceeded');
    return { type: 'image', data: item.data, mimeType: item.mimeType };
  });
  return { images: content, metadata: images.map(({ id, name, mimeType, source }) => ({ id, name: String(name || '').slice(0, 240), mimeType, source: String(source || '').slice(0, 512) })) };
}

// Request-only projection: keep recent pixels within model limits, retain the full SDK journal.
export function limitVisualContext(messages, { maxImages = 0, maxImageBytes = 0 } = {}) {
  let remaining = Math.min(maxImages, 8), bytes = 12 * 1024 * 1024;
  return messages.toReversed().map(message => {
    if (!Array.isArray(message.content) || !['user', 'toolResult'].includes(message.role)) return message;
    let changed = false;
    const content = message.content.toReversed().map(part => {
      if (part.type !== 'image') return part;
      const size = Buffer.byteLength(part.data || '', 'base64');
      if (remaining > 0 && size <= maxImageBytes && size <= bytes) { remaining--; bytes -= size; return part; }
      changed = true;
      return { type: 'text', text: '[此图片暂未随本次请求发送：超过当前视觉输入限制。如需检查旧附件，使用 conversation_image_read；工程画面重新使用视觉读取工具。不要推测这张图片的内容。]' };
    }).toReversed();
    return changed ? { ...message, content } : message;
  }).toReversed();
}
