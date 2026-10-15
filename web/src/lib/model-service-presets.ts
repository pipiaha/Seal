import type { ModelChannel, ModelCapability, ApiCallFormat } from "@/stores/use-config-store";
import { buildApiUrl } from "@/stores/use-config-store";
import { defaultModelCapabilityConfig } from "@/lib/model-capabilities";
import { inferProtocolCapabilityFromModel, type ModelProtocolDefinition } from "@/lib/model-protocols";
import { catalogEndpointCapability, type ChannelModelCatalogItem } from "@/lib/channel-model-catalog";

type ServicePreset = { id: string; name: string; subtitle: string; icon: string; baseUrl: string; apiFormat: ApiCallFormat; protocols: Partial<Record<ModelCapability, string>>; urls?: Partial<Record<ModelCapability, string>>; connections?: { label: string; value: string }[]; manualCatalog?: ModelCapability[]; audioModel?: string };
export const MODEL_SERVICE_PRESETS: ServicePreset[] = [
    { id: "compatible", name: "自定义服务", subtitle: "自有 API 或中转服务", icon: "OpenAI", baseUrl: "", apiFormat: "openai", protocols: { text: "chat-completion", image: "openai-image", audio: "openai-audio" } },
    { id: "openai", name: "OpenAI", subtitle: "GPT · GPT Image · 配音", icon: "OpenAI", baseUrl: "https://api.openai.com/v1", apiFormat: "openai", protocols: { text: "openai-response", image: "openai-image", audio: "openai-audio" } },
    { id: "anthropic", name: "Anthropic", subtitle: "Claude", icon: "Claude", baseUrl: "https://api.anthropic.com", apiFormat: "claude", protocols: { text: "claude-api" } },
    { id: "gemini", name: "Google", subtitle: "Gemini · 生图 · Veo", icon: "Gemini", baseUrl: "https://generativelanguage.googleapis.com", apiFormat: "gemini", protocols: { text: "gemini-generate-content", image: "gemini-image", video: "gemini-veo" } },
    { id: "deepseek", name: "DeepSeek", subtitle: "DeepSeek", icon: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", apiFormat: "openai", protocols: { text: "chat-completion" } },
    { id: "bailian", name: "阿里百炼", subtitle: "Qwen · Qwen Image · Wan", icon: "Qwen", baseUrl: "https://dashscope.aliyuncs.com", apiFormat: "openai", protocols: { text: "chat-completion", image: "dashscope-qwen-image", video: "dashscope-wan-video" }, urls: { text: "https://dashscope.aliyuncs.com/compatible-mode/v1" }, manualCatalog: ["image", "video"] },
    { id: "moonshot", name: "月之暗面", subtitle: "Kimi", icon: "Moonshot", baseUrl: "https://api.moonshot.cn/v1", apiFormat: "openai", protocols: { text: "chat-completion" } },
    { id: "zhipu", name: "智谱", subtitle: "GLM", icon: "Zhipu", baseUrl: "https://open.bigmodel.cn/api/paas/v4", apiFormat: "openai", protocols: { text: "chat-completion" } },
    { id: "minimax", name: "MiniMax", subtitle: "MiniMax · 海螺视频", icon: "Minimax", baseUrl: "https://api.minimax.io", apiFormat: "openai", protocols: { text: "chat-completion", video: "minimax-video" }, urls: { text: "https://api.minimax.io/v1" }, manualCatalog: ["video"] },
    { id: "ark", name: "火山方舟", subtitle: "豆包 · Seedream · Seedance", icon: "Volcengine", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", apiFormat: "openai", protocols: { text: "chat-completion", image: "volcengine-ark-image", video: "volcengine-ark-video" } },
    { id: "kling", name: "可灵", subtitle: "Kling 视频", icon: "Kling", baseUrl: "https://api.klingai.com", apiFormat: "openai", protocols: { video: "kling-video" }, manualCatalog: ["video"] },
    { id: "vidu", name: "Vidu", subtitle: "Vidu 视频", icon: "Vidu", baseUrl: "https://api.vidu.com", apiFormat: "openai", protocols: { video: "vidu-video" }, manualCatalog: ["video"] },
    { id: "agnes", name: "Agnes AI", subtitle: "Agnes Image · Agnes Video", icon: "AgnesAI", baseUrl: "https://api.agnes-ai.cn/v1", apiFormat: "openai", protocols: { image: "agnes-image", video: "agnes-video" }, connections: [{ label: "国内站 · agnes-ai.cn", value: "https://api.agnes-ai.cn/v1" }, { label: "国际站 · agnes-ai.com", value: "https://apihub.agnes-ai.com/v1" }] },
    { id: "comfyui", name: "本地 ComfyUI", subtitle: "连接本机工作流", icon: "ComfyUI", baseUrl: "http://127.0.0.1:8188", apiFormat: "openai", protocols: { image: "comfyui-image", video: "comfyui-video" }, manualCatalog: ["image", "video"] },
    { id: "doubao-tts", name: "豆包语音合成", subtitle: "火山引擎语音 · TTS 2.0", icon: "Volcengine", baseUrl: "https://openspeech.bytedance.com", apiFormat: "openai", protocols: { audio: "doubao-tts" }, manualCatalog: ["audio"], audioModel: "seed-tts-2.0" },
    { id: "xfyun-tts", name: "科大讯飞", subtitle: "在线语音合成（流式版）", icon: "Spark", baseUrl: "https://tts-api.xfyun.cn", apiFormat: "openai", protocols: { audio: "xfyun-tts" }, manualCatalog: ["audio"], audioModel: "xfyun-tts" },
];
export function modelServicePresetsFor(capability: ModelCapability) {
    return MODEL_SERVICE_PRESETS.filter((preset) => preset.id === "compatible" || preset.protocols[capability]);
}
export function modelServicePresetConnection(preset: ServicePreset, capability: ModelCapability) {
    return { baseUrl: preset.urls?.[capability] || preset.baseUrl, apiFormat: preset.apiFormat };
}
export function serviceSupportsModelCatalog(channel: ModelChannel, capability: ModelCapability) {
    if (servicePresetFor(channel) === "comfyui") return false;
    return Boolean(channel.modelsUrl?.trim()) || !MODEL_SERVICE_PRESETS.find((preset) => preset.id === servicePresetFor(channel))?.manualCatalog?.includes(capability);
}
export type ModelServicePresetId = typeof MODEL_SERVICE_PRESETS[number]["id"];
export const CAPABILITY_LABELS: Record<ModelCapability, string> = { text: "文本", image: "图片", video: "视频", audio: "音频" };

export function servicePresetFor(channel: ModelChannel): ModelServicePresetId {
    try {
        const host = new URL(channel.baseUrl).hostname;
        if (channel.modelProfiles?.some(profile => profile.protocol?.startsWith("comfyui-"))) return "comfyui";
        if (/^ark\.[a-z0-9-]+\.volces\.com$/.test(host)) return "ark";
        const preset = MODEL_SERVICE_PRESETS.find((item) => [item.baseUrl, ...(item.connections?.map(connection => connection.value) || [])].some(url => url && new URL(url).hostname === host));
        if (preset) return preset.id;
    } catch { /* An unfinished connection has no provider identity yet. */ }
    return "compatible";
}

// Endpoint metadata is a hint, only resolve to protocols the host actually offers.
export function serviceModelProfile(channel: ModelChannel, item: ChannelModelCatalogItem, protocols: ModelProtocolDefinition[], explicitCapability?: ModelCapability): NonNullable<ModelChannel["modelProfiles"]>[number] {
    const existing = channel.modelProfiles?.find((profile) => profile.model === item.id);
    if (existing?.protocol && !explicitCapability) return existing;
    const fullvideoFull = ["sd-native-full-2.0", "sd-native-full-2.5", "原生不卡人脸-全参2.0", "原生不卡人脸-全参2.5"].includes(item.id);
    const capability = explicitCapability || existing?.capability || item.modelType || catalogEndpointCapability(item) || (fullvideoFull ? "video" : inferProtocolCapabilityFromModel(item.id));
    const preset = capability === "video" ? servicePresetFor(channel) : channel.apiFormat === "gemini" ? "gemini" : channel.apiFormat === "claude" && capability === "text" ? "anthropic" : servicePresetFor(channel);
    const endpoints: Record<string, string> = { "messages": "claude-api", "responses": "openai-response", "openai-responses": "openai-response", "chat.completions": "chat-completion", "chat-completions": "chat-completion", "images.generations": "openai-image", "image-generation": "openai-image", "audio.speech": "openai-audio", "openai-video": "newapi", "full-video": "full-video" };
    const endpoint = item.supportedEndpointTypes?.map((value) => endpoints[value.toLowerCase()]).find((id) => protocols.some((p) => p.value === id && p.capability === capability));
    let proposed = endpoint || MODEL_SERVICE_PRESETS.find((item) => item.id === preset)?.protocols[capability];
    // Model names identify a family, not a provider's wire protocol. Ask the
    // user to select its contract unless the catalog explicitly declares it.
    if (fullvideoFull && capability === "video") proposed = item.supportedEndpointTypes?.includes("full-video") ? "full-video" : undefined;
    const protocol = protocols.find((p) => p.value === proposed && p.capability === capability && p.enabled !== false)?.value;
    const capabilityConfig = existing?.capability === capability && existing.capabilityConfig ? existing.capabilityConfig : (capability === "image" || capability === "video") && protocol ? defaultModelCapabilityConfig(protocol, item.id) : undefined;
    return { ...existing, model: item.id, displayName: existing?.displayName || item.displayName, capability, protocol, capabilityConfig };
}

export function serviceConnectionError(channel: ModelChannel): string {
    if (channel.referenceAssetOrigin?.trim()) {
        try {
            const origin = new URL(channel.referenceAssetOrigin.trim());
            if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/" || origin.port) return "素材服务地址请填写 HTTPS 域名，不包含路径、账号或查询参数";
        } catch { return "请填写完整的 HTTPS 素材服务地址"; }
    }
    try {
        const url = new URL(channel.baseUrl.trim());
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return "请填写不含账号、查询参数或片段的 HTTP(S) 服务地址";
        if (/\/(chat\/completions|responses|images\/generations|models)\/?$/i.test(url.pathname)) return "请填写服务的基础地址，不要包含模型或生成接口路径";
        if (channel.modelsUrl?.trim()) {
            const catalog = new URL(channel.modelsUrl.trim(), `${channel.baseUrl.replace(/\/+$/, "")}/`);
            if (catalog.origin !== url.origin || catalog.username || catalog.password || catalog.hash) return "模型目录接口必须与服务地址同站点，且不含账号或片段";
        }
    } catch { return "请填写完整的服务地址，例如 https://api.example.com/v1"; }
    if (channel.authType !== "none" && !channel.apiKey.trim() && !channel.hasApiKey) return "请填写 API Key";
    if (channel.authType === "header" && !channel.authHeader?.trim()) return "请填写鉴权请求头名称";
    if (channel.modelProfiles?.some((profile) => profile.protocol === "xfyun-tts") && !channel.secretKey?.trim() && !channel.hasSecretKey) return "请填写讯飞 API Secret";
    for (const profile of channel.modelProfiles || []) {
        if (!channel.models.includes(profile.model)) continue;
        if (profile.protocol === "doubao-tts" || profile.protocol === "xfyun-tts") {
            if (!String(profile.defaultOptions?.voice || "").trim()) return "请填写该语音模型的音色／发音人 ID";
            if (profile.protocol === "xfyun-tts" && !String(profile.defaultOptions?.appId || "").trim()) return "请填写讯飞 APPID";
        }
    }
    return "";
}

export function modelCatalogRequestURL(channel: ModelChannel) {
    if (!channel.baseUrl.trim()) return "";
    try {
        if (channel.modelsUrl?.trim()) return new URL(channel.modelsUrl.trim(), `${channel.baseUrl.replace(/\/+$/, "")}/`).href;
        if (channel.apiFormat === "gemini") return `${channel.baseUrl.replace(/\/+$/, "").replace(/\/v1beta$/, "")}/v1beta/models`;
        if (channel.apiFormat === "claude") return `${channel.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "")}/v1/models`;
        return buildApiUrl(channel.baseUrl, "/models");
    } catch { return ""; }
}
