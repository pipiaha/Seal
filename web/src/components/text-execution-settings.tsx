import { InputNumber, Select } from "antd";
import type { TextCapabilityConfig } from "@/lib/model-capabilities";
import { assistantReasoningSettings, REASONING_FORMATS, REASONING_LABELS } from "@/lib/assistant-model-settings";

export function TextExecutionSettings({ value, model, protocol, baseUrl = "", disabled, onChange }: {
    value: TextCapabilityConfig; model: string; protocol: string; baseUrl?: string; disabled?: boolean;
    onChange: (patch: Partial<TextCapabilityConfig>) => void;
}) {
    const reasoning = assistantReasoningSettings(value, protocol, model, baseUrl);
    return <section className="space-y-3">
        <div><div className="text-sm font-medium">创作助手 · 输出与思考</div><p className="mt-1 text-xs text-foreground/50">下一轮生效。输出预算包含思考与正文；更高的思考强度可能增加耗时和用量。</p></div>
        <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs">单次输出预算（Token）<InputNumber className="w-full" aria-label="单次输出预算" precision={0} value={value.maxOutputTokens ?? 49152} min={1} max={1048576} disabled={disabled} onChange={next => onChange({ maxOutputTokens: next ?? 49152 })} /></label>
            <label className="space-y-1 text-xs">模型输出上限（可选）<InputNumber className="w-full" aria-label="模型输出上限" precision={0} placeholder="按服务商说明填写" value={value.outputTokenLimit} min={1} max={1048576} disabled={disabled} onChange={next => onChange({ outputTokenLimit: next ?? undefined })} /></label>
            <label className="space-y-1 text-xs">上下文窗口（Token）<InputNumber className="w-full" aria-label="上下文窗口" precision={0} value={value.contextWindow ?? 200000} min={1024} max={4000000} disabled={disabled} onChange={next => onChange({ contextWindow: next ?? 200000 })} /></label>
            <label className="space-y-1 text-xs">思考参数格式<Select className="w-full" aria-label="思考参数格式" disabled={disabled} value={value.reasoningFormat || "auto"} options={[...REASONING_FORMATS]} onChange={reasoningFormat => onChange({ reasoningFormat, reasoningEffort: undefined, reasoningLevels: undefined })} /></label>
            <label className="space-y-1 text-xs">默认思考强度<Select className="w-full" aria-label="默认思考强度" disabled={disabled || !reasoning.levels.length} value={reasoning.levels.length ? reasoning.effort : undefined} placeholder="未配置思考参数" options={reasoning.levels.map(value => ({ value, label: REASONING_LABELS[value] }))} onChange={reasoningEffort => onChange({ reasoningEffort })} /></label>
            <label className="space-y-1 text-xs">支持的思考档位<Select mode="multiple" className="w-full" aria-label="支持的思考档位" disabled={disabled || reasoning.format === "none"} value={reasoning.levels} options={Object.entries(REASONING_LABELS).map(([value, label]) => ({ value, label }))} onChange={(levels: NonNullable<TextCapabilityConfig["reasoningLevels"]>) => onChange({ reasoningLevels: levels.length ? levels : undefined, reasoningEffort: levels.includes(reasoning.effort) ? reasoning.effort : levels[0] })} /></label>
        </div>
        <p className="text-xs text-foreground/50">默认 48K = 49,152 Token。实际预算受填写的模型上限和剩余上下文限制。自动识别失败时，按服务商说明选择参数格式与档位；上游拒绝参数时会显示错误。</p>
    </section>;
}
