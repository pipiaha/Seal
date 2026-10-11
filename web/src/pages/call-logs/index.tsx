import { useEffect, useState } from 'react';
import { App, Button, Input, Select, Spin } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { ChevronRight, Copy, FileText, RefreshCw, Search } from 'lucide-react';
import { PageHeader, PaginationBar, WorkspacePage } from '@/components/layout/workspace-page';
import { WorkspaceState } from '@/components/layout/workspace-state';
import { AppModal } from '@/components/ui/product/app-modal';
import { captureUserScope } from '@/lib/user-scope-guard';
import { useConfigStore } from '@/stores/use-config-store';
import { listMediaCalls, readMediaCall, readMediaRequest, type MediaCall, type MediaCallType } from '@/services/api/call-logs';
import './call-logs.css';

const typeLabels: Record<MediaCallType, string> = { image: '图片', video: '视频', asr: 'ASR', audio: '语音' };
const statusLabels: Record<string, string> = { succeeded: '已完成', failed: '失败', running: '处理中', queued: '排队中', uncertain: '提交待确认', cancelled: '已取消' };
const requestLabels: Record<string, string> = { create: '创建请求', poll: '查询状态', download: '下载结果', upload: '上传素材', repair: '恢复结果', preflight: '调用准备' };

function dateLabel(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false });
}
function durationLabel(ms: number) { return ms < 1000 ? `${Math.max(0, ms)} ms` : `${(ms / 1000).toFixed(1)} 秒`; }
function hostLabel(call: MediaCall) {
    try { return new URL(call.upstreamUrl).host; } catch { return call.channelId || '未发出请求'; }
}
function statusCodeLabel(call: MediaCall) {
    return call.statusCode ? `HTTP ${call.statusCode}` : call.method === 'INTERNAL' ? '请求未发出' : '未收到 HTTP 响应';
}
function prettyPayload(value?: string) {
    if (!value) return '';
    try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
}
function CallStatus({ value }: { value: string }) {
    return <span className={`call-log-status is-${value}`}><i aria-hidden />{statusLabels[value] || value}</span>;
}

