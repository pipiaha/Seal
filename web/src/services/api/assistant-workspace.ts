import { http } from "./request";
import type { CapturedUserScope } from "@/lib/user-scope-guard";

export type AssistantWebSettings = { enabled: boolean; configured: boolean; apiKey?: string; clearKey?: boolean };
export type AssistantWorkspaceRuntime = { sandbox: boolean; node: boolean; python: boolean; scope: string; maxSeconds: number };
export type AssistantWebStatus = { settings: AssistantWebSettings; runtime: AssistantWorkspaceRuntime };
export function getAssistantWebSettings(scope: CapturedUserScope, signal?: AbortSignal) {
    return http.get<AssistantWebStatus>("/assistant/web-settings", { expectedScope: scope, signal });
}
export function saveAssistantWebSettings(settings: AssistantWebSettings, scope: CapturedUserScope) {
    return http.put<AssistantWebSettings>("/assistant/web-settings", settings, { expectedScope: scope });
}
