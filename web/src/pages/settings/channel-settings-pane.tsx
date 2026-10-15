import { Alert, App, Button, Popconfirm, Switch, Tooltip } from "antd";
import { Plus, RefreshCw, Trash2, Workflow } from "lucide-react";
import { useState, useSyncExternalStore, type ReactNode } from "react";

import { validateChannelHeaders } from "@/components/channel-headers-editor";
import { WorkspaceState } from "@/components/layout/workspace-state";
import { mergeFetchedChannelModelProfiles } from "@/lib/channel-model-catalog";
import { channelModelsForCapability } from "@/lib/model-channel-settings";
import { ensureModelProfilesWithUiDefaults } from "@/lib/model-protocols";
import { fetchChannelModels, type ChannelModelFetchResult } from "@/services/api/image";
import { channelHasGenerationCredential, filterModelsByCapability, modelOptionsFromChannels, useConfigStore, type AiConfig, type ModelChannel, type ModelCapability } from "@/stores/use-config-store";
import { ModelServiceEditor } from "./model-service-editor";
import { currentModelConnectionReceipt, useModelConnectionTests } from "@/stores/use-model-connection-tests";
import { ModelLogo } from "@/components/model-logo";
import { MODEL_SERVICE_PRESETS, servicePresetFor, serviceSupportsModelCatalog } from "@/lib/model-service-presets";
import { flushModelConfig, getModelConfigPersistenceState, subscribeModelConfigPersistence, type ModelConfigPersistenceState } from "@/services/model-config-repository";
import { useChannelModelCatalog } from "@/hooks/use-channel-model-catalog";
import { catalogRefreshLabel, channelCatalogConnectionIdentity, discoveredModelCapability } from "@/lib/channel-model-discovery";

type UserChannelConnection = "openai" | "gemini" | "claude";
type ChannelSettingsPaneProps = {
    onOpenModels?: () => void;
    capability?: ModelCapability;
    onOpenRunningHub?: () => void;
};

