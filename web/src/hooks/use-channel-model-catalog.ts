import { useEffect, useState } from "react";
import { channelCatalogConnectionIdentity, type ChannelCatalogSnapshot } from "@/lib/channel-model-discovery";
import { readChannelCatalogCache, subscribeChannelCatalog } from "@/services/channel-model-catalog-cache";
import { subscribeUserScope } from "@/lib/user-scope";
import type { ModelChannel } from "@/stores/use-config-store";

export function useChannelModelCatalog(channel: ModelChannel) {
    const identity = channelCatalogConnectionIdentity(channel);
    const [state, setState] = useState<{ identity: string; snapshot: ChannelCatalogSnapshot | null }>();
    useEffect(() => {
        let active = true;
        let version = 0;
        const reload = () => {
            const request = ++version;
            void readChannelCatalogCache(channel).then(snapshot => { if (active && request === version) setState({ identity, snapshot }); });
        };
        reload();
        const unsubscribe = subscribeChannelCatalog(reload);
        const unsubscribeScope = subscribeUserScope(() => { setState(undefined); reload(); });
        return () => { active = false; unsubscribe(); unsubscribeScope(); };
    }, [identity]);
    return state?.identity === identity ? state.snapshot : null;
}
