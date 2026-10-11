import { useState } from "react";
import { Spin } from "antd";
import { useQuery } from "@tanstack/react-query";
import { captureUserScope } from "@/lib/user-scope-guard";
import { getAssistantWebSettings } from "@/services/api/assistant-workspace";

export function AssistantToolsPane() {
    const [scope] = useState(() => captureUserScope());
    const key = ["assistant-tools", scope.userScope, scope.epoch];
    const status = useQuery({ queryKey: key, queryFn: ({ signal }) => getAssistantWebSettings(scope, signal) });
    return <section className="asr-settings-pane mt-8">
        <div className="model-channel-heading"><h2>助手工具</h2></div>
        {status.isPending && <Spin size="small" />}
        {status.isError && <p role="alert">{status.error.message}</p>}
        {status.data && <>
            <div className="asr-local-status"><strong>本地脚本 · 完全访问</strong><p>使用当前系统账户运行 · Node {status.data.runtime.node ? "已就绪" : "未就绪"} · Python {status.data.runtime.python ? "已就绪" : "未安装"}</p><p>工程目录是默认工作位置，脚本可访问系统账户有权限的其他文件和网络。不向脚本环境注入应用密钥或令牌；停止和超时会结束脚本及其子进程。付费生成继续遵循对话中的审批设置。</p></div>
        </>}
    </section>;
}
