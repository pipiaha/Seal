import { catalogEndpointCapability, type ChannelModelCatalogItem } from "@/lib/channel-model-catalog";
import type { ModelCapability, ModelChannel } from "@/stores/use-config-store";

export type ChannelCatalogSnapshot = {
    catalog: ChannelModelCatalogItem[];
    fetchedAt: number;
    seenIds: string[];
};

// This identity stays in memory. The cache stores only its SHA-256 digest, never credentials.
export function channelCatalogConnectionIdentity(channel: ModelChannel) {
    return JSON.stringify([channel.id, channel.baseUrl.trim(), channel.modelsUrl?.trim() || "", channel.apiFormat, channel.authType || "bearer", channel.authHeader || "", channel.apiKey, channel.credentialRef || "", channel.hasApiKey, channel.headers || []]);
}

export function catalogWithSavedModels(channel: ModelChannel, snapshot?: ChannelCatalogSnapshot | null): ChannelModelCatalogItem[] {
    const byId = new Map((snapshot?.catalog || []).map(item => [item.id, item]));
    for (const id of channel.models) if (!byId.has(id)) byId.set(id, { id });
    return [...byId.values()];
}

export function discoveredModelCapability(channel: ModelChannel, item: ChannelModelCatalogItem): ModelCapability | undefined {
    return channel.modelProfiles?.find(profile => profile.model === item.id)?.capability || item.modelType || catalogEndpointCapability(item);
}

export function modelAbsentFromCatalog(id: string, snapshot?: ChannelCatalogSnapshot | null) {
    return Boolean(snapshot?.seenIds.includes(id) && !snapshot.catalog.some(item => item.id === id));
}

export function catalogRefreshLabel(snapshot?: ChannelCatalogSnapshot | null) {
    if (!snapshot) return "尚未刷新目录";
    const outdated = Date.now() - snapshot.fetchedAt > 24 * 60 * 60 * 1000;
    return `供应商目录 · ${new Date(snapshot.fetchedAt).toLocaleString()}${outdated ? " · 建议刷新" : ""}`;
}