export function ChannelSettingsPane({ capability = "text", onOpenRunningHub }: ChannelSettingsPaneProps) {
    const { message } = App.useApp();
    const config = useConfigStore((state) => state.config);
    const replaceConfig = useConfigStore((state) => state.replaceConfig);
    const persistence = useSyncExternalStore(subscribeModelConfigPersistence, getModelConfigPersistenceState, getModelConfigPersistenceState);
    const [loadingChannelIds, setLoadingChannelIds] = useState<string[]>([]);
    const [serviceEditor, setServiceEditor] = useState<ModelChannel | null | undefined>(undefined);
    const userChannels = config.channels.filter((channel) => channel.scope !== "system");
    const visibleChannels = userChannels.filter((channel) => channelModelsForCapability(channel, capability).length || (!channel.models.length && capability === "text"));
    const categoryLabel = { text: "文字", image: "图片", video: "视频", audio: "配音" }[capability];
    const runningHubReady = Boolean(config.runningHub.enabled && config.runningHub.baseUrl.trim() && config.runningHub.apiKey.trim() && config.runningHub.workflowId.trim());

    const updateChannels = (channels: ModelChannel[], baseConfig = config) => {
        replaceConfig(withChannels(baseConfig, channels));
    };

    const updateChannel = (id: string, patch: Partial<ModelChannel>) => {
        updateChannels(
            config.channels.map((channel) => {
                if (channel.id !== id) return channel;
                const models = patch.models ? uniqueModels(patch.models) : channel.models;
                const modelProfiles = patch.modelProfiles !== undefined
                    ? patch.modelProfiles
                    : patch.models && channel.scope !== "system"
                        ? ensureModelProfilesWithUiDefaults(models, channel.modelProfiles, [], channel.apiFormat)
                        : patch.models
                            ? channel.modelProfiles?.filter((item) => models.includes(item.model))
                            : channel.modelProfiles;
                return {
                    ...channel,
                    ...patch,
                    models,
                    modelProfiles,
                };
            }),
        );
    };

    const addChannel = () => {
        setServiceEditor(null);
    };

    const saveService = async (channel: ModelChannel) => {
        const latest = useConfigStore.getState().config;
        const channels = latest.channels.some((item) => item.id === channel.id)
            ? latest.channels.map((item) => item.id === channel.id ? channel : item)
            : [...latest.channels, channel];
        updateChannels(channels, latest);
        await flushModelConfig();
        const saved = getModelConfigPersistenceState();
        if (saved.status === "error" || saved.dirty) throw new Error(saved.error || "模型服务尚未保存，请重试");
        message.success("模型服务已保存，可在创作页选择模型");
    };



    const deleteChannel = (id: string) => {
        const channel = config.channels.find((item) => item.id === id);
        if (channel?.scope === "system") {
            message.warning("系统渠道由管理员维护");
            return;
        }
        updateChannels(config.channels.filter((item) => item.id !== id));
    };

    const setChannelLoading = (id: string, loading: boolean) => {
        setLoadingChannelIds((items) => (loading ? Array.from(new Set([...items, id])) : items.filter((item) => item !== id)));
    };

    const refreshChannelModels = async (channel: ModelChannel) => {
        if (!serviceSupportsModelCatalog(channel, capability)) return;
        const connectionError = channelConnectionError(channel);
        if (connectionError) {
            message.error(`${channel.name || "当前渠道"}：${connectionError}`);
            return;
        }
        setChannelLoading(channel.id, true);
        try {
            const result = await fetchChannelModels(channel, true);
            if (!result.models.length) {
                message.warning(`${channel.name || "当前渠道"}未返回模型，已保留现有手工模型`);
                return;
            }
            const latestConfig = useConfigStore.getState().config;
            const latestChannel = latestConfig.channels.find((item) => item.id === channel.id);
            if (!latestChannel) return;
            if (channelConnectionSignature(latestChannel) !== channelConnectionSignature(channel)) {
                message.warning(`${latestChannel.name || "当前渠道"}的连接配置已改变，已忽略旧的拉取结果`);
                return;
            }
            updateChannels(
                latestConfig.channels.map((item) => (item.id === channel.id ? applyFetchedChannelModelCatalog(item, result) : item)),
                latestConfig,
            );
            if (result.cacheWarning) message.warning(result.cacheWarning);
            else message.success(`${latestChannel.name || "当前渠道"}模型目录已更新，新增型号可在管理中选择`);
        } catch (error) {
            message.error(channelModelFetchErrorMessage(error));
        } finally {
            setChannelLoading(channel.id, false);
        }
    };

    const refreshAllModels = async () => {
        const runnable = visibleChannels.filter((channel) => channel.enabled !== false && serviceSupportsModelCatalog(channel, capability) && !channelConnectionError(channel));
        const skipped = visibleChannels.filter((channel) => channel.enabled !== false && channelConnectionError(channel));
        if (!runnable.length) {
            const detail = skipped.map((channel) => `${channel.name || "未命名渠道"}：${channelConnectionError(channel)}`).join("；");
            message.error(detail || "没有可拉取的个人模型渠道，请先填写有效 Base URL 和 API Key");
            return;
        }
        setChannelLoading("all", true);
        try {
            const results = await Promise.all(
                runnable.map(async (channel) => {
                    try {
                        const result = await fetchChannelModels(channel, true);
                        return { channel, result, error: "" };
                    } catch (error) {
                        return { channel, result: { models: [], catalog: [] }, error: error instanceof Error ? error.message : "读取失败" };
                    }
                }),
            );
            const latestConfig = useConfigStore.getState().config;
            const successful = results.filter((item) => {
                const latestChannel = latestConfig.channels.find((channel) => channel.id === item.channel.id);
                return Boolean(item.result.models.length && latestChannel && channelConnectionSignature(latestChannel) === channelConnectionSignature(item.channel));
            });
            const stale = results.filter((item) => {
                const latestChannel = latestConfig.channels.find((channel) => channel.id === item.channel.id);
                return Boolean(item.result.models.length && (!latestChannel || channelConnectionSignature(latestChannel) !== channelConnectionSignature(item.channel)));
            });
            const failed = results.filter((item) => !item.result.models.length);
            if (successful.length) {
                const resultMap = new Map(successful.map((item) => [item.channel.id, item.result] as const));
                updateChannels(
                    latestConfig.channels.map((channel) => {
                        const fetched = resultMap.get(channel.id);
                        return fetched ? applyFetchedChannelModelCatalog(channel, fetched) : channel;
                    }),
                    latestConfig,
                );
                message.success(`已更新 ${successful.length} 个渠道的模型`);
            }
            const warnings = [
                ...successful.filter(item => item.result.cacheWarning).map(item => `${item.channel.name}：${item.result.cacheWarning}`),
                ...failed.map((item) => `${item.channel.name || "未命名渠道"}：${item.error || "未返回模型"}`),
                ...stale.map((item) => `${item.channel.name || "未命名渠道"}：连接配置已改变，已忽略旧结果`),
                ...skipped.map((channel) => `${channel.name || "未命名渠道"}：${channelConnectionError(channel)}`),
            ];
            if (warnings.length) message.warning(`${warnings.join("；")}。未更新的渠道已保留原有模型列表`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "批量读取模型失败，原有模型列表未改动");
        } finally {
            setChannelLoading("all", false);
        }
    };

    return (
        <section className="model-channel-section" aria-label={`${categoryLabel}渠道`}>
            <header className="model-channel-heading">
                <div><h2>{categoryLabel}渠道</h2><span>{visibleChannels.length} 个渠道</span></div>
                <div className="model-channel-heading-actions">
                    {visibleChannels.some((channel) => channel.enabled !== false && serviceSupportsModelCatalog(channel, capability)) && <Tooltip title="更新当前类型渠道的模型目录"><Button size="small" aria-label="更新模型目录" icon={<RefreshCw size={14} />} loading={loadingChannelIds.includes("all")} disabled={loadingChannelIds.some((id) => id !== "all")} onClick={() => void refreshAllModels()} /></Tooltip>}
                    <Button icon={<Plus size={15} />} onClick={addChannel}>添加渠道</Button>
                </div>
            </header>
            {config.modelSelectionRequired?.includes(`${capability}Model`) && <Alert className="mb-3" type="info" showIcon title="原内置渠道已移除" description="请配置渠道并重新选择默认模型。" />}
            {persistence.status === "error" && <Alert className="mb-3" type="error" showIcon title="配置尚未保存" description={persistence.error} action={<Button size="small" onClick={() => void flushModelConfig()}>重试保存</Button>} />}
            {visibleChannels.length ? <>
                <div className="model-channel-table-head" aria-hidden="true"><span>渠道</span><span>模型数量</span><span>启用</span><span>操作</span></div>
                <div className="model-channel-list">
                    {visibleChannels.map((channel) => {
                        const models = channelModelsForCapability(channel, capability);
                        const shared = channel.models.length > models.length;
                        return <section key={channel.id} className={`model-channel-row ${channel.enabled === false ? "is-disabled" : ""}`} aria-labelledby={`channel-${capability}-${channel.id}-title`}>
                            <div className="model-channel-info">
                                <span className="model-channel-logo"><ModelLogo icon={MODEL_SERVICE_PRESETS.find((preset) => preset.id === servicePresetFor(channel))?.icon} size={20} color /></span>
                                <div><h3 id={`channel-${capability}-${channel.id}-title`}>{channel.name || "未命名渠道"}</h3><p>{channelProtocolLabel(channel)} · {channelHostLabel(channel.baseUrl)}{shared ? " · 共享连接" : ""}</p>{serviceSupportsModelCatalog(channel, capability) && <ChannelCatalogStatus channel={channel} />}</div>
                            </div>
                            <div className="model-channel-model-count"><span>{models.length} 个模型</span>{channel.enabled === false ? <small>已停用</small> : <ChannelStatus channel={channel} persistence={persistence} />}</div>
                            <Tooltip title={shared ? "共享连接，启停会影响该渠道的所有模型类型" : undefined}>
                                <Switch size="small" aria-label={`启用${channel.name || "未命名渠道"}`} checked={channel.enabled !== false} onChange={(enabled) => updateChannel(channel.id, { enabled })} />
                            </Tooltip>
                            <div className="model-channel-row-actions">
                                {serviceSupportsModelCatalog(channel, capability) && <Button size="small" type="text" aria-label={`刷新${channel.name || "未命名渠道"}模型`} icon={<RefreshCw size={14} />} loading={loadingChannelIds.includes(channel.id)} disabled={loadingChannelIds.includes("all")} onClick={() => void refreshChannelModels(channel)}>刷新</Button>}
                                <Button size="small" type="text" aria-label={`管理${channel.name || "未命名渠道"}`} onClick={() => setServiceEditor(channel)}>管理</Button>
                                {<Popconfirm title="删除这个渠道？" description={shared ? "这个共享连接的所有类型模型都会移除。" : "该渠道关联的模型选择会同时移除。"} okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => deleteChannel(channel.id)}><Button size="small" type="text" danger aria-label={`删除${channel.name || "未命名渠道"}`} icon={<Trash2 size={14} />} /></Popconfirm>}
                            </div>

                        </section>;
                    })}
                </div>
            </> : <WorkspaceState icon="settings" compact title={`还没有${categoryLabel}渠道`} description="添加服务地址与密钥，再选择或手动添加模型。" action={<Button icon={<Plus size={15} />} onClick={addChannel}>添加渠道</Button>} />}
            {onOpenRunningHub && <WorkflowChannelEntry icon={<Workflow className="size-4" />} title="RunningHub" description="云端工作流与 App" status={runningHubReady ? `${config.runningHub.workflows.length} 个工作流已配置` : "待配置"} ready={runningHubReady} onOpen={onOpenRunningHub} />}
            {serviceEditor !== undefined && <ModelServiceEditor capability={capability} initial={serviceEditor || undefined} onClose={() => setServiceEditor(undefined)} onSave={saveService} />}
        </section>
    );
}

