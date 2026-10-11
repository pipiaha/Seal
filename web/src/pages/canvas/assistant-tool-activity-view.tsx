import { LoaderCircle, ChevronRight, FileText, Terminal, Search, Clapperboard } from "lucide-react";
import { memo, useState } from "react";
import type { AssistantToolActivity } from "@/services/api/agent-assistant";
import { toolActivityLabel } from "./assistant-tool-activity";

const statusLabels = { running: "执行中", completed: "已完成", error: "调用失败", interrupted: "结束状态未确认" };
function toolTarget(item: AssistantToolActivity): string {
    if (!item.detail?.input) return '';
    try {
        const input = JSON.parse(item.detail.input);
        if (!input || typeof input !== 'object' || Array.isArray(input)) return '';
        const target = [input.command, input.script, input.path, input.file, input.query, input.url, input.candidateId]
            .find(value => typeof value === 'string' && value.trim());
        return typeof target === 'string' ? target.replace(/\s+/g, ' ').trim().slice(0, 240) : '';
    } catch { return ''; }
}

const ToolRow = memo(function ToolRow({ item }: { item: AssistantToolActivity }) {
    const [expanded, setExpanded] = useState(false);
    const Icon = item.status === 'running' ? LoaderCircle : activityIcon(item.tool);
    const target = toolTarget(item);
    return <li data-tool-status={item.status} className="canvas-assistant-tool-record">
        <details onToggle={event => setExpanded(event.currentTarget.open)}>
        <summary className="canvas-assistant-tool-record-heading" aria-label={`${toolActivityLabel(item.tool)}${target ? `：${target}` : ''}，${statusLabels[item.status]}`}>
            <Icon size={13} className={item.status === 'running' ? 'canvas-assistant-tool-spinning' : undefined} aria-hidden />
            <span><span>{toolActivityLabel(item.tool)}</span>{target ? <span className="canvas-assistant-tool-target" title={target}>{target}</span> : null}</span>
            {item.status !== 'completed' ? <small>{statusLabels[item.status]}</small> : null}
            <ChevronRight size={12} className="canvas-assistant-tool-chevron" aria-hidden />
        </summary>
        {expanded ? <div className="canvas-assistant-tool-record-body">
        {item.detail?.input ? <div className="canvas-assistant-tool-detail"><span>执行内容</span><pre>{item.detail.input}</pre></div> : null}
        {item.detail?.output ? <div className="canvas-assistant-tool-detail"><span>返回结果</span><pre>{item.detail.output}</pre></div> : null}
        {!item.detail?.input && !item.detail?.output ? <p className="canvas-assistant-meta">{item.status === 'running' ? '等待工具返回结果。' : '这条记录没有保存执行详情。'}</p> : null}
        </div> : null}
        </details>
    </li>;
});

function activityIcon(tool: string) {
    if (/^workspace_(run|install)/.test(tool)) return Terminal;
    if (/search/.test(tool)) return Search;
    if (/^(read$|skill_|workflow_|tool_result_read|workspace_(info|files|runs)|web_read)/.test(tool)) return FileText;
    return Clapperboard;
}

function batchLabel(items: AssistantToolActivity[]) {
    const labels = [...new Set(items.map(item => {
        if (/^workspace_(run|install)$/.test(item.tool)) return '运行了命令';
        if (/^(read$|skill_(file|list)|workflow_read|tool_result_read|edit_(read|history|media_info)|hyperframes_(context|candidates|exports)|workspace_(info|runs))/.test(item.tool)) return '读取了文件与工程';
        if (/^web_|search/.test(item.tool)) return '检索了资料';
        if (/^workspace_/.test(item.tool)) return '处理了工程文件';
        if (/^hyperframes_|^edit_/.test(item.tool)) return '处理了剪辑场景';
        return '调用了制作工具';
    }))];
    return labels.length <= 2 ? labels.join('，') : '执行了制作操作';
}

export const AssistantToolActivityView = memo(function AssistantToolActivityView({ items }: { items: AssistantToolActivity[] }) {
    if (!items.length) return null;
    const current = items.findLast(item => item.status === 'running');
    const Icon = current ? LoaderCircle : activityIcon(items[0].tool);
    return <details className="canvas-assistant-tool-activity" aria-label="工具执行记录">
        <summary><Icon size={14} className={current ? 'canvas-assistant-tool-spinning' : undefined} aria-hidden />
            <span>{batchLabel(items)}{items.length > 1 ? <small> · {items.length} 项</small> : null}</span>
            {current ? <small role="status">{toolActivityLabel(current.tool)}</small> : null}
            <ChevronRight size={13} className="canvas-assistant-tool-chevron" aria-hidden />
        </summary>
        <div className="canvas-assistant-tool-records">
            <ul>{items.map(item => <ToolRow key={item.toolCallId} item={item} />)}</ul>
        </div>
    </details>;
});
