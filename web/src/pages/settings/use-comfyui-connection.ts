import { useCallback, useEffect, useRef, useState } from "react";
import type { ModelChannel } from "@/stores/use-config-store";
import { channelCatalogConnectionIdentity } from "@/lib/channel-model-discovery";
import { inspectComfyUI } from "@/services/api/configured-provider";

export function useComfyUIConnection(channel: ModelChannel) {
    const identity = channelCatalogConnectionIdentity(channel);
    const current = useRef(identity);
    current.current = identity;
    const abort = useRef<AbortController | null>(null);
    const [state, setState] = useState<{ identity: string; nodes?: Record<string, unknown>; checkedAt?: number; checking?: boolean; error?: string }>({ identity });
    useEffect(() => {
        current.current = identity;
        setState({ identity });
        return () => { current.current = ""; abort.current?.abort(); };
    }, [identity]);
    const check = useCallback(async () => {
        abort.current?.abort();
        const controller = new AbortController();
        abort.current = controller;
        setState(previous => ({ ...previous, identity, checking: true, error: "" }));
        try {
            const result = await inspectComfyUI(channel, controller.signal);
            if (!controller.signal.aborted && current.current === identity) setState({ identity, nodes: result.nodes, checkedAt: Date.now(), checking: false });
        } catch (failure) {
            if (!controller.signal.aborted && current.current === identity) setState(previous => ({ ...previous, checking: false, error: failure instanceof Error ? failure.message : "无法连接 ComfyUI，请检查是否启动及服务地址" }));
        }
    }, [identity]);
    return { ...(state.identity === identity ? state : { identity }), check };
}
export type ComfyUIConnection = ReturnType<typeof useComfyUIConnection>;
