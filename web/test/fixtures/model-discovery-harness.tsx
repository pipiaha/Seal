import { useState } from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider, theme } from "antd";
import { ModelServiceEditor } from "../../src/pages/settings/model-service-editor";
import { createModelChannel, type ModelChannel } from "../../src/stores/use-config-store";
import { normalizeWorkflowFieldMappings } from "../../src/stores/use-config-store";
import { workflowVideoFieldsFromJson } from "../../src/lib/model-capabilities";

const graph = {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "old.safetensors" } },
    "2": { class_type: "CLIPTextEncode", inputs: { text: "prompt", clip: ["1", 1] } },
    "3": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
};
function Harness() {
    const comfy = new URLSearchParams(location.search).has("comfy");
    const [channel, setChannel] = useState<ModelChannel>(() => createModelChannel(comfy ? {
        id: "comfy-test", name: "本机 ComfyUI", baseUrl: "http://127.0.0.1:8188", authType: "none", models: ["test-workflow"],
        modelProfiles: [{ model: "test-workflow", displayName: "产品图工作流", capability: "image", protocol: "comfyui-image", comfyui: { graph, fields: normalizeWorkflowFieldMappings(workflowVideoFieldsFromJson(graph), "image").map(field => field.nodeId === "2" ? { ...field, source: "prompt", enabled: true, role: "prompt" } : field), outputNodeId: "3", outputField: "images" } }],
    } : {
        id: "cloud-test", name: "测试服务", baseUrl: "https://api.openai.com/v1", apiKey: "synthetic-test-only", models: ["image-old", "manual-image"],
        modelProfiles: [{ model: "image-old", capability: "image", protocol: "openai-image", defaultOptions: { quality: "custom" } }, { model: "manual-image", capability: "image", protocol: "openai-image" }],
    }));
    const [open, setOpen] = useState(true);
    const editingChannel = new URLSearchParams(location.search).has("empty") ? { ...channel, modelProfiles: channel.modelProfiles?.map(profile => ({ ...profile, comfyui: undefined })) } : channel;
    return <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}><App>
        <button onClick={() => setOpen(true)}>重新打开</button>
        <pre id="saved">{JSON.stringify(channel)}</pre>
        {open && <ModelServiceEditor capability="image" initial={editingChannel} onClose={() => setOpen(false)} onSave={async next => { setChannel(next); }} />}
    </App></ConfigProvider>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
