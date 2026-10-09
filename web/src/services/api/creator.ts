import { http } from "./request";
import type { CapturedUserScope } from "@/lib/user-scope-guard";
import type { CreateTaskInput, GenerationTask } from "./task-center";

export type MediaProposal = {
    proposalId: string;
    projectId: string;
    kind: "image" | "video" | "audio";
    prompt: string;
    model: string;
    modelKey: string;
    configRevision: number;
    taskId?: string;
    sessionId?: string;
    decision?: string;
    autoContinue: boolean;
    continuationTurnId?: string;
};
export function listMediaProposals(projectId: string, scope: CapturedUserScope, signal?: AbortSignal) {
    return http.post<{ items: MediaProposal[] }>(`/assistant/projects/${encodeURIComponent(projectId)}/media/proposals`, {}, { expectedScope: scope, signal });
}
export function acceptMediaProposal(projectId: string, id: string, input: CreateTaskInput, scope: CapturedUserScope, automatic = false) {
    return http.post<GenerationTask>(`/assistant/projects/${encodeURIComponent(projectId)}/media/accept/${encodeURIComponent(id)}`, { ...input, automatic }, { expectedScope: scope });
}
export type AssistantPermissionMode = "ask" | "allow";
export function readAssistantPermissions(projectId: string, sessionId: string, scope: CapturedUserScope) {
    return http.post<{ mode: AssistantPermissionMode }>(`/assistant/projects/${encodeURIComponent(projectId)}/permissions/read`, { sessionId }, { expectedScope: scope });
}
export function writeAssistantPermissions(projectId: string, sessionId: string, mode: AssistantPermissionMode, scope: CapturedUserScope) {
    return http.post<{ mode: AssistantPermissionMode }>(`/assistant/projects/${encodeURIComponent(projectId)}/permissions/write`, { sessionId, mode }, { expectedScope: scope });
}
export function stopAssistantMediaSession(projectId: string, sessionId: string, scope: CapturedUserScope) {
    return http.post(`/assistant/projects/${encodeURIComponent(projectId)}/permissions/stop`, { sessionId }, { expectedScope: scope });
}
export function resumeAssistantMediaSession(projectId: string, sessionId: string, scope: CapturedUserScope) {
    return http.post(`/assistant/projects/${encodeURIComponent(projectId)}/permissions/resume`, { sessionId }, { expectedScope: scope });
}
export function rejectMediaProposal(projectId: string, id: string, scope: CapturedUserScope) {
    return http.post(`/assistant/projects/${encodeURIComponent(projectId)}/media/reject/${encodeURIComponent(id)}`, {}, { expectedScope: scope });
}
export function getMediaProposalTask(projectId: string, taskId: string, scope: CapturedUserScope, signal?: AbortSignal) {
    return http.post<GenerationTask>(`/assistant/projects/${encodeURIComponent(projectId)}/media/task`, { taskId }, { expectedScope: scope, signal });
}
export function getAsrTask(projectId: string, taskId: string, scope: CapturedUserScope, signal?: AbortSignal) {
    return http.post<{ taskId: string; status: string; stage: string; progress: number; error?: string; resultJson?: string }>(`/assistant/projects/${encodeURIComponent(projectId)}/media/transcription`, { taskId }, { expectedScope: scope, signal });
}

export type AsrSettings = { revision: number; defaultRoute: "auto" | "local" | "service"; language: string; serviceEnabled: boolean; serviceType: "whisper" | "openai"; baseUrl: string; model: string; apiKey: string; hasApiKey: boolean };
export type AsrRuntimeStatus = { localReady: boolean; serviceReady: boolean; defaultRoute: "" | "local" | "service"; model: string; modelBytes: number; timingLevel: string; settings: AsrSettings };
export function getAsrRuntimeStatus(scope: CapturedUserScope, signal?: AbortSignal) {
    return http.get<AsrRuntimeStatus>("/assistant/asr", { expectedScope: scope, signal });
}
export function saveAsrSettings(settings: AsrSettings, scope: CapturedUserScope) {
    return http.put<AsrRuntimeStatus>("/assistant/asr", settings, { expectedScope: scope });
}
