import type { AiConfig } from "@/stores/use-config-store";

// Preserve concurrent Agent edits instead of retrying the entire stale UI
// snapshot. Only disjoint changes merge; the same changed field is a conflict.
export function mergeConcurrentModelConfig(base: AiConfig, local: AiConfig, remote: AiConfig): AiConfig {
    const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
        ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item) ?? "undefined";
    const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
    const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
    const merge = (before: unknown, ours: unknown, theirs: unknown, field = ""): unknown => {
        if (equal(ours, before)) return theirs;
        if (equal(theirs, before) || equal(ours, theirs)) return ours;
        if (object(ours) && object(theirs) && (before === undefined || object(before))) {
            const origin = object(before) ? before : {};
            return Object.fromEntries([...new Set([...Object.keys(origin), ...Object.keys(ours), ...Object.keys(theirs)])]
                .map(key => [key, merge(origin[key], ours[key], theirs[key], key)]).filter(([, value]) => value !== undefined));
        }
        if (Array.isArray(ours) && Array.isArray(theirs) && (Array.isArray(before) || before === undefined) && (field === "channels" || field === "modelProfiles" || field === "models")) {
            const keyFor = (value: unknown) => field === "models" ? String(value) : object(value) ? String(value[field === "channels" ? "id" : "model"]) : "";
            const index = (items: unknown[]) => new Map(items.map(item => [keyFor(item), item]));
            const origin = index(Array.isArray(before) ? before : []), own = index(ours), other = index(theirs);
            return [...new Set([...own.keys(), ...other.keys(), ...origin.keys()])]
                .map(key => merge(origin.get(key), own.get(key), other.get(key), field + ".item")).filter(value => value !== undefined);
        }
        throw new Error("模型配置的同一项已被其他操作修改，请核对最新配置后再保存");
    };
    return merge(base, local, remote) as AiConfig;
}
