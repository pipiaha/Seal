import { http } from './request';
import type { CapturedUserScope } from '@/lib/user-scope-guard';
import { useThemeStore } from '@/stores/use-theme-store';

export type EditingProject = { id: string; title: string; createdAt: string; updatedAt: string };
export function listEditingProjects(expectedScope: CapturedUserScope, signal?: AbortSignal) {
    return http.get<{ projects: EditingProject[] }>('/editing-projects', { expectedScope, signal });
}
export function createEditingProject(title: string, operationId: string, expectedScope: CapturedUserScope) {
    return http.post<EditingProject>('/editing-projects', { title, operationId }, { expectedScope });
}
export function getEditingProject(id: string, expectedScope: CapturedUserScope, signal?: AbortSignal) {
    return http.get<EditingProject>(`/editing-projects/${encodeURIComponent(id)}`, { expectedScope, signal });
}
export function renameEditingProject(id: string, title: string, expectedScope: CapturedUserScope) {
    return http.patch<EditingProject>(`/editing-projects/${encodeURIComponent(id)}`, { title }, { expectedScope });
}

export type EditLaunch = {
    projectId: string;
    editId: string;
    revision: number;
    studioUrl: string;
    ticket: string;
};

export type EditWorkspaceContext = {
    mode: 'edit';
    projectId: string;
    editId: string;
    revision: number;
    selection: unknown;
    overview?: { width: number; height: number; duration: number; clipCount: number; clips: unknown[] };
    recentChanges?: Array<{ id: string; label: string; who?: { kind: string; name: string } }>;
};

export type EditVisualFrame = { mimeType: 'image/jpeg'; data: string; time: number; file: string };
export function readEditVisual(projectId: string, editId: string, input: { file?: string; time?: number; clipIds?: string[]; expectedRevision?: number }, expectedScope?: CapturedUserScope) {
    return http.post<{ editId: string; revision: number; images: EditVisualFrame[] }>(`/edit-projects/${encodeURIComponent(projectId)}/edits/${encodeURIComponent(editId)}/vision`, input, { expectedScope, timeout: 120_000 });
}

export function openEditProject(projectId: string) {
    return http.post<EditLaunch>(`/edit-projects/${encodeURIComponent(projectId)}/open`, { parentOrigin: window.location.origin, theme: useThemeStore.getState().theme }, { timeout: 45_000 });
}

export async function getEditContext(projectId: string, editId: string, expectedScope?: CapturedUserScope): Promise<EditWorkspaceContext> {
    const data = await http.get<Omit<EditWorkspaceContext, 'mode'>>(`/edit-projects/${encodeURIComponent(projectId)}/edits/${encodeURIComponent(editId)}/context`, { expectedScope });
    return { ...data, mode: 'edit' };
}

const editPath = (projectId: string, editId: string) => `/edit-projects/${encodeURIComponent(projectId)}/edits/${encodeURIComponent(editId)}`;

export type EditMaterial = { file: string; title: string; kind: 'image' | 'video' | 'audio' };
export function listEditMaterials(projectId: string, editId: string, expectedScope: CapturedUserScope, signal?: AbortSignal) {
    return http.get<{ materials: EditMaterial[] }>(`${editPath(projectId, editId)}/materials`, { expectedScope, signal });
}

export type EditExport = {
    exportId: string;
    inputRevision: number;
    createdAt: string;
    status: string;
    progress: number;
    format: string;
};

export function importEditAsset(projectId: string, editId: string, input: { assetId: string; operationId: string; expectedRevision: number }, expectedScope: CapturedUserScope) {
    return http.post<{ revision: number; replayed?: boolean; result: { clipId: string; assetId: string } }>(`${editPath(projectId, editId)}/assets/import`, input, { timeout: 300_000, expectedScope });
}

export function listEditExports(projectId: string, editId: string, expectedScope: CapturedUserScope, signal?: AbortSignal) {
    return http.get<EditExport[]>(`${editPath(projectId, editId)}/exports`, { expectedScope, signal });
}

export async function downloadEditExport(projectId: string, editId: string, exportId: string, expectedScope: CapturedUserScope) {
    const response = await http.raw<Blob>({ url: `${editPath(projectId, editId)}/exports/${encodeURIComponent(exportId)}/file`, method: 'GET', responseType: 'blob', timeout: 300_000, expectedScope });
    return response.data;
}

export type HypitJob = {
    jobId: string;
    command: 'check' | 'plan' | 'build';
    source: string;
    status: 'running' | 'complete' | 'failed' | 'cancelled' | 'interrupted';
    createdAt: string;
    error?: string;
};

export function listHypitJobs(projectId: string, editId: string, expectedScope: CapturedUserScope, signal?: AbortSignal) {
    return http.post<HypitJob[]>(`${editPath(projectId, editId)}/hypit/list`, {}, { expectedScope, signal });
}

export function cancelHypitJob(projectId: string, editId: string, jobId: string, expectedScope: CapturedUserScope) {
    return http.post<HypitJob>(`${editPath(projectId, editId)}/hypit/cancel`, { jobId }, { expectedScope });
}

export function publishHypitJob(projectId: string, editId: string, jobId: string, expectedScope: CapturedUserScope) {
    return http.post<{ candidateId: string; duration: number }>(`${editPath(projectId, editId)}/hypit/publish`, { jobId }, { expectedScope, timeout: 60_000 });
}

export function appendHypitCandidate(projectId: string, editId: string, input: { candidateId: string; expectedRevision: number; operationId: string }, expectedScope: CapturedUserScope) {
    return http.post<{ revision: number }>(`${editPath(projectId, editId)}/promote`, { ...input, append: true }, { expectedScope, timeout: 60_000 });
}

export function replaceHypitCandidate(projectId: string, editId: string, input: { candidateId: string; expectedRevision: number; operationId: string; replaceSceneId: string }, expectedScope: CapturedUserScope) {
    return http.post<{ revision: number }>(`${editPath(projectId, editId)}/promote`, input, { expectedScope, timeout: 60_000 });
}

export type HyperframesCandidate = { kind?: string; candidateId: string; baseRevision: number; duration: number; createdAt: string; canvas: { width: number; height: number } };
export type HyperframesReview = { ok: boolean; report?: { ok: boolean; browserSkipped: boolean }; log?: string; stderr?: string;
    images: { data: string; mimeType: string; file: string }[] };
export function listHyperframesCandidates(projectId: string, editId: string, expectedScope: CapturedUserScope, signal?: AbortSignal) {
    return http.post<HyperframesCandidate[]>(`${editPath(projectId, editId)}/hyperframes/candidates`, {}, { expectedScope, signal });
}
export function reviewHyperframesCandidate(projectId: string, editId: string, candidateId: string, expectedScope: CapturedUserScope) {
    return http.post<HyperframesReview>(`${editPath(projectId, editId)}/hyperframes/review`, { candidateId }, { expectedScope });
}
export function checkHyperframesCandidate(projectId: string, editId: string, candidateId: string, expectedScope: CapturedUserScope) {
    return http.post<HyperframesReview>(`${editPath(projectId, editId)}/hyperframes/inspect`, { candidateId, command: 'check' }, { expectedScope, timeout: 150_000 });
}
export function promoteHyperframesCandidate(projectId: string, editId: string, input: { candidateId: string; expectedRevision: number; operationId: string; replaceSceneId?: string }, expectedScope: CapturedUserScope) {
    return http.post<{ revision: number }>(`${editPath(projectId, editId)}/promote`, { ...input, append: !input.replaceSceneId }, { expectedScope, timeout: 60_000 });
}
