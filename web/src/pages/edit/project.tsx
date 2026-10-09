import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { App, Button, Dropdown, InputNumber, Spin } from 'antd';
import { ArrowLeft, RefreshCw, Sparkles } from 'lucide-react';
import { openEditProject, getEditContext, listEditMaterials, readEditVisual, type EditLaunch } from '@/services/api/edit-projects';
import type { AssistantImage } from '@/services/api/agent-assistant';
import type { CanvasResourceReference } from '@/lib/canvas/canvas-resource-references';
import { CanvasAssistantSidebar } from '@/pages/canvas/canvas-assistant-sidebar';
import { useCanvasAssistant } from '@/pages/canvas/use-canvas-assistant';
import { EditAssets } from './edit-assets';
import { EditProductions } from './edit-productions';
import { useUserStore } from '@/stores/use-user-store';
import { useThemeStore } from '@/stores/use-theme-store';
import { useQuery } from '@tanstack/react-query';
import { captureUserScope } from '@/lib/user-scope-guard';
import { getEditingProject } from '@/services/api/edit-projects';
import { AppModal } from '@/components/ui/product/app-modal';
import { registerDesktopUpdatePreparation } from '@/services/desktop-update-preparation';
import './project.css';

const compositionSizes = [
    { key: 'landscape', label: '横屏 · 16:9', width: 1920, height: 1080 },
    { key: 'portrait', label: '竖屏 · 9:16', width: 1080, height: 1920 },
    { key: 'square', label: '正方形 · 1:1', width: 1080, height: 1080 },
    { key: 'classic', label: '经典 · 4:3', width: 1440, height: 1080 },
];

