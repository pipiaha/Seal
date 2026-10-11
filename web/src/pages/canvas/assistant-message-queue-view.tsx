import { App, Button, Input, Tooltip } from 'antd';
import { Forward, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { referencedAssetIdsInPrompt } from '@/lib/canvas/canvas-resource-references';
import type { useAssistantMessageQueue } from './use-assistant-message-queue';

type Props = { queue: ReturnType<typeof useAssistantMessageQueue>; streaming: boolean; canGuide: boolean; disabled: boolean; onCheck: () => void };
export function AssistantMessageQueueView({ queue, streaming, canGuide, disabled, onCheck }: Props) {
    const { message } = App.useApp();
    const [editingText, setEditingText] = useState('');
    const [saving, setSaving] = useState(false);
    if (!queue.messages.length && !queue.error) return null;
    const perform = (task: Promise<unknown>) => { void task.catch(error => message.error(error instanceof Error ? error.message : '操作失败，消息仍然保留')); };
    const save = async (id: string) => { setSaving(true); try { await queue.saveEdit(id, editingText); } catch (error) { message.error(error instanceof Error ? error.message : '保存失败'); } finally { setSaving(false); } };
    return <section className="canvas-assistant-message-queue" aria-label="排队消息">
        <div className="canvas-assistant-queue-heading"><span>排队消息 · {queue.messages.length}</span>{queue.paused && queue.messages.some(item => item.state === 'queued') ? <Button type="text" size="small" disabled={disabled || Boolean(queue.busyId)} onClick={() => perform(queue.resume())}>继续队列</Button> : <small>当前轮结束后依次发送</small>}</div>
        {queue.error ? <p className="canvas-assistant-meta" role="status">{queue.error}</p> : null}
        <ul>{queue.messages.map(item => {
            const editing = queue.editingId === item.id;
            const locked = disabled || item.state !== 'queued' || queue.busyId === item.id;
            const hasReferences = referencedAssetIdsInPrompt(item.text).length > 0 || /@\[(?:node|media):/.test(item.text);
            return <li key={item.id} data-queued-message-id={item.id}>
                {editing ? <div className="canvas-assistant-queue-editor"><Input.TextArea aria-label="编辑排队消息" autoFocus autoSize={{ minRows: 2, maxRows: 5 }} value={editingText} disabled={saving} onChange={event => setEditingText(event.target.value)} onKeyDown={event => {
                    if (event.key === 'Escape' && !saving) { event.preventDefault(); queue.edit(null); }
                    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && editingText.trim() && !saving) { event.preventDefault(); void save(item.id); }
                }} />
                    <div><Button type="text" size="small" disabled={saving} onClick={() => queue.edit(null)}>取消编辑</Button><Button size="small" loading={saving} disabled={!editingText.trim()} onClick={() => void save(item.id)}>保存</Button></div></div>
                : <><p>{item.text}</p><div className="canvas-assistant-queue-actions">
                    {item.state === 'uncertain' ? <><span>发送结果待核对</span><Button type="text" size="small" onClick={onCheck}>核对</Button></> : <>
                        <Tooltip title={hasReferences && streaming ? '素材引用将在下一轮读取' : streaming ? '在当前任务的下一个工具边界交给助手' : '现在发送这条消息'}><Button type="text" size="small" aria-label={streaming ? '立即引导' : '立即发送排队消息'} disabled={locked || Boolean(queue.busyId) || (streaming && (!canGuide || hasReferences))} icon={<Forward size={13} />} onClick={() => perform(streaming ? queue.guide(item.id) : queue.sendNow(item.id))}>{item.state === 'sending' ? item.mode === 'steer' ? '等待引导' : '发送中' : streaming ? '引导' : '发送'}</Button></Tooltip>
                        <Tooltip title="编辑消息"><Button type="text" size="small" aria-label="编辑排队消息" disabled={locked} icon={<Pencil size={13} />} onClick={() => { setEditingText(item.text); queue.edit(item.id); }} /></Tooltip>
                    </>}
                    <Tooltip title={item.state === 'sending' ? '已经交给运行端，等待接收' : '删除消息'}><Button type="text" size="small" aria-label="删除排队消息" disabled={disabled || queue.busyId === item.id || item.state === 'sending'} icon={<Trash2 size={13} />} onClick={() => perform(queue.remove(item.id))} /></Tooltip>
                </div></>}
            </li>;
        })}</ul>
    </section>;
}
