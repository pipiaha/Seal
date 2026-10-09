import type { AssistantMedia } from './api/agent-assistant';
import { saveEditFileToLibrary, EDIT_MEDIA_FILE_ACCEPT } from './edit-import-files';
import { assertUserScope, type CapturedUserScope } from '@/lib/user-scope-guard';
import { canvasResourceMentionToken, type CanvasResourceReference } from '@/lib/canvas/canvas-resource-references';

export const ASSISTANT_FILE_ACCEPT = `${EDIT_MEDIA_FILE_ACCEPT},.avif,.txt,.md,.json,.csv,.srt,.vtt`;
export function assistantFileKind(file: Pick<File, 'name' | 'type'>): 'image' | 'video' | 'audio' | 'text' | null {
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (['txt', 'md', 'json', 'csv', 'srt', 'vtt'].includes(extension || '')) return 'text';
    if (['png','jpg','jpeg','webp','gif','avif'].includes(extension || '') || file.type.startsWith('image/')) return 'image';
    if (['mp4','webm'].includes(extension || '')) return 'video';
    if (['mp3','wav','ogg','m4a'].includes(extension || '')) return 'audio';
    return null;
}
export async function prepareAssistantMedia(file: File, expected: CapturedUserScope): Promise<AssistantMedia> {
    const kind = assistantFileKind(file);
    const id = crypto.randomUUID();
    if (kind === 'text') {
        if (!file.size || file.size > 64 * 1024) throw new Error('文字或字幕文件不能超过 64 KiB');
        const bytes = await file.arrayBuffer();
        let content: string;
        try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Error('请提供 UTF-8 编码的文字或字幕文件'); }
        if (content.includes('\0') || content.length > 16000) throw new Error('文字文件包含二进制内容，或超过 16000 字符');
        assertUserScope(expected);
        return { id, name: file.name.slice(0, 120), kind, content };
    }
    if (kind !== 'video' && kind !== 'audio') throw new Error('支持图片、MP4/WebM 视频、MP3/WAV/OGG/M4A 音频，以及 TXT/MD/JSON/CSV/SRT/VTT 文字文件');
    const assetId = await saveEditFileToLibrary(file, `assistant-${id}`, expected);
    assertUserScope(expected);
    return { id, name: file.name.slice(0, 120), kind, assetId };
}
export function assistantReferencedMedia(text: string, selected: string[], references: CanvasResourceReference[]): AssistantMedia[] {
    const targets = references.filter(reference => ['video','audio'].includes(reference.kind) && !reference.id.startsWith('media:') &&
        (selected.includes(reference.nodeId) || text.includes(canvasResourceMentionToken(reference))));
    return [...new Map(targets.map(reference => [reference.id, reference])).values()].map(reference => ({ id: `reference:${reference.id}`,
        name: reference.title.slice(0,120), kind: reference.kind as 'video' | 'audio', ...(reference.assetId ? { assetId: reference.assetId } : { nodeId: reference.nodeId }) }));
}