export default function CallLogsPage() {
    const [scope] = useState(() => captureUserScope());
    const [params, setParams] = useSearchParams();
    const capability = params.get('capability') || '';
    const status = params.get('status') || '';
    const taskId = params.get('taskId') || '';
    const logId = params.get('logId');
    const [keyword, setKeyword] = useState('');
    const [search, setSearch] = useState('');
    const [channelId, setChannelId] = useState('');
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(30);
    const channels = useConfigStore(state => state.config.channels);
    useEffect(() => { const timer = setTimeout(() => { setSearch(keyword.trim()); setPage(1); }, 300); return () => clearTimeout(timer); }, [keyword]);
    const logs = useQuery({ queryKey: ['media-call-logs', scope.userScope, scope.epoch, capability, status, taskId, search, channelId, page, limit],
        queryFn: ({ signal }) => listMediaCalls({ capability, status, taskId, keyword: search, channelId, page, limit }, scope, signal), refetchInterval: 5000 });
    function changeParam(name: string, value: string) {
        const next = new URLSearchParams(params);
        if (value) next.set(name, value); else next.delete(name);
        setParams(next, { replace: true });
        if (name !== 'logId') setPage(1);
    }
    return <WorkspacePage className="call-logs-page">
        <PageHeader title="调用日志" description="查看媒体请求的实际地址与响应。" actions={<Button icon={<RefreshCw size={15} />} loading={logs.isFetching} onClick={() => void logs.refetch()}>刷新</Button>} />
        <div className="call-log-toolbar">
            <div className="call-log-type-tabs" role="group" aria-label="调用类型">
                {[['', '全部'], ...Object.entries(typeLabels)].map(([key, label]) => <button key={key} type="button" aria-pressed={capability === key} onClick={() => changeParam('capability', key)}>{label}</button>)}
            </div>
            <div className="call-log-filters">
                <Input aria-label="搜索调用日志" placeholder="搜索模型、任务 ID 或地址" prefix={<Search size={15} />} value={keyword} onChange={event => setKeyword(event.target.value)} allowClear />
                <Select aria-label="筛选渠道" value={channelId} onChange={value => { setChannelId(value); setPage(1); }} options={[{ value: '', label: '全部渠道' }, ...channels.map(channel => ({ value: channel.id, label: channel.name })), { value: 'online-asr', label: '在线 ASR' }]} />
                <Select aria-label="筛选调用状态" value={status} onChange={value => changeParam('status', value)} options={[{ value: '', label: '全部状态' }, { value: 'failed', label: '失败' }, { value: 'uncertain', label: '提交待确认' }, { value: 'running', label: '处理中' }, { value: 'succeeded', label: '已完成' }]} />
            </div>
        </div>
        {taskId && <div className="call-log-task-filter">当前任务：<code>{taskId}</code><Button size="small" type="text" onClick={() => changeParam('taskId', '')}>查看全部</Button></div>}
        {logs.isError ? <WorkspaceState icon="settings" compact title="无法读取调用日志" description={logs.error.message} action={<Button onClick={() => void logs.refetch()}>重试</Button>} /> : logs.isPending ? <div className="call-log-loading"><Spin /></div> : !logs.data.items.length ? <WorkspaceState icon="settings" compact title={search || capability || status || taskId || channelId ? '没有符合条件的调用记录' : '还没有媒体调用记录'} description="图片、视频、在线 ASR 和语音请求会在这里显示。" /> : <div className="call-log-list-scroll">
            <div className="call-log-list-header" aria-hidden><span>时间</span><span>类型</span><span>渠道 / 模型</span><span>请求地址</span><span>状态</span><span>请求耗时</span><span /></div>
            <ul className="call-log-list" aria-label="媒体调用记录">{logs.data.items.map(entry => <li key={entry.id}><button type="button" className="call-log-row" aria-label={`查看 ${entry.model} 调用详情`} onClick={() => changeParam('logId', entry.id)}>
                <span className="call-log-time">{dateLabel(entry.createdAt)}</span><span>{typeLabels[entry.capability] || entry.capability}</span>
                <span className="call-log-model"><strong>{entry.channelName || hostLabel(entry)}</strong><small>{entry.model || '未记录模型'}</small></span>
                <span className="call-log-address"><strong>{hostLabel(entry)}</strong><small>{entry.path || '请求未发出'}</small></span>
                <span><CallStatus value={entry.outcome} /><small className="call-log-count">{entry.requestCount} 次请求</small></span>
                <span>{durationLabel(entry.durationMs)}</span><ChevronRight size={15} />
            </button></li>)}</ul>
        </div>}
        {logs.data && <PaginationBar current={page} pageSize={limit} total={logs.data.total} pageSizeOptions={[30, 50, 100]} onChange={(next, size) => { setPage(next); setLimit(size); }} />}
        {logId && <CallLogModal key={logId} id={logId} scope={scope} onClose={() => changeParam('logId', '')} />}
    </WorkspacePage>;
}

