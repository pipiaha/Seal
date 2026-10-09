import { Button, Tooltip, Dropdown } from "antd";
import { ArrowUp, Square, X, Paperclip, ScanEye, Film, FileText, Music } from "lucide-react";
import { useRef, useState } from "react";

import { CanvasResourceMentionTextarea } from "@/components/canvas/canvas-resource-mention-textarea";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { CanvasAssistantModelPicker } from "./canvas-assistant-model-picker";
import { useAssistantSkillPicker } from './canvas-assistant-skill-picker';
import type { HubSkill } from '@/services/api/skill-hub';
import type { AssistantImage, AssistantMedia } from '@/services/api/agent-assistant';
import { ASSISTANT_FILE_ACCEPT } from '@/services/assistant-media';
import type { AssistantPermissionMode } from '@/services/api/creator';

const LINE_HEIGHT = 21;
const MIN_LINES = 3;
const MAX_LINES = 8;

type Props = {
    permissionMode?:AssistantPermissionMode;
    permissionBusy?:boolean;
    mediaBusy?:boolean;
    onPermissionModeChange?:(mode:AssistantPermissionMode)=>void;
    media?: AssistantMedia[];
    onRemoveMedia?: (id: string) => void;
    images?: AssistantImage[];
    onAddFiles?: (files: File[]) => void;
    onRemoveImage?: (id: string) => void;
    onCapturePreview?: () => void;
    onCaptureSelection?: () => void;
    imageBusy?: boolean;
    value: string;
    onChange: (value: string) => void;
    onSend: () => void;
    onStop: () => void;
    streaming: boolean;
    canSupplement?: boolean;
    disabled: boolean;
    disabledReason?: string;
    references: CanvasResourceReference[];
    includeAssetLibrary?: boolean;
    workspaceLabel?: string;
    referencesLabel?: string;
    selectedCount: number;
    selectionAttached: boolean;
    onDetachSelection: () => void;
    modelBusy?: boolean;
    selectedSkill?: HubSkill | null;
    onSelectSkill?: (skill: HubSkill | null) => void;
};

