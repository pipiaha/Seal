import type { CustomProvider, ProviderOperation } from "./configured-provider";

export const PROVIDER_SCRIPT_VARIABLES = [
    ["model", "模型 ID"], ["prompt", "提示词"], ["seconds", "视频时长（数字）"],
    ["aspectRatio", "画面比例"], ["resolution", "分辨率"], ["quality", "质量"],
    ["count", "生成数量"], ["images", "参考图片链接数组"], ["videos", "参考视频链接数组"],
    ["audios", "参考音频链接数组"], ["firstFrame", "首帧链接"], ["lastFrame", "尾帧链接"],
    ["generateAudio", "生成音频"], ["watermark", "水印"], ["size", "原始尺寸"],
    ["request", "完整输入与素材对象"], ["extra", "附加参数"], ["taskId", "查询阶段任务 ID"],
] as const;

export function defaultProviderScript(capability: "image" | "video"): string {
    return capability === "image" ? `{
  create: {
    method: "POST",
    path: "/images/generations",
    contentType: "application/json",
    body: { model, prompt, n: count, size }
  },
  response: {
    result: "data.*.url",
    base64: "data.*.b64_json",
    inlineMime: "image/png",
    error: data => data.error?.message || null,
    message: data => data.error?.message || data.message || ""
  }
}` : `{
  create: {
    method: "POST",
    path: "/videos",
    contentType: "application/json",
    body: { model, prompt, seconds, aspect_ratio: aspectRatio }
  },
  poll: { method: "GET", path: "/videos/{task_id}" },
  response: {
    taskId: data => data.id ?? data.task_id ?? data.data?.id,
    status: data => data.status ?? data.data?.status,
    result: data => data.url ?? data.data?.url ?? data.data?.video_url ?? [],
    error: data => data.error?.message || null,
    message: data => data.error?.message || data.message || ""
  }
}`;
}

export function providerScriptTemplate(capability: "image" | "video", kind: "default" | "array" | "multipart"): string {
    if (kind === "default") return defaultProviderScript(capability);
    if (kind === "array") return `{
  create: {
    method: "POST",
    path: "/generate",
    contentType: "application/json",
    body: {
      model,
      params: [
        { type: "text", value: prompt },
        ...images.map(url => ({ type: "image", value: url })),
        ...videos.map(url => ({ type: "video", value: url }))
      ],
      options: { seconds, aspect_ratio: aspectRatio }
    }
  },
  poll: { method: "GET", path: "/tasks/{task_id}" },
  response: {
    taskId: "data.task_id",
    status: "data.status",
    statusMap: { "0": "pending", "1": "processing", "2": "succeeded", "3": "failed" },
    result: "data.output.url",
    message: "message"
  }
}`;
    return `{
  create: {
    method: "POST",
    path: "/generate",
    contentType: "multipart/form-data",
    body: { model, prompt, seconds: String(seconds) },
    // Seal uploads the authorized media; source is a media object, not a path.
    files: request.images.map(image => ({ name: "image", source: image }))
  },
  response: { result: "data.url", message: "message" }
}`;
}

// Display saved declarative recipes as JS without discarding their mappings.
// This only produces source text; actual JS validation runs in the backend VM.
export function providerToScript(provider: CustomProvider): string {
    if (typeof provider.script === "string") return provider.script;
    const operation = (op: ProviderOperation) => {
        const { body, fields, files, query, ...rest } = op;
        const mapped: Record<string, unknown> = {};
        for (const [path, source] of Object.entries(fields || {})) {
            const parts = path.split("."); let current = mapped;
            for (const part of parts.slice(0, -1)) current = (current[part] ||= {}) as Record<string, unknown>;
            current[parts.at(-1)!] = { $ref: source };
        }
        const pieces = Object.entries(rest).map(([key, value]) => `${JSON.stringify(key)}: ${jsValue(value)}`);
        if (body !== undefined || Object.keys(mapped).length) pieces.push(`body: ${body !== undefined && Object.keys(mapped).length ? `Object.assign({}, ${jsValue(body)}, ${jsValue(mapped)})` : jsValue(body ?? mapped)}`);
        if (files) pieces.push(`files: ${jsValue(files)}`);
        if (query) pieces.push(`query: ${jsValue(query)}`);
        return `{\n    ${pieces.join(",\n    ")}\n  }`;
    };
    return `{\n${[
        ...(provider.requiresPublicMediaUrls ? ["  requiresPublicMediaUrls: true"] : []),
        ...(["create", "poll", "cancel", "result"] as const).flatMap(key => provider[key] ? [`  ${key}: ${operation(provider[key]!)}`] : []),
        `  response: ${jsValue(provider.response)}`,
    ].join(",\n")}\n}`;
}