export function applyFetchedChannelModelCatalog(channel: ModelChannel, result: ChannelModelFetchResult): ModelChannel {
    const profiles = mergeFetchedChannelModelProfiles(channel, result.catalog.filter(item => discoveredModelCapability(channel, item) || channel.models.includes(item.id)));
    const existing = new Map((channel.modelProfiles || []).map((profile) => [profile.model, profile]));
    // Refresh updates the catalog without silently enabling new models or removing manual ones.
    return { ...channel, models: channel.models, modelProfiles: profiles.map((profile) => existing.get(profile.model) || profile).concat((channel.modelProfiles || []).filter((profile) => !profiles.some((item) => item.model === profile.model))) };
}

function ChannelCatalogStatus({ channel }: { channel: ModelChannel }) {
    const snapshot = useChannelModelCatalog(channel);
    return <p className="text-xs text-foreground/45">{catalogRefreshLabel(snapshot)}</p>;
}

function WorkflowChannelEntry({ icon, title, description, status, ready, onOpen }: { icon: ReactNode; title: string; description: string; status: string; ready: boolean; onOpen?: () => void }) {
    return (
        <div className="settings-channel flex min-w-0 items-center justify-between gap-3 p-3">
            <div className="flex min-w-0 items-start gap-2.5">
                <span className="mt-0.5 shrink-0 text-[var(--workspace-accent)]" aria-hidden="true">
                    {icon}
                </span>
                <div className="min-w-0">
                    <h4 className="text-sm font-semibold">{title}</h4>
                    <p className="mt-0.5 truncate text-xs text-foreground/55">{description}</p>
                    <span className={`settings-channel-status mt-1.5 ${ready ? "is-ready" : "is-warning"}`}>
                        <i aria-hidden="true" />
                        {status}
                    </span>
                </div>
            </div>
            <Button size="small" onClick={onOpen} disabled={!onOpen}>
                配置
            </Button>
        </div>
    );
}

