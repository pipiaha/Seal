import { http } from './request';
import type { CapturedUserScope } from '@/lib/user-scope-guard';

export type MediaCallType = 'image' | 'video' | 'audio' | 'asr';
export type MediaCall = {
    id: string; taskId?: string; channelId: string; channelName?: string; model: string;
    capability: MediaCallType; operation?: string; requestKind: string; method: string;
    path: string; upstreamUrl: string; status: string; statusCode: number; durationMs: number;
    providerRequestId?: string; error?: string; errorCode?: string; startedAt: string; createdAt: string; pollCount?: number;
    requestContentType?: string; requestBody?: string; responseBody?: string;
};
export type MediaCallEntry = MediaCall & { outcome: string; taskStage?: string; taskStatus?: string; projectId?: string; requestCount: number };
export type MediaCallPage = { items: MediaCallEntry[]; total: number; page: number; pageSize: number };
export type MediaCallDetail = { entry: MediaCallEntry; requests: MediaCall[]; total: number; page: number; pageSize: number };
export type MediaCallFilter = { capability?: string; status?: string; keyword?: string; channelId?: string; taskId?: string; page: number; limit: number };

export function listMediaCalls(filter: MediaCallFilter, scope: CapturedUserScope, signal?: AbortSignal) {
    return http.get<MediaCallPage>('/call-logs', { params: filter, expectedScope: scope, signal });
}
export function readMediaCall(id: string, page: number, scope: CapturedUserScope, signal?: AbortSignal) {
    return http.get<MediaCallDetail>(`/call-logs/${encodeURIComponent(id)}`, { params: { page }, expectedScope: scope, signal });
}
export function readMediaRequest(groupId: string, id: string, scope: CapturedUserScope, signal?: AbortSignal) {
    return http.get<MediaCall>(`/call-logs/${encodeURIComponent(groupId)}/requests/${encodeURIComponent(id)}`, { expectedScope: scope, signal });
}
