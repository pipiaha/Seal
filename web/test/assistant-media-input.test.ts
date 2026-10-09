import { expect, mock, test } from 'bun:test';

const saved: File[] = [];
mock.module('@/services/edit-import-files', () => ({ EDIT_MEDIA_FILE_ACCEPT:'.mp4,.webm,.mp3,.wav,.ogg,.m4a', saveEditFileToLibrary:async (file:File)=>{ saved.push(file); return 'saved-media'; } }));
const { assistantFileKind, prepareAssistantMedia, assistantReferencedMedia } = await import('@/services/assistant-media');
const { captureUserScope } = await import('@/lib/user-scope-guard');

test('file intake distinguishes video/audio/text and sends actual UTF-8 subtitle content', async () => {
    expect(assistantFileKind({name:'sample.MP4',type:'application/octet-stream'})).toBe('video');
    expect(assistantFileKind({name:'voice.wav',type:'audio/wav'})).toBe('audio');
    expect(assistantFileKind({name:'document.pdf',type:'application/pdf'})).toBeNull();
    const content='1\n00:00:00,000 --> 00:00:01,000\nSeal 字幕';
    const file=await prepareAssistantMedia(new File([content],'字幕.srt'),captureUserScope());
    expect(file.kind).toBe('text'); expect(file.content).toBe(content);
    await expect(prepareAssistantMedia(new File([new Uint8Array([255,254])],'坏编码.txt'),captureUserScope())).rejects.toThrow('UTF-8');
    await expect(prepareAssistantMedia(new File(['binary\0text'],'二进制.txt'),captureUserScope())).rejects.toThrow('二进制');
    const audio=await prepareAssistantMedia(new File(['fixture'],'voice.wav'),captureUserScope());
    expect(audio.assetId).toBe('saved-media'); expect(saved.at(-1)?.name).toBe('voice.wav');
});

test('selected canvas video and explicit library audio become resource refs; editor files use edit tools', () => {
    const references=[
        {id:'node-video',nodeId:'n1',kind:'video' as const,title:'画布视频',label:'视频1',active:true},
        {id:'library-audio',nodeId:'library-audio',kind:'audio' as const,title:'旁白',label:'音频1',assetId:'a1',active:true},
        {id:'media:assets/video.mp4',nodeId:'media:assets/video.mp4',kind:'video' as const,title:'工程视频',label:'视频2',mentionToken:'@[media:assets/video.mp4]',active:true},
    ];
    const media=assistantReferencedMedia('@[asset:a1] @[media:assets/video.mp4]',['n1'],references);
    expect(media.map(item=>item.kind)).toEqual(['video','audio']);
    expect(media[0].nodeId).toBe('n1'); expect(media[1].assetId).toBe('a1');
});
