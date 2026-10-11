import { expect, test } from "bun:test";
import { CONFIGURED_PROTOCOLS, defaultCustomProvider, exportModelRecipe, importModelRecipe, parseComfyGraph } from "../src/lib/configured-provider";
import { createModelChannel, defaultConfig, resolveModelChannel, resolveModelRequestConfig } from "../src/stores/use-config-store";
import { backendProviderConfig } from "../src/services/api/generation-task";
import { modelServicePresetsFor, serviceConnectionError, serviceModelProfile } from "../src/lib/model-service-presets";

test("custom request and Comfy workflow survive channel persistence and production task assembly", () => {
    const comfyui = { graph: { "1": { class_type: "TextEncoder", inputs: { text: "original" } } }, fields: [{ nodeId: "1", fieldName: "text", source: "prompt" }], outputNodeId: "1", outputField: "images" as const };
    const channel = createModelChannel({ id: "local", name: "本机工作流", baseUrl: "http://127.0.0.1:8188", authType: "none", models: ["flow"], modelProfiles: [{ model: "flow", capability: "image", protocol: "comfyui-image", comfyui }] });
    const config = JSON.parse(JSON.stringify({ ...defaultConfig, channels: [channel], model: "local::flow" }));
    expect(serviceConnectionError(channel)).toBe("");
    expect(backendProviderConfig(config, "image")).toMatchObject({ authType: "none", sourceChannelName: "本机工作流", sourceChannelId: "local", interfaceType: "comfyui-image", comfyui, channelId: "" });
    const custom = createModelChannel({ ...channel, baseUrl: "https://example.com/v1", authType: "header", authHeader: "X-API-Key", apiKey: "synthetic", modelProfiles: [{ model: "flow", capability: "image", protocol: "custom-image", customProvider: defaultCustomProvider("image") }] });
    expect(backendProviderConfig({ ...config, channels: [custom] }, "image")).toMatchObject({ authHeader: "X-API-Key", customProvider: { auth: { type: "header", field: "apiKey", header: "X-API-Key" } } });
});

test("an explicitly deleted or disabled channel never routes to the first channel", () => {
    const channel = createModelChannel({ id: "other", models: ["model"] });
    const config = { ...defaultConfig, channels: [channel] };
    expect(resolveModelChannel(config, "gone::model").enabled).toBe(false);
    expect(() => resolveModelRequestConfig(config, "gone::model")).toThrow("移除或停用");
    expect(() => resolveModelRequestConfig({ ...config, channels: [{ ...channel, enabled: false }] }, "other::model")).toThrow();
});

test("Agnes presets use separate video and JSON image contracts", () => {
    for (const capability of ["image", "video"] as const) expect(modelServicePresetsFor(capability).some(preset => preset.id === "agnes")).toBe(true);
    expect(modelServicePresetsFor("text").some(preset => preset.id === "agnes")).toBe(false);
    const channel = createModelChannel({ baseUrl: "https://apihub.agnes-ai.com/v1" });
    const profile = serviceModelProfile(channel, { id: "agnes-image-2.5-flash", modelType: "image" }, [...CONFIGURED_PROTOCOLS, { value: "agnes-image", capability: "image", label: "Agnes Image", create: "POST /v1/images/generations", contentType: "application/json", media: "", enabled: true }], "image");
    expect(profile.customProvider).toBeUndefined();
    expect(profile.protocol).toBe("agnes-image");
    expect(profile.capabilityConfig?.image?.references.maskSupported).toBe(false);
});

test("recipe import validates type and workflow format; secrets cannot be exported", () => {
    const profile = { model: "any", capability: "video" as const, protocol: "custom-video", customProvider: defaultCustomProvider("video") };
    const text = exportModelRecipe(profile);
    expect(importModelRecipe(text, "video").customProvider).toEqual(profile.customProvider);
    expect(() => importModelRecipe(text, "image")).toThrow();
    expect(() => exportModelRecipe({ ...profile, customProvider: { ...profile.customProvider, create: { ...profile.customProvider.create, body: { api_key: "secret" } } } })).toThrow("凭证");
    expect(() => parseComfyGraph('{"nodes":[],"links":[]}')).toThrow("API 格式");
});
