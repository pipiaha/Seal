import { expect, test } from "bun:test";
import { comfyModelInputs, enrichComfyFields, selectComfyModel } from "../src/lib/comfyui-model-selection";
import type { ComfyWorkflow } from "../src/lib/configured-provider";

const nodes = {
    CheckpointLoaderSimple: { input: { required: { ckpt_name: [["old.safetensors", "new.safetensors"]] } } },
    DualCLIPLoader: { input: { required: { clip_name1: [["encoder.safetensors"]] } } },
};
function workflow(): ComfyWorkflow {
    return {
        graph: {
            "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "old.safetensors" } },
            "2": { class_type: "DualCLIPLoader", inputs: { clip_name1: "missing.safetensors", clip_name2: ["1", 0] } },
            "3": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
        },
        fields: [{ nodeId: "1", fieldName: "ckpt_name", fieldValue: "old.safetensors", enabled: false }],
        outputNodeId: "3", outputField: "images",
    };
}

test("ComfyUI model options come from the connected loader and keep missing values visible", () => {
    const choices = comfyModelInputs(workflow(), nodes);
    expect(choices).toHaveLength(2);
    expect(choices[0]!.choices).toEqual(["old.safetensors", "new.safetensors"]);
    expect(choices[1]!.value).toBe("missing.safetensors");
    expect(enrichComfyFields(workflow(), nodes)[0]).toMatchObject({ fieldType: "SELECT", enabled: false, options: choices[0]!.choices });
});

test("changing a model changes the executable graph even for disabled field overrides", () => {
    const original = workflow();
    const next = selectComfyModel(original, nodes, "1", "ckpt_name", "new.safetensors");
    expect(next.graph["1"]).toMatchObject({ inputs: { ckpt_name: "new.safetensors" } });
    expect(next.fields[0]).toMatchObject({ fieldValue: "new.safetensors", enabled: false });
    expect(next.graph["3"]).toEqual(original.graph["3"]);
    expect(original.graph["1"]).toMatchObject({ inputs: { ckpt_name: "old.safetensors" } });
    expect(() => selectComfyModel(original, nodes, "1", "ckpt_name", "unknown.safetensors")).toThrow("不在当前节点");
});
