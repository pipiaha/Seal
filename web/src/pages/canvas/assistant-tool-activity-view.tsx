import { Check, CircleAlert, CircleDashed, LoaderCircle, ChevronRight, FileText, Terminal, Search, Clapperboard } from "lucide-react";
import { memo } from "react";
import type { AssistantToolActivity } from "@/services/api/agent-assistant";
import { toolActivityLabel } from "./assistant-tool-activity";

const statusLabels = { running: "执行中", completed: "已完成", error: "调用失败", interrupted: "结束状态未确认" };
const icons = { running: LoaderCircle, completed: Check, error: CircleAlert, interrupted: CircleDashed };

function ToolRow({ item }: { item: AssistantToolActivity }) {
    const Icon = icons[item.status];
    return <li data-tool-status={item.status} className="canvas-assistant-tool-record">
        <div className="canvas-assistant-tool-record-heading"><Icon size={13} className={item.status === 'running' ? 'canvas-assistant-tool-spinning' : undefined} aria-hidden />
            <span>{toolActivityLabel(item.tool)}</span><small>{statusLabels[item.status]}</small></div>
        {item.detail?.input ? <div className="canvas-assistant-tool-detail"><span>执行内容</span><pre>{item.detail.input}</pre></div> : null}
        {item.detail?.output ? <div className="canvas-assistant-tool-detail"><span>返回结果</span><pre>{item.detail.output}</pre></div> : null}
        {!item.detail?.input && !item.detail?.output ? <p className="canvas-assistant-meta">{item.status === 'running' ? '等待工具返回结果。' : '这条记录没有保存执行详情。'}</p> : null}
    </li>;
}

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
    const groups: AssistantToolActivity[][] = [];
    for (const item of items) {
        const group = groups.at(-1);
        if (group && toolActivityLabel(group[0].tool) === toolActivityLabel(item.tool)) group.push(item);
        else groups.push([item]);
    }
    const current = items.findLast(item => item.status === 'running');
    const Icon = current ? LoaderCircle : activityIcon(items[0].tool);
    return <details className="canvas-assistant-tool-activity" aria-label="工具执行记录">
        <summary><Icon size={14} className={current ? 'canvas-assistant-tool-spinning' : undefined} aria-hidden />
            <span>{batchLabel(items)}{items.length > 1 ? <small> · {items.length} 项</small> : null}</span>
            {current ? <small role="status">{toolActivityLabel(current.tool)}</small> : null}
            <ChevronRight size={13} className="canvas-assistant-tool-chevron" aria-hidden />
        </summary>
        <div className="canvas-assistant-tool-records">
        {groups.map(group => {
            return <section key={group[0].toolCallId} className="canvas-assistant-tool-group">
                {group.length > 1 ? <p className="canvas-assistant-meta">{toolActivityLabel(group[0].tool)} · {group.length} 次</p> : null}
                <ul>{group.map(item => <ToolRow key={item.toolCallId} item={item} />)}</ul>
            </section>;
        })}
        </div>
    </details>;
});
