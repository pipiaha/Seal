import type { TextCapabilityConfig } from "./model-capabilities";

export const REASONING_LABELS = { off: "关闭思考", low: "低", medium: "中", high: "高", xhigh: "极高", max: "最大" } as const;
export const REASONING_FORMATS = [
    { value: "auto", label: "自动识别" }, { value: "none", label: "不发送思考参数" },
    { value: "openai", label: "OpenAI 标准" }, { value: "deepseek", label: "DeepSeek" },
    { value: "openrouter", label: "OpenRouter" }, { value: "zai", label: "智谱 thinking" },
    { value: "qwen", label: "Qwen enable_thinking" },
    { value: "anthropic-adaptive", label: "Claude 自适应思考" }, { value: "anthropic-budget", label: "Claude 思考预算" },
] as const;

export function assistantReasoningSettings(text: TextCapabilityConfig, protocol: string, model: string, baseUrl = "") {
    let format = text.reasoningFormat || "auto";
    if (format === "auto") {
        if (text.thinking === false) format = "none";
        else if (/deepseek/i.test(model) || /api\.deepseek\.com/i.test(baseUrl)) format = "deepseek";
        else if (protocol === "claude-api") format = /claude-(?:opus|sonnet)-(?:4[.-][6-9]|[5-9])/i.test(model) ? "anthropic-adaptive" : "anthropic-budget";
        else if (/openrouter\.ai/i.test(baseUrl)) format = "openrouter";
        else if (/^(?:gpt-[5-9]|o[134](?:-|$))/i.test(model)) format = "openai";
        else format = "none";
    }
    const defaults: NonNullable<TextCapabilityConfig["reasoningLevels"]> = format === "none" ? []
        : format === "deepseek" ? ["off", "low", "high", "max"]
        : format === "zai" || format === "qwen" ? ["off", "high"]
        : format === "openai" ? ["low", "medium", "high"] : ["off", "low", "medium", "high"];
    const levels = format === "none" ? [] : text.reasoningLevels?.length ? text.reasoningLevels : defaults;
    const fallback = format === "deepseek" || format === "zai" || format === "qwen" ? "high" : "medium";
    const effort = levels.includes(text.reasoningEffort!) ? text.reasoningEffort! : levels.includes(fallback) ? fallback : levels[0] || "off";
    return { format, levels, effort };
}
