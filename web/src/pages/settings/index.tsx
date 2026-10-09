import { App, Button } from "antd";
import { ArrowLeft, Film, Image, Mic, Speech, Type } from "lucide-react";
import { useLayoutEffect, type KeyboardEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { PageHeader } from "@/components/layout/workspace-page";
import { MODEL_CHANNEL_CATEGORIES, channelModelsForCapability, type ModelChannelCategory } from "@/lib/model-channel-settings";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { flushModelConfig, getModelConfigPersistenceState } from "@/services/model-config-repository";
import { ChannelSettingsPane, isChannelReady } from "./channel-settings-pane";
import { ModelChannelDefaults } from "./model-channel-defaults";
import { AsrSettingsPane } from "./asr-settings-pane";
import { VoiceSettingsPane } from "./voice-settings-pane";
import { AssistantToolsPane } from "./assistant-tools-pane";
import "./model-channel-settings.css";

export function isConfigSection(value: string | null): value is "channels" | "models" {
    return value === "channels" || value === "models";
}

export default function SettingsPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const requested = searchParams.get("capability");
    const category: ModelChannelCategory = MODEL_CHANNEL_CATEGORIES.find((item) => item.value === requested)?.value || "text";
    const customChannelsEnabled = useUserStore((state) => state.features.customChannelsEnabled);
    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const shouldPromptContinue = searchParams.get("continue") === "1";
    const icons = { text: Type, image: Image, video: Film, audio: Speech, asr: Mic };

    useLayoutEffect(() => {
        document.body.classList.add("app-user-overlays");
        return () => document.body.classList.remove("app-user-overlays");
    }, []);

    const selectCategory = (value: ModelChannelCategory) => {
        const next = new URLSearchParams(searchParams);
        next.set("capability", value);
        setSearchParams(next, { replace: true });
    };
    const navigateTabs = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
        let target: number;
        if (event.key === "ArrowRight") target = (index + 1) % MODEL_CHANNEL_CATEGORIES.length;
        else if (event.key === "ArrowLeft") target = (index + MODEL_CHANNEL_CATEGORIES.length - 1) % MODEL_CHANNEL_CATEGORIES.length;
        else if (event.key === "Home") target = 0;
        else if (event.key === "End") target = MODEL_CHANNEL_CATEGORIES.length - 1;
        else return;
        event.preventDefault();
        const next = MODEL_CHANNEL_CATEGORIES[target].value;
        selectCategory(next);
        document.getElementById(`model-channel-tab-${next}`)?.focus();
    };
    const finishConfig = async () => {
        if (!effectiveConfig.channels.some((channel) => channel.enabled !== false && isChannelReady(channel))) {
            message.warning("请先添加并启用至少一个已配置模型的渠道");
            return;
        }
        try {
            await flushModelConfig();
            const state = getModelConfigPersistenceState();
            if (state.status === "error" || state.dirty) throw new Error(state.error || "配置尚未保存，请重试");
            message.success("配置已保存，正在返回创作页面");
            navigate(-1);
        } catch (error) { message.error(error instanceof Error ? error.message : "保存失败，请重试"); }
    };

    return <main className="settings-page app-workspace-page app-user-workspace app-section-page flex h-full min-h-0 flex-col text-foreground">
        <div className="app-workspace-scroll app-section-page-content min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="model-settings-workspace">
                <PageHeader title="模型配置" description="按创作用途管理渠道与模型" actions={shouldPromptContinue ? <div className="flex gap-2"><Button icon={<ArrowLeft size={15} />} onClick={() => navigate(-1)}>返回创作</Button><Button type="primary" onClick={() => void finishConfig()}>保存并返回</Button></div> : undefined} />
                <div className="model-channel-tabs" role="tablist" aria-label="渠道类型">
                    {MODEL_CHANNEL_CATEGORIES.map((item, index) => {
                        const Icon = icons[item.value];
                        const count = item.value === "asr" ? null : config.channels.filter((channel) => channel.scope !== "system" && channelModelsForCapability(channel, item.value).length > 0).length;
                        return <button id={`model-channel-tab-${item.value}`} key={item.value} type="button" className="model-channel-tab" role="tab" aria-selected={category === item.value} aria-controls="model-channel-panel" tabIndex={category === item.value ? 0 : -1} onClick={() => selectCategory(item.value)} onKeyDown={(event) => navigateTabs(event, index)}><Icon aria-hidden="true" />{item.label}{count !== null && <span>{count}</span>}</button>;
                    })}
                </div>
                <section id="model-channel-panel" role="tabpanel" aria-labelledby={`model-channel-tab-${category}`}>
                    {category === "asr" ? <AsrSettingsPane /> : <>
                        <ModelChannelDefaults config={effectiveConfig} capability={category} onChange={(key, model) => updateConfig(key, model)} />
                        {category === "audio" && <VoiceSettingsPane />}
                        {customChannelsEnabled ? <ChannelSettingsPane key={category} capability={category} /> : <p className="mt-5 text-xs text-foreground/55">模型服务由系统管理，可在上方选择默认模型。</p>}
                        {category === "text" && <AssistantToolsPane />}
                    </>}
                </section>
            </div>
        </div>
    </main>;
}
