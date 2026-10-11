import { http } from "./request";
import type { CapturedUserScope } from "@/lib/user-scope-guard";

export type AssistantWebSettings = {
    enabled: boolean; configured: boolean; provider: "tavily" | "deepseek";
    credentialSource: "manual" | "channel"; channelId?: string;
    baseUrl: string; model: string; maxResults: number;
    apiKey?: string; clearKey?: boolean; configurationError?: string;
};
export type AssistantWebSearchResult = { provider: "tavily" | "deepseek"; sources: Array<{ id: string; title: string; url: string; excerpt?: string; publishedDate?: string }> };
export type AssistantWorkspaceRuntime = { sandbox: boolean; executionMode: "full-access"; node: boolean; python: boolean; scope: string; network: string; maxSeconds: number };
export type AssistantWebStatus = { settings: AssistantWebSettings; runtime: AssistantWorkspaceRuntime };
export function getAssistantWebSettings(scope: CapturedUserScope, signal?: AbortSignal) {
    return http.get<AssistantWebStatus>("/assistant/web-settings", { expectedScope: scope, signal });
}
export function saveAssistantWebSettings(settings: AssistantWebSettings, scope: CapturedUserScope) {
    return http.put<AssistantWebSettings>("/assistant/web-settings", settings, { expectedScope: scope });
}
export function testAssistantWebSearch(query: string, scope: CapturedUserScope, signal?: AbortSignal) {
    return http.post<AssistantWebSearchResult>("/assistant/web-test", { query }, { expectedScope: scope, signal, timeout: 100_000 });
}