export function channelValidationError(channel: ModelChannel, _connection?: unknown) {
    return channelConnectionError(channel) || validateChannelHeaders(channel.headers) || (!channel.models.length ? "请添加至少一个模型" : "");
}

export function isChannelReady(channel: ModelChannel) {
    return !channelValidationError(channel);
}

export function focusInvalidChannelField(channel: ModelChannel) {
    const baseUrlError = channelConnectionError({ ...channel, apiKey: "valid", secretKey: "valid" });
    const field = baseUrlError ? "base-url" : !channelHasGenerationCredential(channel) ? "api-key" : requiresSecretKey(channel) && !channel.secretKey?.trim() ? "secret-key" : "models";
    requestAnimationFrame(() => {
        const element = document.getElementById(`channel-${channel.id}-${field}`);
        element?.scrollIntoView({ behavior: "smooth", block: "center" });
        element?.focus({ preventScroll: true });
    });
}

function ChannelStatus({ channel, persistence }: { channel: ModelChannel; persistence: ModelConfigPersistenceState }) {
    const receipts = useModelConnectionTests((state) => state.receipts);
    const tested = channel.models.map((model) => currentModelConnectionReceipt(receipts, channel, model));
    const passed = tested.filter((result) => result?.success).length;
    const failed = tested.filter((result) => result && !result.success).length;
    const error = channelValidationError(channel);
    const label = modelConfigChannelStatusLabel(channel, persistence);
    const testLabel = failed ? `${failed} 个模型测试失败` : passed ? `${passed}/${channel.models.length} 个模型测试通过` : label;
    return (
        <span className={`settings-channel-status ${error || failed ? "is-warning" : "is-ready"}`}>
            <i aria-hidden="true" />
            {error || (persistence.status === "saving" || persistence.status === "error" ? label : testLabel)}
        </span>
    );
}

