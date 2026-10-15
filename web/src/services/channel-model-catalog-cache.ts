import localforage from "localforage";
import { channelCatalogConnectionIdentity, type ChannelCatalogSnapshot } from "@/lib/channel-model-discovery";
import { captureUserScopeEpoch, scopedStorageKey, userScopeEpochMatches } from "@/lib/user-scope";
import type { ChannelModelCatalogItem } from "@/lib/channel-model-catalog";
import type { ModelChannel } from "@/stores/use-config-store";

const storage = localforage.createInstance({ name: "seal-model-catalog", driver: localforage.INDEXEDDB });
const listeners = new Set<() => void>();
export function subscribeChannelCatalog(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

async function cacheKey(channel: ModelChannel, scope: string) {
    if (typeof indexedDB === "undefined") throw new Error("模型目录缓存需要 IndexedDB");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(channelCatalogConnectionIdentity(channel)));
    return scopedStorageKey(`catalog:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`, scope);
}

export async function readChannelCatalogCache(channel: ModelChannel): Promise<ChannelCatalogSnapshot | null> {
    const epoch = captureUserScopeEpoch();
    try {
        const key = await cacheKey(channel, epoch.scope);
        const value = await storage.getItem<ChannelCatalogSnapshot>(key);
        return userScopeEpochMatches(epoch) ? value : null;
    } catch { return null; }
}

export async function saveChannelCatalogCache(channel: ModelChannel, catalog: ChannelModelCatalogItem[], fetchedAt: number) {
    const epoch = captureUserScopeEpoch();
    const key = await cacheKey(channel, epoch.scope);
    const previous = await storage.getItem<ChannelCatalogSnapshot>(key);
    if (!userScopeEpochMatches(epoch)) return;
    // A slow older response must not replace a newer successful refresh.
    if (previous && previous.fetchedAt > fetchedAt) return;
    await storage.setItem<ChannelCatalogSnapshot>(key, { fetchedAt, catalog, seenIds: [...new Set([...(previous?.seenIds || []), ...catalog.map(item => item.id)])] });
    if (userScopeEpochMatches(epoch)) for (const listener of listeners) listener();
}