function CallLogModal({ id, scope, onClose }: { id: string; scope: ReturnType<typeof captureUserScope>; onClose: () => void }) {
    const { message } = App.useApp();
    const [requestPage, setRequestPage] = useState(1);
    const [requestId, setRequestId] = useState(id);
    const [tab, setTab] = useState('response');
    const detail = useQuery({ queryKey: ['media-call-detail', scope.userScope, scope.epoch, id, requestPage], queryFn: ({ signal }) => readMediaCall(id, requestPage, scope, signal), refetchInterval: 5000 });
    const request = useQuery({ queryKey: ['media-call-request', scope.userScope, scope.epoch, id, requestId], queryFn: ({ signal }) => readMediaRequest(id, requestId, scope, signal), enabled: Boolean(detail.data), staleTime: 5000 });
    async function copy(value: string) {
        try { await navigator.clipboard.writeText(value); message.success('已复制'); } catch { message.error('复制失败，可以选中文字后复制'); }
    }
    const entry = detail.data?.entry;
    const selected = request.data;
    const response = prettyPayload(selected?.responseBody);
    const body = tab === 'request' ? prettyPayload(selected?.requestBody) : response;
    return <AppModal open centered title="调用详情" width="min(1120px, calc(100vw - 32px))" footer={null} onCancel={onClose}>
        {detail.isPending ? <div className="call-log-loading"><Spin /></div> : detail.isError ? <p role="alert">{detail.error.message} <Button onClick={() => void detail.refetch()}>重试</Button></p> : entry ? <>
            <div className="call-log-detail-overview"><div><strong>{entry.channelName || hostLabel(entry)}</strong><span>{typeLabels[entry.capability]} · {entry.model}</span></div><CallStatus value={entry.outcome} /></div>
            {entry.taskId && <div className="call-log-detail-task">任务 ID <code>{entry.taskId}</code><button type="button" aria-label="复制任务 ID" onClick={() => void copy(entry.taskId!)}><Copy size={14} /></button></div>}
            {Boolean(entry.pollCount) && <p className="call-log-detail-note">这条旧日志曾合并查询响应，未保留每次请求；更新后的调用会保存完整过程。</p>}
            <div className="call-log-detail-layout">
                <aside className="call-log-requests" aria-label="任务请求过程">
                    <div className="call-log-request-heading">请求过程 <span>{detail.data.total}</span></div>
                    {detail.data.requests.map(item => <button type="button" key={item.id} aria-pressed={requestId === item.id} className="call-log-request-row" onClick={() => setRequestId(item.id)}>
                        <span>{requestLabels[item.requestKind] || item.requestKind || '请求'}<small>{item.method} · {item.statusCode || '无响应'}</small></span>
                        <small>{dateLabel(item.startedAt || item.createdAt)} · {durationLabel(item.durationMs)}</small>
                    </button>)}
                    {detail.data.total > detail.data.pageSize && <div className="call-log-request-pager"><Button size="small" disabled={requestPage === 1} onClick={() => setRequestPage(value => value - 1)}>上一页</Button><span>{requestPage}</span><Button size="small" disabled={requestPage * detail.data.pageSize >= detail.data.total} onClick={() => setRequestPage(value => value + 1)}>下一页</Button></div>}
                </aside>
                <section className="call-log-request-detail" aria-label="请求与响应">
                    {request.isPending ? <div className="call-log-loading"><Spin /></div> : request.isError ? <p role="alert">{request.error.message} <Button onClick={() => void request.refetch()}>重试</Button></p> : selected ? <>
                        <div className="call-log-url-heading"><span>{selected.method} · {statusCodeLabel(selected)}</span><Button size="small" type="text" icon={<Copy size={14} />} disabled={!selected.upstreamUrl} onClick={() => void copy(selected.upstreamUrl)}>复制地址</Button></div>
                        <code className="call-log-full-url">{selected.upstreamUrl || '此步骤没有发出网络请求'}</code>
                        <div className="call-log-request-meta"><span>耗时 {durationLabel(selected.durationMs)}</span>{selected.providerRequestId && <span>上游任务 {selected.providerRequestId}</span>}</div>
                        {selected.error && <div className="call-log-error" role="status"><strong>{selected.errorCode || '调用错误'}</strong><p>{selected.error}</p></div>}
                        <div className="call-log-payload-tabs" role="group" aria-label="报文类型"><button type="button" aria-pressed={tab === 'response'} onClick={() => setTab('response')}>响应内容</button><button type="button" aria-pressed={tab === 'request'} onClick={() => setTab('request')}>请求参数</button><Button type="text" size="small" icon={<Copy size={14} />} disabled={!body} onClick={() => void copy(body)}>复制内容</Button></div>
                        {tab === 'request' && selected.requestContentType && <div className="call-log-content-type">{selected.requestContentType}</div>}
                        {body ? <pre className="call-log-payload">{body}</pre> : <div className="call-log-payload-empty"><FileText size={22} /><p>{tab === 'request' ? '此请求没有请求体或旧记录未保存参数' : selected.statusCode === 0 ? '未收到服务响应，请查看上方错误信息' : '响应正文为空，或旧记录未保存响应内容'}</p></div>}
                        <p className="call-log-detail-note">密钥和签名参数已隐藏；内嵌媒体只保留类型与大小。</p>
                    </> : null}
                </section>
            </div>
        </> : null}
    </AppModal>;
}