function jsValue(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(jsValue).join(", ")}]`;
    if (value && typeof value === "object") {
        const object = value as Record<string, unknown>;
        if (Object.keys(object).length === 1) {
            if (typeof object.$ref === "string") return object.$ref.split(".").reduce((path, item, index) => index === 0 ? item : `${path}[${/^\d+$/.test(item) ? item : JSON.stringify(item)}]`, "");
            if ("$literal" in object) return JSON.stringify(object.$literal);
            if ("$toString" in object) return `String(${jsValue(object.$toString)})`;
            if (Array.isArray(object.$merge)) return `Object.assign({}, ${object.$merge.map(jsValue).join(", ")})`;
            if (Array.isArray(object.$coalesce)) return `[${object.$coalesce.map(jsValue).join(", ")}].find(value => value !== undefined && value !== null && value !== "")`;
            if (object.$map && typeof object.$map === "object") {
                const map = object.$map as { from: unknown; as?: string; in: unknown };
                return `(${jsValue(map.from)} || []).map((${map.as || "item"}, ${map.as || "item"}Index) => (${jsValue(map.in)}))`;
            }
            if (Object.keys(object)[0]?.startsWith("$")) throw new Error("已有配置使用特殊表达式，请保留原配置或选择新的 JavaScript 模板重新配置。");
        }
        return `{ ${Object.entries(object).map(([key, item]) => `${JSON.stringify(key)}: ${jsValue(item)}`).join(", ")} }`;
    }
    return JSON.stringify(value) ?? "undefined";
}

export function providerScriptAuthoringPrompt(model: string, capability: "image" | "video", baseUrl: string): string {
    return `请根据我接下来提供的 API 文档，为 Seal 的${capability === "image" ? "图片" : "视频"}模型编写并保存 JavaScript 接口配置。\n模型：${model || "待填写"}\n服务地址：${baseUrl || "待填写"}\n在 Seal 创作助手中，请先用 provider_channels_read 读取已有渠道，匹配上述服务地址和模型；用 provider_script_preview 检查后，通过 provider_channel_save 直接保存。若有多个同地址的渠道，先询问具体渠道。没有已有渠道时，确认文档中的服务地址与渠道名称后创建渠道。用户在对话中提供 API Key 时，通过保存工具 apiKey 字段一并填写；不提供新 Key 则保留原值，不回显密钥。保留其他模型与密钥，不改变默认模型，不提交付费生成。其他助手没有这些工具时，只输出对象表达式供导入。\n不需要 import、export、fetch 或轮询代码。\n可用变量：${PROVIDER_SCRIPT_VARIABLES.map(([name, label]) => `${name}（${label}）`).join("、")}。images/videos/audios 是 URL 或 Data URL 字符串数组；request.images/videos/audios 是完整素材对象数组。\n顶层：create（必须）、poll、cancel、result、response（必须）、requiresPublicMediaUrls。\n操作字段：method、path（相对路径，以 / 开头）、contentType、body、query、files、originPath。\n文件用 files: [{name: "image", source: request.images[0]}]，不能填写本地路径。\nresponse 的 taskId/status/result/error/message/base64 可填写字段路径或同步提取函数；statusMap 可映射到 pending/processing/succeeded/failed/cancelled。也支持 resultUrlPaths、inlineBase64Paths、inlineMime、binaryPayload 等结果字段。\n异步请求提供 poll，用 /tasks/{task_id} 引用任务 ID；独立下载接口放在 result。\n密钥与自定义请求头由渠道设置提供，不写入代码。依据文档保留 JSON 类型、数组顺序与嵌套结构，不猜测接口字段。\n参考结构：\n${defaultProviderScript(capability)}`;
}
