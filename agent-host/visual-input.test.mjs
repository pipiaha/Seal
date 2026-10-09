import { expect, test } from 'bun:test';
import { limitVisualContext, visualInput } from './visual-input.mjs';

test('visual projection bounds the whole request without changing saved messages', () => {
  const image = { type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' };
  const messages = [{ role: 'user', content: [{ type: 'text', text: 'reference' }, image] }, { role: 'toolResult', toolCallId: 't', content: [image] }];
  const projection = limitVisualContext(messages, { maxImages: 1, maxImageBytes: 100 });
  expect(projection[0].content[1].type).toBe('text');
  expect(projection[1]).toBe(messages[1]);
  expect(messages[0].content[1]).toBe(image);
  expect(projection[1].toolCallId).toBe('t');
  expect(limitVisualContext(messages).flatMap(message => message.content).some(part => part.type === 'image')).toBe(false);
});

test('visual input rejects unsupported models and keeps bytes out of metadata', () => {
  const item = { id: 'a', name: 'fixture', mimeType: 'image/png', data: 'aGVsbG8=' };
  expect(() => visualInput([item])).toThrow('未开启');
  const result = visualInput([item], { maxImages: 1, maxImageBytes: 100 });
  expect(result.images[0].data).toBe(item.data);
  expect(JSON.stringify(result.metadata)).not.toContain(item.data);
  expect(() => visualInput([item, item], { maxImages: 1, maxImageBytes: 100 })).toThrow('Too many');
});
