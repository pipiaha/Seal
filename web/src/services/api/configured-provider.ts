import { http } from "./request";
import type { ModelChannel } from "@/stores/use-config-store";

export function inspectComfyUI(channel: ModelChannel) {
    return http.post<{ stats: Record<string, unknown>; nodes: Record<string, unknown> }>("/workspace/providers/comfyui/inspect", { baseUrl: channel.baseUrl, apiKey: channel.apiKey, headers: channel.headers, authType: channel.authType || "none", authHeader: channel.authHeader });
}