export default function EditProjectPage() {
    const { message } = App.useApp();
    const { projectId = '' } = useParams();
    const navigate = useNavigate();
    const userId = useUserStore(state => state.user?.id);
    const theme = useThemeStore(state => state.theme);
    const [scope] = useState(() => captureUserScope());
    const project = useQuery({ queryKey: ['editing-project', scope.userScope, scope.epoch, projectId],
        queryFn: ({ signal }) => getEditingProject(projectId, scope, signal) });
    const [launch, setLaunch] = useState<EditLaunch | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);
    const [revision, setRevision] = useState(0);
    const [compositionSize, setCompositionSize] = useState({ width: 0, height: 0 });
    const [customSize, setCustomSize] = useState({ width: 1920, height: 1080 });
    const [customSizeOpen, setCustomSizeOpen] = useState(false);
    const [savingSize, setSavingSize] = useState(false);
    const [sizeError, setSizeError] = useState('');
    const [editCommand, setEditCommand] = useState<{ action: string; id: string }>();
    const [assistantPrefill, setAssistantPrefill] = useState<{ id: string; text: string }>();
    const sizeRequests = useRef(new Map<string, { resolve: (size: { width: number; height: number }) => void; reject: (error: Error) => void; timeout: number }>());
    const formRef = useRef<HTMLFormElement>(null);
    const frameRef = useRef<HTMLIFrameElement>(null);
    const visualRequests = useRef(new Map<string, { resolve: (selection: { playheadTime: number; clipIds: string[] }) => void; reject: (error: Error) => void; timeout: number }>());
    const visualSelection = useCallback(async () => {
        if (!launch || !frameRef.current?.contentWindow) throw new Error('剪辑编辑器尚未就绪');
        const requestId = crypto.randomUUID();
        return new Promise<{ playheadTime: number; clipIds: string[] }>((resolve, reject) => {
            const timeout = window.setTimeout(() => { visualRequests.current.delete(requestId); reject(new Error('读取播放位置超时，请重试')); }, 10_000);
            visualRequests.current.set(requestId, { resolve, reject, timeout });
            frameRef.current!.contentWindow!.postMessage({ type: 'beeftv:visual-context', editId: launch.editId, requestId }, launch.studioUrl);
        });
    }, [launch]);
    useEffect(() => () => {
        for (const pending of visualRequests.current.values()) { window.clearTimeout(pending.timeout); pending.reject(new Error('剪辑页面已切换')); }
        visualRequests.current.clear();
    }, [projectId, launch?.editId]);
    const updateRequests = useRef(new Map<string, { resolve: () => void; reject: (error: Error) => void; timeout: number }>());
    const frameName = `beeftv-edit-${projectId}`;
    const materials = useQuery({ queryKey: ['editing-materials', scope.userScope, scope.epoch, projectId, launch?.editId, revision],
        enabled: Boolean(launch), queryFn: ({ signal }) => listEditMaterials(projectId, launch!.editId, scope, signal) });
    const references = useMemo<CanvasResourceReference[]>(() => (materials.data?.materials || []).map(material => ({
        id: `media:${material.file}`, nodeId: '', kind: material.kind, label: material.title, title: material.title,
        text: material.file, active: true, mentionToken: `@[media:${material.file}]`,
    })), [materials.data]);
    const assistant = useCanvasAssistant({ canvasId: projectId,
        getWorkspaceContext: async () => {
            if (!launch) throw new Error('编辑工程还未打开');
            const selection = await visualSelection();
            const context = await getEditContext(projectId, launch.editId, scope);
            return { ...context, selection };
        },
        onCanvasChanged: () => frameRef.current?.contentWindow?.postMessage({ type: 'beeftv:edit-context' }, launch?.studioUrl || ''),
    });
    const locateNodes = useCallback(() => navigate('/project'), [navigate]);
    const runProposal = useCallback(() => navigate('/project'), [navigate]);

    useEffect(() => registerDesktopUpdatePreparation(async () => {
        if (assistant.modelBusy) throw new Error('创作助手仍在工作，请等本轮制作结束再更新');
        if (savingSize) throw new Error('画面比例正在保存，请稍后再更新');
        if (!launch || !frameRef.current?.contentWindow) throw new Error('剪辑工程尚未就绪，请返回工程列表后再更新');
        const requestId = crypto.randomUUID();
        await new Promise<void>((resolve, reject) => {
            const timeout = window.setTimeout(() => { updateRequests.current.delete(requestId); reject(new Error('等待剪辑保存超时，请稍后再更新')); }, 10_000);
            updateRequests.current.set(requestId, { resolve, reject, timeout });
            frameRef.current!.contentWindow!.postMessage({ type: 'beeftv:prepare-update', editId: launch.editId, requestId }, launch.studioUrl);
        });
    }), [launch, assistant.modelBusy, savingSize]);
    useEffect(() => () => {
        for (const pending of updateRequests.current.values()) { window.clearTimeout(pending.timeout); pending.reject(new Error('剪辑页面已经关闭，请重试更新')); }
        updateRequests.current.clear();
    }, []);

    useEffect(() => {
        if (project.data?.id !== projectId) return;
        let active = true;
        setError(null);
        setLaunch(null);
        void openEditProject(projectId).then(result => {
            if (!active) return;
            setLaunch(result);
            setRevision(result.revision);
        }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '编辑工程打开失败'); });
        return () => { active = false; };
    }, [projectId, project.data?.id, attempt]);

    useEffect(() => { if (launch) formRef.current?.submit(); }, [launch]);
    function sendTheme() {
        if (!launch) return;
        const style = getComputedStyle(document.documentElement);
        const color = (name: string) => style.getPropertyValue(name).trim();
        frameRef.current?.contentWindow?.postMessage({ type: 'beeftv:edit-theme', editId: launch.editId, theme,
            colors: { background: color('--background'), surface: color('--card'), raised: color('--popover'),
                foreground: color('--foreground'), muted: color('--muted-foreground'), border: color('--border'),
                accent: color('--primary'), onAccent: color('--primary-foreground') } }, launch.studioUrl);
    }
    useEffect(() => { sendTheme(); }, [theme, launch]);
    useEffect(() => {
        const receive = (event: MessageEvent) => {
            if (event.origin !== launch?.studioUrl || event.source !== frameRef.current?.contentWindow || event.data?.editId !== launch.editId) return;
            if (event.data.type === 'beeftv:visual-context-result') {
                const pending = visualRequests.current.get(event.data.requestId);
                if (!pending) return;
                window.clearTimeout(pending.timeout); visualRequests.current.delete(event.data.requestId);
                if (event.data.error) pending.reject(new Error(event.data.error));
                else if (!Number.isFinite(event.data.selection?.playheadTime) || !Array.isArray(event.data.selection?.clipIds)) pending.reject(new Error('播放位置无效'));
                else pending.resolve(event.data.selection);
                return;
            }
            if (event.data.type === 'beeftv:update-prepared') {
                const pending = updateRequests.current.get(event.data.requestId);
                if (!pending) return;
                window.clearTimeout(pending.timeout); updateRequests.current.delete(event.data.requestId);
                if (event.data.error) pending.reject(new Error(event.data.error)); else pending.resolve();
                return;
            }
            if (event.data.type === 'beeftv:edit-theme-ready') sendTheme();
            if (event.data.type === 'beeftv:editor-action') {
                const action = event.data.action;
                if (['import-file', 'asset-library', 'export-results'].includes(action)) setEditCommand({ action, id: crypto.randomUUID() });
                if (action === 'assistant') {
                    assistant.setOpen(true);
                    if (typeof event.data.prompt === 'string') setAssistantPrefill({ id: crypto.randomUUID(), text: event.data.prompt });
                }
                if (action === 'aspect-ratio') {
                    setCustomSize({ width: compositionSize.width || 1920, height: compositionSize.height || 1080 });
                    setCustomSizeOpen(true); setSizeError('');
                }
            }
            if (event.data.type === 'beeftv:export-download-error') message.error(event.data.error || '视频下载失败，请重试');
            if (event.data.type === 'beeftv:edit-state' && Number.isSafeInteger(event.data.revision)) setRevision(event.data.revision);
            if (event.data.type === 'beeftv:composition-size' && Number.isSafeInteger(event.data.width) && Number.isSafeInteger(event.data.height)) {
                setCompositionSize({ width: event.data.width, height: event.data.height });
            }
            if (event.data.type === 'beeftv:composition-size-saved' || event.data.type === 'beeftv:composition-size-error') {
                const pending = sizeRequests.current.get(event.data.requestId);
                if (!pending) return;
                window.clearTimeout(pending.timeout);
                sizeRequests.current.delete(event.data.requestId);
                if (event.data.type === 'beeftv:composition-size-error') pending.reject(new Error(event.data.error || '画面比例保存失败'));
                else pending.resolve({ width: event.data.width, height: event.data.height });
            }
        };
        window.addEventListener('message', receive);
        return () => window.removeEventListener('message', receive);
    }, [launch, theme, message, compositionSize, assistant.setOpen]);

    async function applyCompositionSize(width: number, height: number) {
        if (!launch || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
            || width > 8192 || height > 8192 || width * height > 16_777_216) {
            setSizeError('宽高须为 1 至 8192 的整数，且画面总像素不能超过 1677 万');
            return;
        }
        setSavingSize(true);
        setSizeError('');
        try {
            const requestId = crypto.randomUUID();
            const contentWindow = frameRef.current?.contentWindow;
            if (!contentWindow) throw new Error('剪辑编辑器尚未准备好');
            const savedSize = await new Promise<{ width: number; height: number }>((resolve, reject) => {
                const timeout = window.setTimeout(() => {
                    sizeRequests.current.delete(requestId);
                    reject(new Error('保存画面比例超时，请重试'));
                }, 30_000);
                sizeRequests.current.set(requestId, { resolve, reject, timeout });
                contentWindow.postMessage({ type: 'beeftv:set-composition-size', editId: launch.editId,
                    requestId, width, height }, launch.studioUrl);
            });
            setCompositionSize(savedSize);
            setCustomSizeOpen(false);
        } catch (error) {
            setSizeError(error instanceof Error ? error.message : '画面比例保存失败');
        } finally {
            setSavingSize(false);
        }
    }
    const aspectLabel = compositionSizes.find(size => Math.abs(compositionSize.width / compositionSize.height - size.width / size.height) < 0.01)?.label.split(' · ')[1]
        || (compositionSize.width > 0 && compositionSize.height > 0 ? '自定义' : '读取中');

    return <section className="editing-project flex h-full min-h-0 flex-col bg-[var(--background)]">
        <header className="editing-project-header">
            <Link to="/editing" className="inline-flex items-center gap-2"><ArrowLeft size={16} />剪辑工程</Link>
            <span className="min-w-0 truncate text-sm">{project.data?.title || '剪辑'}</span>
            {project.isError ? <span role="alert" className="text-xs">{project.error.message}</span> : null}
            {launch ? <EditAssets key={`${userId}:${launch.editId}`} projectId={projectId} editId={launch.editId} command={editCommand} hideButtons onRevision={value => {
                setRevision(value);
                frameRef.current?.contentWindow?.postMessage({ type: 'beeftv:edit-context' }, launch.studioUrl);
            }} /> : null}
            {launch ? <EditProductions key={`production:${userId}:${launch.editId}`} projectId={projectId} editId={launch.editId} onRevision={value => {
                setRevision(value);
                frameRef.current?.contentWindow?.postMessage({ type: 'beeftv:edit-context' }, launch.studioUrl);
            }} /> : null}
            <Dropdown disabled={!launch || savingSize} trigger={['click']} menu={{ items: [
                ...compositionSizes.map(size => ({ key: size.key, label: <span className="flex min-w-40 items-center justify-between gap-5"><span>{size.label}</span><span className="text-xs text-[var(--muted-foreground)]">{size.width} × {size.height}</span></span> })),
                { type: 'divider' },
                { key: 'custom', label: '自定义尺寸…' },
            ], onClick: ({ key }) => {
                const preset = compositionSizes.find(size => size.key === key);
                if (preset) void applyCompositionSize(preset.width, preset.height);
                else if (key === 'custom') {
                    setCustomSize({ width: compositionSize.width || 1920, height: compositionSize.height || 1080 });
                    setCustomSizeOpen(true);
                    setSizeError('');
                }
            } }}>
                <Button size="small" loading={savingSize} disabled={!launch}>{savingSize ? '正在保存' : `画面比例 · ${aspectLabel}`}</Button>
            </Dropdown>
            <span className="ml-auto text-xs text-[var(--muted-foreground)]" title={`工程版本 ${revision}`}>已保存 · v{revision}</span>
            <Button type="text" size="small" onClick={() => setEditCommand({ action: 'export-results', id: crypto.randomUUID() })}>导出记录</Button>
            <Button type="text" size="small" aria-pressed={assistant.open} icon={<Sparkles size={16} />} onClick={() => assistant.setOpen(!assistant.open)}>创作助手</Button>
        </header>
        <div className="editing-project-workspace">
            <main className="relative min-w-0 flex-1">
                {!launch && !error && !project.isError ? <div className="grid h-full place-items-center"><Spin tip="正在打开剪辑工程" /></div> : null}
                {project.isError ? <div role="alert" className="grid h-full place-items-center">无法打开这份剪辑工程，请返回工程列表。</div> : null}
                {error ? <div className="grid h-full place-items-center"><div role="alert"><p>{error}</p><Button icon={<RefreshCw size={16} />} onClick={() => setAttempt(value => value + 1)}>重新打开</Button></div></div> : null}
                {launch ? <>
                    <form ref={formRef} action={`${launch.studioUrl}/__session`} method="post" target={frameName} hidden>
                        <input name="ticket" value={launch.ticket} readOnly />
                    </form>
                    <iframe ref={frameRef} name={frameName} title="HyperFrames 剪辑编辑器" className="h-full w-full border-0" allow="clipboard-read; clipboard-write" onLoad={sendTheme} />
                </> : null}
            </main>
            {assistant.open ? <div className="editing-assistant-column" style={{ width: assistant.width }}>
                {materials.isError ? <div className="editing-materials-error" role="alert">素材列表读取失败<Button type="text" size="small" onClick={() => void materials.refetch()}>重试</Button></div> : null}
                <CanvasAssistantSidebar assistant={assistant} canvasTitle={project.data?.title || '剪辑工程'} dockable readOnly={!launch} prefill={assistantPrefill}
                captureVisual={async target => {
                    if (!launch) throw new Error('剪辑工程尚未打开');
                    const selection = await visualSelection();
                    if (target === 'selection' && !selection.clipIds.length) throw new Error('请先在时间线上选择片段');
                    const context = await getEditContext(projectId, launch.editId, scope);
                    const result = await readEditVisual(projectId, launch.editId, { expectedRevision: context.revision,
                        ...(target === 'selection' ? { clipIds: selection.clipIds } : { time: selection.playheadTime }) }, scope);
                    return result.images.map((image): AssistantImage => ({ id: crypto.randomUUID(), name: `${target === 'selection' ? '选中片段' : '当前画面'} · ${image.time.toFixed(2)}s`,
                        mimeType: image.mimeType, data: image.data, source: `edit:${launch.editId};revision:${result.revision};time:${image.time};clips:${selection.clipIds.join(',')}`.slice(0, 512) }));
                }}
                resolveVisualReferences={async text => {
                    if (!launch) throw new Error('剪辑工程尚未打开');
                    const files = [...new Set(Array.from(text.matchAll(/@\[media:([^\]]+)\]/g), match => match[1]))];
                    if (files.length > 8) throw new Error('一次最多引用 8 个工程素材');
                    const images: AssistantImage[] = [];
                    for (const file of files) {
                        const material = materials.data?.materials.find(material => material.file === file);
                        if (!material) throw new Error('引用的素材已变化，请重新选择');
                        if (material.kind !== 'image') continue;
                        const result = await readEditVisual(projectId, launch.editId, { file }, scope);
                        images.push(...result.images.map((image): AssistantImage => ({ id: crypto.randomUUID(), name: material.title.slice(0, 120),
                            mimeType: image.mimeType, data: image.data, source: `media:${file};revision:${result.revision};time:${image.time}`.slice(0, 512) })));
                    }
                    return images;
                }}
                selectedNodeIds={[]} references={references} includeAssetLibrary={false} workspaceLabel="当前剪辑工程" referencesLabel="工程素材" onLocateNodes={locateNodes}
                proposalActionLabel="去画布生成" onRunProposal={runProposal}
                onOpenModelSettings={() => navigate('/settings')} /></div> : null}
        </div>
        <AppModal title="自定义画面尺寸" open={customSizeOpen} onCancel={() => { if (!savingSize) setCustomSizeOpen(false); }}
            onOk={() => void applyCompositionSize(customSize.width, customSize.height)} confirmLoading={savingSize} okText="应用">
            <p className="mb-3 text-sm text-[var(--muted-foreground)]">设置工程的画面宽高，时间线素材会按新画幅重新预览。</p>
            <div className="mb-4 grid grid-cols-2 gap-2">{compositionSizes.map(size => <Button key={size.key} disabled={savingSize}
                onClick={() => void applyCompositionSize(size.width, size.height)}>{size.label}</Button>)}</div>
            <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1 text-sm">宽度<InputNumber min={1} max={8192} precision={0} value={customSize.width} onChange={width => setCustomSize(size => ({ ...size, width: Number(width) || 0 }))} /></label>
                <label className="grid gap-1 text-sm">高度<InputNumber min={1} max={8192} precision={0} value={customSize.height} onChange={height => setCustomSize(size => ({ ...size, height: Number(height) || 0 }))} /></label>
            </div>
            {sizeError ? <p role="alert" className="mt-3 text-sm text-destructive">{sizeError}</p> : null}
        </AppModal>
        {sizeError && !customSizeOpen ? <span role="alert" className="absolute left-4 top-14 z-10 rounded bg-surface p-2 text-xs text-destructive">{sizeError}</span> : null}
    </section>;
}