export function modelConfigChannelStatusLabel(channel: ModelChannel, persistence: ModelConfigPersistenceState, _connection?: unknown) {
    if (!channelHasGenerationCredential(channel)) return "待配置";
    if (persistence.status === "saving") return "保存中";
    if (persistence.status === "error") return "保存失败";
    if (persistence.status === "saved") return "已保存 · 尚未测试";
    return "尚未测试";
}

export function modelConfigChannelPresentation(channel: ModelChannel) {
    return { builtin: false, deletable: true, adapterLabel: "" };
}

function withChannels(config: AiConfig, channels: ModelChannel[]): AiConfig {
	const selected = (field: string, value: string, options: string[]) => config.modelSelectionRequired?.includes(field) ? "" : normalizeDefaultModel(value, options);
    const models = modelOptionsFromChannels(channels);
    const imageModels = filterModelsByCapability(models, "image", channels);
    const videoModels = filterModelsByCapability(models, "video", channels);
    const textModels = filterModelsByCapability(models, "text", channels);
    const audioModels = filterModelsByCapability(models, "audio", channels);
    return {
        ...config,
        channels,
        models,
        baseUrl: channels[0]?.baseUrl || config.baseUrl,
        apiKey: channels[0]?.apiKey || config.apiKey,
        apiFormat: channels[0]?.apiFormat || config.apiFormat,
        imageModels,
        videoModels,
        textModels,
        audioModels,
        imageModel: selected("imageModel", config.imageModel, imageModels),
        videoModel: selected("videoModel", config.videoModel, videoModels),
        textModel: selected("textModel", config.textModel, textModels),
        audioModel: selected("audioModel", config.audioModel, audioModels),
    };
}

function normalizeDefaultModel(value: string, options: string[]) {
    return options.includes(value) ? value : options[0] || "";
}

function uniqueModels(models: string[]) {
    return Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)));
}

function channelModelFetchErrorMessage(error: unknown) {
    const detail = error instanceof Error ? error.message : "读取模型失败";
    if (detail.includes("不允许访问本机") || detail.includes("不允许访问保留地址")) return `${detail}；可信私网服务需由部署管理员配置 CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS`;
    return `${detail}；也可以直接在模型列表中手动输入模型名`;
}

function channelConnectionMode(channel: ModelChannel): UserChannelConnection {
    return channel.apiFormat;
}

function channelConnectionError(channel: ModelChannel, _connection?: unknown) {
    const baseUrl = channel.baseUrl.trim();
    if (!baseUrl) return "请填写 Base URL";
    try {
        const parsed = new URL(baseUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "Base URL 只支持 HTTP 或 HTTPS";
    } catch {
        return "Base URL 格式不正确";
    }
    if (!channelHasGenerationCredential(channel)) return "请填写 API Key / Access Key";
    if (requiresSecretKey(channel) && !channel.secretKey?.trim()) return "当前协议需要填写 Secret Key";
    return "";
}

function channelConnectionSignature(channel: ModelChannel) {
    return channelCatalogConnectionIdentity(channel);
}

function channelProtocolLabel(channel: ModelChannel) {
    const preset = servicePresetFor(channel);
    if (preset === "doubao-tts") return "豆包原生语音";
    if (preset === "xfyun-tts") return "讯飞在线语音合成";
    if (preset === "comfyui") return "ComfyUI 工作流";
    if (channel.apiFormat === "claude") return "Anthropic 原生";
    return channelConnectionMode(channel) === "gemini" ? "Gemini 原生" : "OpenAI 兼容";
}

function channelHostLabel(value: string) {
    try { return new URL(value).host; } catch { return "未配置服务地址"; }
}

function requiresSecretKey(channel: ModelChannel) {
    return channel.modelProfiles?.some((item) => item.protocol?.startsWith("volcengine-jimeng-")) === true;
}
