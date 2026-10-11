import { expect, test } from "bun:test";
import { modelConfigChannelPresentation, modelConfigChannelStatusLabel } from "../src/pages/settings/channel-settings-pane";
import { createModelChannel, defaultConfig, normalizeConfigSnapshot } from "../src/stores/use-config-store";

test("user channels remain editable and deletable", () => {
    const channel = createModelChannel({ id: "own", apiKey: "" });
    expect(modelConfigChannelPresentation(channel)).toEqual({ builtin: false, deletable: true, adapterLabel: "" });
    expect(modelConfigChannelStatusLabel(channel, { status: "idle", revision: 0, dirty: false, error: "" })).toBe("待配置");
});

test("saved credentials do not imply a successful connection test", () => {
    const channel = createModelChannel({ id: "own", apiKey: "own-key" });
    expect(modelConfigChannelStatusLabel(channel, { status: "saved", revision: 1, dirty: false, error: "" })).toBe("已保存 · 尚未测试");
});

test("retired built-in defaults require explicit reselection without changing manual channels", () => {
    const own = createModelChannel({ id: "own", models: ["my-video"], modelProfiles: [{ model: "my-video", capability: "video", protocol: "newapi" }] });
    const config = normalizeConfigSnapshot({ config: { ...defaultConfig, channels: [createModelChannel({ id: "beefapi", pinned: true }), own], videoModel: "beefapi::old-video" } }).config;
    expect(config.channels.map(channel => channel.id)).toEqual(["own"]);
    expect(config.videoModel).toBe("");
    expect(config.modelSelectionRequired).toContain("videoModel");
    expect(normalizeConfigSnapshot({ config }).config.videoModel).toBe("");
    expect(normalizeConfigSnapshot({ config: { ...config, videoModel: "own::my-video" } }).config.videoModel).toBe("own::my-video");
});