export function CanvasAssistantComposer({
    value,
    onChange,
    onSend,
    onStop,
    streaming,
    canSupplement = false,
    disabled,
    disabledReason,
    references,
    includeAssetLibrary = true,
    workspaceLabel = "当前画布",
    referencesLabel,
    selectedCount,
    selectionAttached,
    onDetachSelection,
    modelBusy,
    selectedSkill = null,
    onSelectSkill = () => {},
    images = [], onAddFiles, onRemoveImage, onCapturePreview, onCaptureSelection, imageBusy = false,
    media = [], onRemoveMedia,
    permissionMode='ask',permissionBusy=false,mediaBusy=false,onPermissionModeChange,
}: Props) {
    const composerRef = useRef<HTMLElement>(null);
    const editorRef = useRef<HTMLTextAreaElement>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const skillPicker = useAssistantSkillPicker({value,onChange,selected:selectedSkill,onSelect:onSelectSkill,disabled,streaming,composerRef,editorRef});
    const [contentHeight, setContentHeight] = useState(LINE_HEIGHT);
    const height = Math.min(MAX_LINES * LINE_HEIGHT, Math.max(MIN_LINES * LINE_HEIGHT, contentHeight));
    const canSend = !disabled && !imageBusy && (streaming ? canSupplement : !modelBusy) && !skillPicker.blocked && Boolean(value.trim() || images.length || media.length);

    return (
        <footer ref={composerRef} className="canvas-assistant-composer" onKeyDownCapture={skillPicker.onKeyDownCapture}
            onPasteCapture={event => {
                const files = Array.from(event.clipboardData.files);
                if (files.length && onAddFiles) { event.preventDefault(); event.stopPropagation(); if (!disabled && !streaming && !modelBusy && !imageBusy) onAddFiles(files); }
            }} onDragOver={event => { if (onAddFiles && event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
            onDropCapture={event => {
                if (!onAddFiles || !event.dataTransfer.types.includes('Files')) return;
                event.preventDefault(); event.stopPropagation();
                if (!disabled && !streaming && !modelBusy && !imageBusy) onAddFiles(Array.from(event.dataTransfer.files));
            }}>
            {skillPicker.menu}
            {onAddFiles ? <input ref={fileRef} hidden type="file" accept={ASSISTANT_FILE_ACCEPT} multiple onChange={event => { onAddFiles(Array.from(event.target.files || [])); event.target.value = ''; }} /> : null}
            {media.length ? <div className="canvas-assistant-media-files" aria-label="待发送文件">{media.map(file => <span className="canvas-assistant-chip" key={file.id} title={file.name}>
                {file.kind === 'video' ? <Film size={14} /> : file.kind === 'audio' ? <Music size={14} /> : <FileText size={14} />}<span>{file.name}</span>
                <button type="button" disabled={imageBusy || streaming} aria-label={`移除文件 ${file.name}`} onClick={() => onRemoveMedia?.(file.id)}><X size={12} /></button></span>)}</div> : null}
            {images.length ? <div className="canvas-assistant-images" aria-label="待发送图片">
                {images.map(image => <figure key={image.id}><img src={`data:${image.mimeType};base64,${image.data}`} alt={image.name} /><figcaption title={image.name}>{image.name}</figcaption>
                    <button type="button" aria-label={`移除图片 ${image.name}`} disabled={imageBusy || streaming} onClick={() => onRemoveImage?.(image.id)}><X size={12} /></button></figure>)}
            </div> : null}
            <div className="canvas-assistant-chips">
                <span className="canvas-assistant-chip">{workspaceLabel}</span>
                {skillPicker.chip}
                {selectionAttached && selectedCount > 0 ? (
                    <span className="canvas-assistant-chip">
                        已选 {selectedCount} 个节点
                        <button type="button" aria-label="这条消息不带已选节点" onClick={onDetachSelection}>
                            <X className="size-3" />
                        </button>
                    </span>
                ) : null}
            </div>

            <div className="canvas-assistant-input" style={{ height: height + 14 }}>
                <CanvasResourceMentionTextarea
                    ref={editorRef}
                    value={value}
                    references={references}
                    onChange={onChange}
                    onSubmit={() => { if (canSend) onSend(); }}
                    includeAssetLibrary={includeAssetLibrary}
                    referencesLabel={referencesLabel}
                    containerClassName="h-full min-h-0"
                    className="thin-scrollbar h-full w-full resize-none overflow-y-auto border-none bg-transparent px-3 py-1.5 text-[var(--fs-caption)] leading-[21px] !shadow-none !outline-none !ring-0 focus:!shadow-none focus:!outline-none focus:!ring-0 placeholder:text-[var(--muted-foreground)]"
                    onContentSizeChange={setContentHeight}
                    disabled={disabled}
                    placeholder={streaming ? '补充当前任务的要求，例如：字幕改成白色' : '描述想法，可粘贴图片，@ 引用素材，/ 选择技能'}
                    aria-label="给助手的消息"
                />
            </div>

            {disabled && disabledReason ? <span className="canvas-assistant-meta">{disabledReason}</span> : null}
            {imageBusy ? <span className="canvas-assistant-meta" role="status">正在准备附件和画面…</span> : null}
            {media.some(file => file.kind !== 'text') ? <span className="canvas-assistant-meta">音视频已保存到资产库。助手按需抽帧或转写。</span> : null}
            {skillPicker.error}

            <div className="canvas-assistant-composer-footer">
                {onAddFiles ? <Tooltip title="添加图片、视频、音频或文字文件，也可拖入"><Button type="text" size="small" aria-label="添加附件" disabled={disabled || streaming || modelBusy || imageBusy} icon={<Paperclip size={16} />} onClick={() => fileRef.current?.click()} /></Tooltip> : null}
                {onCapturePreview ? <Tooltip title="将播放位置的画面交给助手"><Button type="text" size="small" aria-label="附上当前画面" disabled={disabled || streaming || modelBusy || imageBusy} icon={<ScanEye size={16} />} onClick={onCapturePreview} /></Tooltip> : null}
                {onCaptureSelection ? <Tooltip title="读取选中片段中间位置的工程画面"><Button type="text" size="small" aria-label="附上选中片段" disabled={disabled || streaming || modelBusy || imageBusy} icon={<Film size={16} />} onClick={onCaptureSelection} /></Tooltip> : null}
                {skillPicker.button}
                <CanvasAssistantModelPicker busy={disabled || streaming || Boolean(modelBusy)} />
                {onPermissionModeChange?<Dropdown trigger={['click']} menu={{selectedKeys:[permissionMode],items:[{key:'ask',label:'请求批准'},{key:'allow',label:'完全允许'}],onClick:({key})=>onPermissionModeChange(key as AssistantPermissionMode)}}><Tooltip title={permissionMode==='allow'?'允许助手直接使用已配置渠道生成图片、视频和配音':'生成图片、视频和配音前请求你批准'}><Button type="text" size="small" loading={permissionBusy} disabled={disabled || permissionBusy} aria-label="助手权限模式">{permissionMode==='allow'?'完全允许':'请求批准'}</Button></Tooltip></Dropdown>:null}
                {streaming || mediaBusy ? <Button size="small" icon={<Square className="size-3" />} onClick={onStop}>停止</Button> : null}
                <Tooltip title={streaming ? '补充要求将在当前工具步骤结束后读取' : 'Enter 发送 · Shift + Enter 换行'} placement="topRight">
                    <Button className="canvas-assistant-send" shape="circle" type="primary" aria-label={streaming ? '补充要求' : '发送'} disabled={!canSend} icon={<ArrowUp className="size-4" />} onClick={onSend} />
                </Tooltip>
            </div>
        </footer>
    );
}
