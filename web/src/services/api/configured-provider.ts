import { http } from "./request";
import type { ModelChannel } from "@/stores/use-config-store";

export type ProviderScriptSample = {
    capability: "image" | "video"; model: string; prompt: string; duration: number;
    aspectRatio: string; resolution: string; quality?: string; imageCount: number;
    extra: Record<string, unknown>;
    images: Array<{ url: string; kind: string }>; videos: Array<{ url: string; kind: string }>; audios: Array<{ url: string; kind: string }>;
};
export function providerScriptSample(capability: "image" | "video", model: string): ProviderScriptSample {
    return { capability, model: model || "example-model", prompt: "生成一段小狗游泳的视频", duration: 5, aspectRatio: "16:9", resolution: "720p", imageCount: 1, extra: { size: "1280x720" }, images: [{ url: "https://example.com/image.png", kind: "image" }], videos: [{ url: "https://example.com/video.mp4", kind: "video" }], audios: [] };
}
export function previewProviderScript(script: string, request: ProviderScriptSample, response?: unknown) {
    return http.post<{ valid: boolean; create: Record<string, unknown>; poll?: Record<string, unknown>; result?: Record<string, unknown>; parsedResponse?: Record<string, unknown> }>("/workspace/providers/script/preview", { script, request, ...(response === undefined ? {} : { response }) });
}

export function inspectComfyUI(channel: ModelChannel, signal?: AbortSignal) {
    return http.post<{ stats: Record<string, unknown>; nodes: Record<string, unknown> }>("/workspace/providers/comfyui/inspect", { baseUrl: channel.baseUrl, apiKey: channel.apiKey, headers: channel.headers, authType: channel.authType || "none", authHeader: channel.authHeader }, { signal, timeout: 20_000 });
}
