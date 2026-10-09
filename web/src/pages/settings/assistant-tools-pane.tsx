import { useEffect, useState } from "react";
import { App, Button, Input, Spin, Switch } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { captureUserScope } from "@/lib/user-scope-guard";
import { getAssistantWebSettings, saveAssistantWebSettings, type AssistantWebSettings, type AssistantWebStatus } from "@/services/api/assistant-workspace";

export function AssistantToolsPane() {
    const { message } = App.useApp();
    const [scope] = useState(() => captureUserScope());
    const client = useQueryClient();
    const key = ["assistant-tools", scope.userScope, scope.epoch];
    const status = useQuery({ queryKey: key, queryFn: ({ signal }) => getAssistantWebSettings(scope, signal) });
    const [draft, setDraft] = useState<AssistantWebSettings>();
    const [dirty, setDirty] = useState(false);
    useEffect(() => { if (status.data && !dirty) setDraft(status.data.settings); }, [status.data, dirty]);
    const change = (patch: Partial<AssistantWebSettings>) => { setDraft(current => current ? { ...current, ...patch } : current); setDirty(true); };
    const save = useMutation({ mutationFn: (value: AssistantWebSettings) => saveAssistantWebSettings(value, scope), onSuccess: (settings) => {
        client.setQueryData<AssistantWebStatus>(key, current => current ? { ...current, settings } : current);
        setDraft(settings); setDirty(false); message.success("助手联网配置已保存");
    }, onError: (error: Error) => message.error(error.message) });
    return <section className="asr-settings-pane mt-8">
        <div className="model-channel-heading"><h2>助手工具</h2><Button size="small" loading={status.isFetching} disabled={dirty} onClick={() => void status.refetch()}>刷新状态</Button></div>
        {status.isPending && <Spin size="small" />}
        {status.isError && <p role="alert">{status.error.message}</p>}
        {status.data && draft && <>
            <div className="asr-local-status"><strong>本地脚本</strong><p>{status.data.runtime.sandbox ? "Windows 隔离运行已支持" : "当前平台暂不支持隔离脚本执行"} · Node {status.data.runtime.node ? "已就绪" : "未就绪"} · Python {status.data.runtime.python ? "已就绪" : "未安装"}</p><p>助手可处理当前工程的文件、素材副本和启用的 Skill 脚本。轨道修改保留版本与撤销；停止操作会结束脚本及其子进程。</p></div>
            <div className="asr-service-heading"><h3>联网搜索 · Tavily</h3><Switch aria-label="启用助手联网搜索" checked={draft.enabled} disabled={save.isPending} onChange={enabled => change({ enabled })} /></div>
            <p className="model-settings-hint">搜索需要 Tavily API Key。公开网页读取和素材下载可直接使用；助手会在回复中引用来源。</p>
            <div className="model-settings-field-grid"><label>搜索 API Key<Input.Password aria-label="搜索 API Key" autoComplete="off" value={draft.apiKey || ""} placeholder={draft.configured && !draft.clearKey ? "已保存，留空保留原密钥" : "tvly-…"} disabled={save.isPending} onChange={event => change({ apiKey: event.target.value, clearKey: false })} /></label></div>
            <div className="mt-4 flex gap-2"><Button type="primary" loading={save.isPending} disabled={!dirty} onClick={() => void save.mutate(draft)}>保存</Button>{draft.configured && <Button disabled={save.isPending} onClick={() => change({ apiKey: "", clearKey: true, configured: false })}>清除密钥</Button>}</div>
        </>}
    </section>;
}
