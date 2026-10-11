import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { App, ConfigProvider, theme } from 'antd';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CanvasAssistantSidebar } from '@/pages/canvas/canvas-assistant-sidebar';
import { useCanvasAssistant } from '@/pages/canvas/use-canvas-assistant';
import { hydrateModelConfig } from '@/services/model-config-repository';
import { useConfigStore } from '@/stores/use-config-store';

useConfigStore.getState().replaceConfig((await hydrateModelConfig()).config);
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function Harness() {
    const [canvasId, setCanvasId] = useState('short');
    const [dark, setDark] = useState(true);
    const assistant = useCanvasAssistant({ canvasId });
    useEffect(() => { assistant.setOpen(true); }, []);
    useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);
    return <ConfigProvider theme={{ algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm }}><App>
        <div style={{ display: 'flex', height: '100vh', padding: 20, gap: 24, background: 'var(--background)', color: 'var(--foreground)' }}>
            <div style={{ width: 270, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <h1>助手流式验收</h1><p>模拟数据，不调用模型。</p>
                <button onClick={() => setCanvasId(value => value === 'short' ? 'long' : 'short')}>切换长短对话</button>
                <button disabled={assistant.streaming} onClick={() => void assistant.send('请检查片段并说明结果', [])}>发送模拟请求</button>
                <button onClick={() => void fetch('/fixture/advance', { method: 'POST' })}>推进工具</button>
                <button onClick={() => void fetch('/fixture/finish', { method: 'POST' })}>结束回复</button>
                <button onClick={() => void fetch('/fixture/disconnect', { method: 'POST' })}>模拟断流</button>
                <button onClick={() => setDark(value => !value)}>切换主题</button>
                <p>当前工程：{canvasId} · 历史 {assistant.turns.length} 回合</p>
            </div>
            <div style={{ width: 480, minHeight: 0, display: 'flex' }}>
                <CanvasAssistantSidebar assistant={assistant} canvasTitle="流式与长历史验收" dockable readOnly={false} selectedNodeIds={[]} references={[]} onLocateNodes={() => {}} onRunProposal={() => {}} onOpenModelSettings={() => {}} />
            </div>
        </div>
    </App></ConfigProvider>;
}
createRoot(document.getElementById('root')!).render(<MemoryRouter><QueryClientProvider client={client}><Harness /></QueryClientProvider></MemoryRouter>);
