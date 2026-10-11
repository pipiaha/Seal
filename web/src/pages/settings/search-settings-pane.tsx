import { useEffect, useRef, useState } from "react";
import { App, Button, Input, InputNumber, Select, Spin, Switch } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { captureUserScope } from "@/lib/user-scope-guard";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { flushModelConfig, getModelConfigPersistenceState } from "@/services/model-config-repository";
import { getAssistantWebSettings, saveAssistantWebSettings, testAssistantWebSearch, type AssistantWebSettings, type AssistantWebStatus } from "@/services/api/assistant-workspace";

export function SearchSettingsPane() {
    const { message } = App.useApp();
    const [scope] = useState(() => captureUserScope());
    const client = useQueryClient();
    const key = ["assistant-tools", scope.userScope, scope.epoch];
    const status = useQuery({ queryKey: key, queryFn: ({ signal }) => getAssistantWebSettings(scope, signal) });
    const config = useEffectiveConfig();
    const channels = config.channels.filter(channel => channel.scope !== "system" && channel.enabled !== false && (channel.models.some(model => model.toLowerCase().includes("deepseek")) || channel.baseUrl?.toLowerCase().includes("api.deepseek.com")));
    const [draft, setDraft] = useState<AssistantWebSettings>();
    const [dirty, setDirty] = useState(false);
    const [query, setQuery] = useState("DeepSeek 官方文档");
    const controller = useRef<AbortController | null>(null);
    useEffect(() => { if (status.data && !dirty) setDraft(status.data.settings); }, [status.data, dirty]);
    useEffect(() => () => controller.current?.abort(), []);
    const test = useMutation({ mutationFn: () => {
        controller.current = new AbortController();
        return testAssistantWebSearch(query.trim(), scope, controller.current.signal);
    } });
    const change = (patch: Partial<AssistantWebSettings>) => {
        setDraft(current => current ? { ...current, configurationError: undefined, ...patch } : current);
        setDirty(true); test.reset();
    };
    const save = useMutation({ mutationFn: async (value: AssistantWebSettings) => {
        if (value.provider === "deepseek" && value.credentialSource === "channel") {
            await flushModelConfig();
            const state = getModelConfigPersistenceState();
            if (state.dirty || state.status === "error") throw new Error(state.error || "模型渠道尚未保存，请重试");
        }
        return saveAssistantWebSettings(value, scope);
    }, onSuccess: (settings) => {
        client.setQueryData<AssistantWebStatus>(key, current => current ? { ...current, settings } : current);
        setDraft(settings); setDirty(false); test.reset(); message.success("联网搜索配置已保存");
    }, onError: (error: Error) => message.error(error.message) });
    const busy = save.isPending || test.isPending;

    return <section className="asr-settings-pane">
        <div className="model-channel-heading"><h2>联网搜索</h2><Button size="small" loading={status.isFetching} disabled={dirty || busy} onClick={() => void status.refetch()}>刷新状态</Button></div>
        <p className="model-settings-hint">让创作助手搜索资料，并在回复中引用来源。画布与剪辑共用，独立于助手的对话模型。</p>
        {status.isPending && <Spin size="small" />}
        {status.isError && <p role="alert">{status.error.message}</p>}
        {draft && <>
            <div className="asr-service-heading"><h3>启用联网搜索</h3><Switch aria-label="启用联网搜索" checked={draft.enabled} disabled={busy} onChange={enabled => change({ enabled })} /></div>
            <div className="model-settings-field-grid">
                <label>搜索服务<Select aria-label="搜索服务" value={draft.provider} disabled={busy} options={[{ value: "tavily", label: "Tavily" }, { value: "deepseek", label: "DeepSeek 原生搜索" }]} onChange={provider => change({ provider, apiKey: "", clearKey: false, configured: false, credentialSource: provider === "deepseek" && channels.length ? "channel" : "manual", channelId: provider === "deepseek" ? channels[0]?.id : undefined })} /></label>
                <label>返回结果数量<InputNumber aria-label="返回结果数量" min={1} max={10} precision={0} value={draft.maxResults} disabled={busy} onChange={value => { if (value !== null) change({ maxResults: value }); }} /></label>
            </div>
            {draft.provider === "deepseek" && <>
                <p className="model-settings-hint">使用 DeepSeek 的原生搜索能力，无需 Tavily 密钥。每次搜索会产生一次额外模型调用。</p>
                <div className="model-settings-field-grid">
                    <label>密钥来源<Select aria-label="搜索密钥来源" value={draft.credentialSource} disabled={busy} options={[{ value: "channel", label: "复用已有 DeepSeek 渠道" }, { value: "manual", label: "独立填写 API Key" }]} onChange={credentialSource => change({ credentialSource, channelId: draft.channelId || channels[0]?.id, apiKey: "", clearKey: false, configured: false })} /></label>
                    {draft.credentialSource === "channel" && <label>DeepSeek 渠道<Select aria-label="DeepSeek 搜索渠道" placeholder="选择已配置的 DeepSeek 渠道" value={draft.channelId || undefined} disabled={busy} options={channels.map(channel => ({ value: channel.id, label: channel.name }))} onChange={channelId => change({ channelId, configured: false })} /></label>}
                </div>
                {draft.credentialSource === "channel" && <p className="model-settings-hint">只复用该渠道的密钥，搜索使用下面的独立接口。普通聊天中转不一定支持原生搜索。{!channels.length && "请先在文字分类添加 DeepSeek 渠道，或独立填写密钥。"}</p>}
                <label className="model-settings-wide-field">搜索模型<Input aria-label="DeepSeek 搜索模型" value={draft.model} disabled={busy} placeholder="deepseek-v4-flash" onChange={event => change({ model: event.target.value })} /></label>
                <details className="mt-4"><summary className="cursor-pointer">高级设置 · 搜索接口地址</summary><label className="model-settings-wide-field">基础地址<Input aria-label="DeepSeek 搜索接口地址" value={draft.baseUrl} disabled={busy} placeholder="https://api.deepseek.com/anthropic/v1" onChange={event => change({ baseUrl: event.target.value })} /></label><p className="model-settings-hint">填写支持原生搜索的 Anthropic 兼容基础地址，软件自动补充 /messages。</p></details>
            </>}
            {(draft.provider === "tavily" || draft.credentialSource === "manual") && <label className="model-settings-wide-field">{draft.provider === "tavily" ? "Tavily API Key" : "DeepSeek API Key"}<Input.Password aria-label="搜索 API Key" autoComplete="new-password" value={draft.apiKey || ""} disabled={busy} placeholder={draft.clearKey ? "保存后清除该服务的密钥" : "填写密钥；留空保留该服务已保存的密钥"} onChange={event => change({ apiKey: event.target.value, clearKey: false })} /></label>}
            <p className="model-settings-hint">{draft.configured ? "搜索凭证已就绪" : "搜索凭证尚未就绪"}。两家服务分别保存密钥，切换服务不会覆盖。网页读取与公开素材下载无需搜索密钥。</p>
            {draft.configurationError && <p role="alert">{draft.configurationError}</p>}
            <div className="asr-save-actions">
                <Button disabled={!dirty || busy} onClick={() => { setDraft(status.data!.settings); setDirty(false); test.reset(); }}>放弃修改</Button>
                <Button type="primary" loading={save.isPending} disabled={!dirty || test.isPending} onClick={() => save.mutate(draft)}>保存搜索配置</Button>
                {(draft.provider === "tavily" || draft.credentialSource === "manual") && <Button disabled={busy || draft.clearKey} onClick={() => change({ apiKey: "", clearKey: true, configured: false })}>清除当前服务密钥</Button>}
            </div>
            <div className="asr-service-heading"><h3>测试搜索</h3></div>
            <p className="model-settings-hint">先保存并启用配置，再执行一次真实搜索；将产生所选服务的调用用量。</p>
            <div className="flex items-center gap-2"><Input aria-label="测试搜索关键词" value={query} disabled={busy} maxLength={1000} onChange={event => { setQuery(event.target.value); test.reset(); }} /><Button loading={test.isPending} disabled={dirty || save.isPending || !draft.enabled || !draft.configured || !query.trim() || test.isPending} onClick={() => test.mutate()}>测试搜索</Button>{test.isPending && <Button onClick={() => controller.current?.abort()}>停止</Button>}</div>
            {test.isError && <p className="mt-3" role="alert">{test.error.message}</p>}
            {test.data && <div className="asr-local-status" role="status"><strong>搜索完成 · {test.data.sources.length} 条结果</strong>{test.data.sources.length === 0 && <p>服务未找到匹配结果，可以换一个关键词。</p>}<ul className="mt-3 space-y-3">{test.data.sources.map(source => <li key={source.id}><a className="underline" href={source.url} target="_blank" rel="noopener noreferrer">{source.title || source.url}</a>{source.publishedDate && <span> · {source.publishedDate}</span>}{source.excerpt && <p>{source.excerpt.slice(0, 300)}</p>}</li>)}</ul></div>}
        </>}
    </section>;
}
