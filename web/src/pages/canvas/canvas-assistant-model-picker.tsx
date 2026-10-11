import { Select, Tooltip } from "antd";
import { assistantModelOptions, resolveAssistantModel } from "@/lib/assistant-model";
import { modelDisplayName, resolveModelChannel, useConfigStore } from "@/stores/use-config-store";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { assistantReasoningSettings, REASONING_LABELS } from "@/lib/assistant-model-settings";

export function CanvasAssistantModelPicker({ busy }: { busy: boolean }) {
    const config = useConfigStore((state) => state.config);
    const selected = resolveAssistantModel(config);
    const channel = resolveModelChannel(config, selected);
    const model = selected.split("::").at(-1) || "";
    const profile = channel.modelProfiles?.find(item => item.model === model);
    const text = modelCapabilityConfigFor(config, selected).text!;
    const reasoning = assistantReasoningSettings(text, profile?.protocol || channel.interfaceType || "chat-completion", model, channel.baseUrl);
    const options = assistantModelOptions(config).map((value) => ({
        value,
        label: modelDisplayName(config, value),
        title: `${modelDisplayName(config, value)} · ${resolveModelChannel(config, value).name}`,
    }));
    return (
        <div className="canvas-assistant-model-controls">
        <Select
            className="canvas-assistant-model"
            aria-label="助手模型"
            size="small"
            variant="borderless"
            value={selected || undefined}
            placeholder={options.length ? "选择助手模型" : "暂无可用模型"}
            options={options}
            disabled={busy || options.length === 0}
            placement="topLeft"
            popupMatchSelectWidth={false}
            onChange={(value) => {
                if (!busy && assistantModelOptions(useConfigStore.getState().config).includes(value)) {
                    useConfigStore.getState().updateConfig("assistantModel", value);
                }
            }}
        />
        <Tooltip title={reasoning.levels.length ? "思考强度 · 下一轮生效，较高档位可能增加耗时和用量" : "此模型未配置可调思考参数，可在模型配置 → 配置使用 → 能力与参数中设置"}>
            <Select className="canvas-assistant-reasoning" aria-label="助手思考强度" size="small" variant="borderless" placement="topLeft" popupMatchSelectWidth={false}
                value={reasoning.levels.length ? reasoning.effort : undefined} placeholder="思考未配置" disabled={busy || !reasoning.levels.length}
                options={reasoning.levels.map(value => ({ value, label: REASONING_LABELS[value] }))}
                onChange={reasoningEffort => {
                    if (busy || !reasoning.levels.includes(reasoningEffort)) return;
                    const state = useConfigStore.getState();
                    state.updateConfig("channels", state.config.channels.map(item => item.id !== channel.id ? item : {
                        ...item, modelProfiles: [...(item.modelProfiles || []).filter(entry => entry.model !== model), {
                            ...profile, model, capability: "text", protocol: profile?.protocol || channel.interfaceType || "chat-completion",
                            capabilityConfig: { ...modelCapabilityConfigFor(state.config, selected), text: { ...text, reasoningEffort } },
                        }],
                    }));
                }} />
        </Tooltip>
        </div>
    );
}
