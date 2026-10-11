import { getLocalModelConfig, saveLocalModelConfig, type LocalModelConfigPayload } from "@/services/api/workspace";
import type { AiConfig } from "@/stores/use-config-store";
import { mergeConcurrentModelConfig } from "@/lib/model-config-merge";

export type ModelConfigPersistenceState = {
    status: "idle" | "hydrating" | "saving" | "saved" | "error";
    revision: number;
    dirty: boolean;
    error: string;
};

type ModelConfigRepositoryDependencies = {
    read: () => Promise<LocalModelConfigPayload>;
    write: (config: AiConfig, expectedRevision: number) => Promise<{ saved: boolean; revision: number }>;
};

export function createModelConfigRepository(dependencies: ModelConfigRepositoryDependencies) {
    let state: ModelConfigPersistenceState = { status: "idle", revision: 0, dirty: false, error: "" };
    let hydrated = false;
    let latestConfig: AiConfig | null = null;
    let baseConfig: AiConfig | null = null;
    let applyingRemote = false;
    const remoteListeners = new Set<(config: AiConfig) => void>();
    const applyRemote = (config: AiConfig) => {
        applyingRemote = true;
        try { remoteListeners.forEach(listener => listener(config)); } finally { applyingRemote = false; }
    };
    let generation = 0;
    let drainPromise: Promise<void> | null = null;
    let resolveHydration: (() => void) | null = null;
    const hydrationBarrier = new Promise<void>((resolve) => {
        resolveHydration = resolve;
    });
    const listeners = new Set<(next: ModelConfigPersistenceState) => void>();

    const publish = (patch: Partial<ModelConfigPersistenceState>) => {
        state = { ...state, ...patch };
        listeners.forEach((listener) => listener(state));
    };

    const hydrate = async () => {
        publish({ status: "hydrating", error: "" });
        try {
            const result = await dependencies.read();
            baseConfig = structuredClone(result.config);
            state = { status: "idle", revision: result.revision, dirty: Boolean(latestConfig), error: "" };
            return result;
        } catch (error) {
            publish({ status: "error", error: error instanceof Error ? error.message : "读取模型配置失败" });
            throw error;
        } finally {
            hydrated = true;
            resolveHydration?.();
            resolveHydration = null;
            if (latestConfig) void scheduleDrain();
        }
    };

    const runDrain = async () => {
        while (hydrated && latestConfig && state.dirty) {
            const config = latestConfig;
            const savingGeneration = generation;
            publish({ status: "saving", error: "" });
            try {
                const result = await dependencies.write(config, state.revision);
                baseConfig = structuredClone(config);
                state = { status: "saved", revision: result.revision, dirty: generation !== savingGeneration, error: "" };
            } catch (error) {
                if (isRevisionConflict(error)) {
                    try {
                        const current = await dependencies.read();
                        const merged = mergeConcurrentModelConfig(baseConfig || config, config, current.config);
                        state = { ...state, revision: current.revision, status: "saving", dirty: true, error: "" };
                        const retried = await dependencies.write(merged, state.revision);
                        latestConfig = generation === savingGeneration ? merged : mergeConcurrentModelConfig(config, latestConfig!, merged);
                        baseConfig = structuredClone(merged);
                        state = { status: "saved", revision: retried.revision, dirty: generation !== savingGeneration, error: "" };
                        applyRemote(latestConfig);
                        continue;
                    } catch (retryError) {
                        error = retryError;
                    }
                }
                publish({ status: "error", dirty: true, error: error instanceof Error ? error.message : "保存模型配置失败" });
                return;
            }
        }
        listeners.forEach((listener) => listener(state));
    };

    const scheduleDrain = (): Promise<void> => {
        if (!hydrated) return hydrationBarrier.then(scheduleDrain);
        if (!drainPromise) {
            drainPromise = runDrain().finally(() => {
                drainPromise = null;
            });
        }
        return drainPromise;
    };

    const commit = (config: AiConfig) => {
        if (applyingRemote) return Promise.resolve();
        latestConfig = config;
        generation += 1;
        publish({ dirty: true });
        return scheduleDrain();
    };

    return {
        hydrate,
        commit,
        flush: scheduleDrain,
        refresh: async () => {
            if (!hydrated || state.dirty || drainPromise) return false;
            const started = generation;
            const current = await dependencies.read();
            if (generation !== started || state.dirty || drainPromise) return false;
            if (current.revision <= state.revision) return true;
            baseConfig = structuredClone(current.config);
            latestConfig = current.config;
            publish({ revision: current.revision, status: "saved", dirty: false, error: "" });
            applyRemote(current.config);
            return true;
        },
        subscribeRemote: (listener: (config: AiConfig) => void) => {
            remoteListeners.add(listener);
            return () => remoteListeners.delete(listener);
        },
        getState: () => state,
        subscribe: (listener: (next: ModelConfigPersistenceState) => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}

function isRevisionConflict(error: unknown) {
    if (!error || typeof error !== "object") return false;
    const candidate = error as { status?: number; response?: { status?: number } };
    return candidate.status === 409 || candidate.response?.status === 409;
}

const repository = createModelConfigRepository({
    read: getLocalModelConfig,
    write: (config, expectedRevision) => saveLocalModelConfig(config, expectedRevision),
});

export const hydrateModelConfig = repository.hydrate;
export const commitModelConfig = repository.commit;
export const flushModelConfig = repository.flush;
export const getModelConfigPersistenceState = repository.getState;
export const subscribeModelConfigPersistence = repository.subscribe;
export const refreshModelConfig = repository.refresh;
export const subscribeRemoteModelConfig = repository.subscribeRemote;
