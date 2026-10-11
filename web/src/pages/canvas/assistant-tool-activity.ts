import type { AgentToolEvent, AssistantToolActivity } from "@/services/api/agent-assistant";

/** 并行、重复及迟到事件按调用 ID 合并，结束状态不可退回执行中。 */
export function updateToolActivity(items: AssistantToolActivity[], event: AgentToolEvent): AssistantToolActivity[] {
    const index = items.findIndex(item => item.toolCallId === event.toolCallId);
    const previous = items[index];
    if (previous && previous.status !== "running") return items;
    const status = event.phase === "end" ? (event.isError ? "error" : "completed") : "running";
    const updated = status === "running" && (event.phase === "update" || previous?.updated === true);
    const detail = previous?.detail || event.detail ? { ...previous?.detail, ...event.detail } : undefined;
    if (previous?.status === status && Boolean(previous.updated) === updated && JSON.stringify(previous.detail) === JSON.stringify(detail)) return items;
    const item: AssistantToolActivity = { toolCallId: event.toolCallId, tool: previous?.tool || event.tool, status, ...(updated ? { updated: true } : {}), ...(detail ? { detail } : {}) };
    return index < 0 ? [...items, item] : items.map((value, i) => i === index ? item : value);
}

export function settleToolActivity(items: AssistantToolActivity[]): AssistantToolActivity[] {
    return items.map(item => item.status === "running" ? { ...item, status: "interrupted" } : item);
}

export function toolActivityLabel(tool: string): string {
    const exact: Record<string, string> = { media_read: "分析音视频素材", edit_transcribe: "转写工程音频", edit_media_info: "分析工程素材", conversation_image_read: "查看对话图片", edit_view: "查看工程画面", read: "读取技能说明", edit_read: "读取剪辑工程", edit_history: "读取剪辑历史",
        edit_undo_entry: "撤销剪辑改动", edit_split_element: "切割片段", edit_remove_element: "删除片段", edit_patch_element: "调整片段",
        skill_list: "查看已安装技能", skill_file: "读取技能文件", skill_author: "编写技能", skill_search: "搜索技能", skill_download: "下载技能",
        workspace_info: "检查工作目录", workspace_files: "处理工程文件", workspace_skill: "准备技能脚本", workspace_run: "执行工程脚本", workspace_runs: "读取脚本执行记录", workspace_install: "安装工程依赖",
        workspace_asset_import: "复制素材到工程", workspace_publish: "保存结果到资产库", assets_search: "检索资产库", web_search: "联网搜索", web_read: "读取网页", web_download: "下载工程素材",
        provider_channels_read: "读取模型渠道", provider_script_preview: "检查接口配置", provider_channel_save: "保存模型渠道",
        workflow_read: "读取制作流程", workflow_checkpoint: "保存制作进度", tool_result_read: "读取检查结果", media_generation_propose: "准备生成方案",
        media_generation_task: "查询生成任务", media_generation_list: "读取生成方案", media_transcribe: "提交语音识别任务",
        media_transcription: "查询识别结果", media_asr_status: "检查语音识别能力" };
    if (Object.hasOwn(exact, tool)) return exact[tool];
    if (tool.startsWith("hyperframes_")) {
        const labels: Record<string, string> = { context: "读取剪辑工程", candidate: "制作候选场景", inspect: "检查场景",
            check: "检查场景可用性", lint: "检查场景结构", snapshot: "查看场景截图", review: "复查画面", candidates: "读取候选场景", export: "提交视频导出", exports: "读取导出任务", apply: "加入剪辑工程", import_asset: "导入素材" };
        return Object.hasOwn(labels, tool.slice(12)) ? labels[tool.slice(12)] : "处理剪辑场景";
    }
    if (tool.startsWith("hypit_")) return "执行视频制作";
    if (/asr|transcrib/.test(tool)) return "处理语音识别";
    if (/workflow/.test(tool)) return "更新制作流程";
    if (/asset|media/.test(tool)) return "处理素材";
    if (/generation|generate/.test(tool)) return "准备生成任务";
    if (/edit|timeline|clip/.test(tool)) return "编辑时间线";
    if (/get|read|search|list|context/.test(tool)) return "读取工程内容";
    if (/canvas|node|edge/.test(tool)) return "调整画布";
    return "执行操作";
}
