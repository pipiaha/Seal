import type { ModelProtocolDefinition } from "./model-protocols";
import type { ModelChannel, WorkflowFieldMapping } from "@/stores/use-config-store";

export type ProviderOperation = { method: string; path: string; originPath?: boolean; contentType?: string; body?: unknown; query?: Record<string, unknown>; fields?: Record<string, string>; files?: Array<{ name: string; source: unknown }> };
export type CustomProvider = {
    auth: { type: "none" | "bearer" | "header"; header?: string; field?: string };
    requiresPublicMediaUrls?: boolean;
    create: ProviderOperation;
    poll?: ProviderOperation;
    cancel?: ProviderOperation;
    result?: ProviderOperation;
    response: { taskIdPaths?: string[]; statusPaths?: string[]; statusMap?: Record<string, "pending" | "processing" | "succeeded" | "failed" | "cancelled">; resultUrlPaths?: string[]; resultPaths?: string[]; inlineBase64Paths?: string[]; inlineMime?: string; errorPaths?: string[]; messagePaths?: string[]; resultKind?: string };
};
export type ComfyWorkflow = { graph: Record<string, unknown>; fields: WorkflowFieldMapping[]; outputNodeId: string; outputField: "images" | "gifs" | "videos" | "audio" };
export type GenerationModelProfile = NonNullable<ModelChannel["modelProfiles"]>[number];

export const CONFIGURED_PROTOCOLS: ModelProtocolDefinition[] = (["image", "video"] as const).flatMap(capability => [
    { value: `custom-${capability}`, label: "自定义 HTTP 接口", vendor: "自定义", capability, create: "按模型配置提交", poll: "按模型配置查询", contentType: "application/json / multipart/form-data", media: "字段映射", enabled: true },
    { value: `comfyui-${capability}`, label: "本地 ComfyUI 工作流", vendor: "ComfyUI", capability, create: "POST /prompt", poll: "GET /history/{task_id}", contentType: "application/json", media: "本地工作流", enabled: true },
]);

export function defaultCustomProvider(capability: "image" | "video"): CustomProvider {
    return {
        auth: { type: "bearer", field: "apiKey" },
        create: { method: "POST", path: capability === "video" ? "/videos" : "/images/generations", contentType: "application/json", fields: { model: "request.model", prompt: "request.prompt", ...(capability === "video" ? { seconds: "request.duration" } : {}) } },
        ...(capability === "video" ? { poll: { method: "GET", path: "/videos/{task_id}" } } : {}),
        response: { taskIdPaths: ["id", "task_id", "data.id"], statusPaths: ["status", "data.status"], resultUrlPaths: ["url", "data.url", "data.0.url"], resultKind: capability, errorPaths: ["error.message"], messagePaths: ["message"] },
    };
}

export function configuredProfileError(profile: GenerationModelProfile): string {
    if (profile.protocol?.startsWith("custom-")) {
        const provider = profile.customProvider;
        if (!provider) return "请配置自定义接口";
        for (const op of [provider.create, provider.poll, provider.cancel, provider.result]) {
            if (op && (!op.path.startsWith("/") || op.path.startsWith("//") || /[\r\n]/.test(op.path))) return "接口路径需以 / 开头，不能填写另一台服务的地址";
        }
        if (!provider.result && !provider.response.resultUrlPaths?.length && !provider.response.resultPaths?.length && !provider.response.inlineBase64Paths?.length) return "请填写结果提取路径";
    }
    if (profile.protocol?.startsWith("comfyui-")) {
        const flow = profile.comfyui;
        if (!flow || !Object.keys(flow.graph).length) return "请导入 ComfyUI API 工作流";
        if (!flow.graph[flow.outputNodeId]) return "请选择最终输出节点";
        if (!flow.fields.some(field => field.enabled !== false && field.source === "prompt")) return "请把正向提示词字段绑定到提示词输入";
    }
    return "";
}

export function parseComfyGraph(text: string): Record<string, unknown> {
    const raw: unknown = JSON.parse(text);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("工作流必须是 JSON 对象");
    const graph = raw as Record<string, unknown>;
    const entries = Object.entries(graph);
    if (!entries.length || entries.length > 500 || entries.some(([, node]) => !node || typeof node !== "object" || Array.isArray(node) || typeof (node as Record<string, unknown>).class_type !== "string" || !(node as Record<string, unknown>).inputs || Array.isArray((node as Record<string, unknown>).inputs))) throw new Error("请从 ComfyUI 导出 API 格式工作流，普通画布 JSON 不能提交");
    return graph;
}

function rejectEmbeddedSecrets(value: unknown): void {
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
        if (/^(api[_-]?key|secret[_-]?key|authorization|cookie|access[_-]?token|password)$/i.test(key) && item) throw new Error("配置内含凭证字段，请移到渠道鉴权设置后再导入或导出");
        rejectEmbeddedSecrets(item);
    }
}

export function exportModelRecipe(profile: GenerationModelProfile): string {
    const recipe = { schemaVersion: 1, kind: "seal-model-recipe", capability: profile.capability, protocol: profile.protocol, customProvider: profile.customProvider, comfyui: profile.comfyui, capabilityConfig: profile.capabilityConfig };
    rejectEmbeddedSecrets(recipe);
    return JSON.stringify(recipe, null, 2);
}

export function importModelRecipe(text: string, capability: GenerationModelProfile["capability"]): Partial<GenerationModelProfile> {
    const value = JSON.parse(text);
    rejectEmbeddedSecrets(value);
    if (value.schemaVersion !== 1 || value.kind !== "seal-model-recipe" || value.capability !== capability || !CONFIGURED_PROTOCOLS.some(item => item.value === value.protocol && item.capability === capability)) throw new Error("请选择相同模型类型的 Seal 接口配置文件");
    if (value.comfyui) parseComfyGraph(JSON.stringify(value.comfyui.graph));
    const patch = { protocol: value.protocol, customProvider: value.customProvider, comfyui: value.comfyui, capabilityConfig: value.capabilityConfig };
    const error = configuredProfileError({ model: "import", capability, ...patch });
    if (error) throw new Error(error);
    return patch;
}
