import type { AssistantImage } from './api/agent-assistant';
import type { CanvasResourceReference } from '@/lib/canvas/canvas-resource-references';
import { canvasResourceMentionToken } from '@/lib/canvas/canvas-resource-references';
import { resolveImageUrl } from './image-storage';
import { loadCanvasDrawingPreview } from '@/lib/canvas/canvas-drawing-storage';
import { assertUserScope, captureUserScope } from '@/lib/user-scope-guard';

export const ASSISTANT_IMAGE_LIMIT = 8;
export const ASSISTANT_IMAGE_BYTES = 2 * 1024 * 1024;

export async function prepareAssistantImage(blob: Blob, name: string, source = 'upload'): Promise<AssistantImage> {
    if (!blob.size || blob.size > 30 * 1024 * 1024) throw new Error('请选择不超过 30 MiB 的图片');
    const bitmap = await createImageBitmap(blob);
    try {
        if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 64_000_000) throw new Error('图片尺寸过大，请先缩小');
        const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('无法读取图片');
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        let encoded = canvas.toDataURL('image/png');
        if ((encoded.length - encoded.indexOf(',') - 1) * 3 / 4 > ASSISTANT_IMAGE_BYTES) {
            context.globalCompositeOperation = 'destination-over'; context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
            encoded = canvas.toDataURL('image/jpeg', 0.85);
        }
        const [prefix, data] = encoded.split(',');
        if (!data || data.length * 3 / 4 > ASSISTANT_IMAGE_BYTES) throw new Error('图片仍然过大，请缩小后再添加');
        return { id: crypto.randomUUID(), name: name.replace(/[\r\n\0]/g, '').slice(0, 120), mimeType: prefix.includes('image/jpeg') ? 'image/jpeg' : 'image/png', data, source: source.slice(0, 512) };
    } finally { bitmap.close(); }
}

export async function assistantReferenceImages(text: string, selected: string[], references: CanvasResourceReference[], projectId: string) {
    const scope = captureUserScope();
    const targets = references.filter(reference => ['image', 'character'].includes(reference.kind) &&
        (selected.includes(reference.nodeId) || text.includes(canvasResourceMentionToken(reference))));
    const unique = [...new Map(targets.map(reference => [reference.id, reference])).values()];
    if (unique.length > ASSISTANT_IMAGE_LIMIT) throw new Error('一次消息最多带 8 张图片，请减少引用或选择');
    const images: AssistantImage[] = [];
    for (const reference of unique) {
        // Editor-relative files are resolved by the editing runtime, not browser fetch.
        if (reference.id.startsWith('media:')) continue;
        let blob: Blob | undefined;
        if (reference.drawingId) blob = await loadCanvasDrawingPreview(projectId, reference.drawingId) || undefined;
        if (!blob) {
            const url = await resolveImageUrl(reference.storageKey, reference.previewUrl || '', { cacheMiss: true });
            if (!url) throw new Error(`无法读取图片「${reference.title}」，请重新导入`);
            const response = await fetch(url, { credentials: 'same-origin' });
            if (!response.ok) throw new Error(`读取图片「${reference.title}」失败`);
            blob = await response.blob();
        }
        assertUserScope(scope);
        images.push(await prepareAssistantImage(blob, reference.title, `reference:${reference.assetId || reference.nodeId || reference.id}`));
    }
    assertUserScope(scope);
    return images;
}
