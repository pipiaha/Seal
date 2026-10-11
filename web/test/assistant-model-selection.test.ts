import { expect, test } from "bun:test";
import { assistantModelOptions, resolveAssistantModel } from "@/lib/assistant-model";
import { createModelChannel, defaultConfig } from "@/stores/use-config-store";

const models = ["gpt-6-astra", "gpt-6.1-sol", "qwen3.8-flash"];
const channel = createModelChannel({ id: "own", models, modelProfiles: models.map(model => ({ model, capability: "text", protocol: "chat-completion" })) });
const config = { ...defaultConfig, channels: [channel], textModel: "own::qwen3.8-flash" };

test("assistant follows a custom default text model without modelProfiles", () => {
    const custom = createModelChannel({ id: "newapi-local", apiFormat: "openai", models: ["deepseek-v4-flash:free", "unclassified-model"] });
    for (const textModel of ["deepseek-v4-flash:free", "newapi-local::deepseek-v4-flash:free"]) {
        const c = { ...defaultConfig, channels: [custom], textModel };
        expect(assistantModelOptions(c)).toEqual(["newapi-local::deepseek-v4-flash:free"]);
        expect(resolveAssistantModel(c)).toBe("newapi-local::deepseek-v4-flash:free");
        expect(resolveAssistantModel({ ...c, assistantModel: "newapi-local::unclassified-model" })).toBe("");
    }
});

test("models-only fallback keeps channel and explicit profile restrictions", () => {
    const custom = createModelChannel({ id: "custom", models: ["local-text"] });
    const c = { ...defaultConfig, channels: [custom], textModel: "custom::local-text" };
    for (const update of [
        { enabled: false }, { scope: "system" as const }, { pinned: true }, { credentialRef: "managed" },
        { apiFormat: "gemini" as const }, { interfaceType: "openai-image" },
        { modelProfiles: [{ model: "local-text", capability: "image" as const, protocol: "openai-image" }] },
        { modelProfiles: [{ model: "local-text", capability: "text" as const, protocol: "unsupported" }] },
    ]) {
        expect(resolveAssistantModel({ ...c, channels: [{ ...custom, ...update }] })).toBe("");
    }
    for (const update of [{ apiFormat: "claude" as const }, { interfaceType: "responses" }]) {
        expect(resolveAssistantModel({ ...c, channels: [{ ...custom, ...update }] })).toBe("custom::local-text");
    }
});

test("configured text profiles are available without a curated supplier list", () => {
    expect(assistantModelOptions(config)).toEqual(models.map(m => `own::${m}`));
    expect(resolveAssistantModel(config)).toBe("own::qwen3.8-flash");
});

test("custom channels remain unrestricted and explicit missing models do not silently fall back", () => {
    const custom = { ...channel, id: "custom", pinned: false };
    const c = { ...config, channels: [custom], textModel: "custom::qwen3.8-flash" };
    expect(assistantModelOptions(c)).toContain("custom::qwen3.8-flash");
    expect(resolveAssistantModel(c)).toBe("custom::qwen3.8-flash");
    expect(resolveAssistantModel({ ...c, assistantModel: "custom::missing" })).toBe("");
});

test("managed aliases must resolve to an available text profile", () => {
    const alias = { ...channel, models: ["opus-catalog"], modelAliases: { "claude-opus-5-5": "opus-catalog" }, modelProfiles: [{ model: "opus-catalog", capability: "text" as const, protocol: "claude-api" as const }] };
    expect(assistantModelOptions({ ...config, channels: [alias] })).toEqual(["own::opus-catalog"]);
});

test("retired assistant selection must be explicitly replaced", () => {
    expect(resolveAssistantModel({ ...config, modelSelectionRequired: ["assistantModel"] })).toBe("");
});
