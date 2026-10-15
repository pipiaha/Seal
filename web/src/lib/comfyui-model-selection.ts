import type { ComfyWorkflow } from "@/lib/configured-provider";
import type { WorkflowFieldMapping } from "@/stores/use-config-store";

type ComfyModelInput = { nodeId: string; fieldName: string; title: string; choices: string[]; value: string };

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function comfyModelLabel(fieldName: string) {
    if (fieldName === "ckpt_name" || fieldName === "model_name") return "主模型";
    if (fieldName === "unet_name" || fieldName === "diffusion_model") return "扩散模型";
    if (fieldName === "vae_name") return "VAE";
    if (fieldName === "lora_name") return "LoRA";
    if (fieldName === "control_net_name") return "控制模型";
    return "文本编码器";
}

export function comfyBasicInputs(flow: ComfyWorkflow, nodes: Record<string, unknown> = {}) {
    const labels: Record<string, string> = { width: "宽度", height: "高度", steps: "采样步数", cfg: "引导强度", seed: "随机种子", noise_seed: "随机种子", frame_rate: "帧率", fps: "帧率", duration: "时长（秒）", duration_seconds: "时长（秒）", num_frames: "帧数", batch_size: "生成数量" };
    return Object.entries(flow.graph).flatMap(([nodeId, raw]) => {
        const node = record(raw);
        const schema = record(record(nodes[String(node.class_type)]).input);
        return Object.entries(record(node.inputs)).flatMap(([fieldName, rawValue]) => {
            const field = flow.fields.find(item => item.nodeId === nodeId && item.fieldName === fieldName);
            if (!labels[fieldName] || typeof rawValue !== "number" || field?.source || field?.randomEnabled || field?.safeToOverride === false) return [];
            const input = record(schema.required)[fieldName] ?? record(schema.optional)[fieldName];
            const constraints = Array.isArray(input) ? record(input[1]) : {};
            const value = field && field.enabled !== false ? field.fieldValue ?? rawValue : rawValue;
            if (typeof value !== "number") return [];
            return [{ nodeId, fieldName, label: labels[fieldName], value, min: typeof constraints.min === "number" ? constraints.min : undefined, max: typeof constraints.max === "number" ? constraints.max : undefined, step: typeof constraints.step === "number" ? constraints.step : undefined }];
        });
    }).slice(0, 8);
}

export function updateComfyScalar(flow: ComfyWorkflow, nodeId: string, fieldName: string, value: number): ComfyWorkflow {
    const node = record(flow.graph[nodeId]);
    if (!Number.isFinite(value) || typeof record(node.inputs)[fieldName] !== "number") throw new Error("工作流参数必须是有效数字");
    return { ...flow, graph: { ...flow.graph, [nodeId]: { ...node, inputs: { ...record(node.inputs), [fieldName]: value } } }, fields: flow.fields.map(field => field.nodeId === nodeId && field.fieldName === fieldName ? { ...field, fieldValue: value, value, default: value } : field) };
}

export function comfyInputChoices(nodes: Record<string, unknown>, classType: string, fieldName: string): string[] | undefined {
    const input = record(record(nodes[classType]).input);
    const schema = record(input.required)[fieldName] ?? record(input.optional)[fieldName];
    if (!Array.isArray(schema) || !Array.isArray(schema[0])) return undefined;
    return schema[0].filter((value): value is string => typeof value === "string");
}

export function comfyModelInputs(flow: ComfyWorkflow, nodes: Record<string, unknown>): ComfyModelInput[] {
    const result: ComfyModelInput[] = [];
    for (const [nodeId, raw] of Object.entries(flow.graph)) {
        const node = record(raw);
        const classType = String(node.class_type || "");
        for (const [fieldName, rawValue] of Object.entries(record(node.inputs))) {
            if (Array.isArray(rawValue)) continue;
            // Use the connected instance's enums; filenames alone don't identify a compatible loader.
            if (!/^(ckpt_name|unet_name|vae_name|lora_name|clip_name\d*|control_net_name|model_name|diffusion_model|text_encoder_name)$/i.test(fieldName)) continue;
            const choices = comfyInputChoices(nodes, classType, fieldName);
            if (!choices) continue;
            const field = flow.fields.find(item => item.nodeId === nodeId && item.fieldName === fieldName);
            result.push({ nodeId, fieldName, title: `${String(record(node._meta).title || classType)} · ${fieldName}`, choices, value: String(field?.enabled !== false && field ? field.fieldValue ?? field.value ?? field.default ?? rawValue : rawValue) });
        }
    }
    return result;
}

export function enrichComfyFields(flow: ComfyWorkflow, nodes: Record<string, unknown>): WorkflowFieldMapping[] {
    return flow.fields.map(field => {
        const classType = String(record(flow.graph[field.nodeId]).class_type || field.classType || "");
        const choices = comfyInputChoices(nodes, classType, field.fieldName);
        return choices ? { ...field, fieldType: "SELECT", options: choices, optionsSource: "workflow" } : field;
    });
}

export function selectComfyModel(flow: ComfyWorkflow, nodes: Record<string, unknown>, nodeId: string, fieldName: string, value: string): ComfyWorkflow {
    const node = record(flow.graph[nodeId]);
    const choices = comfyInputChoices(nodes, String(node.class_type || ""), fieldName);
    if (!choices?.includes(value)) throw new Error("该模型不在当前节点的可选列表中，请刷新本机模型");
    const fields = flow.fields.map(field => field.nodeId === nodeId && field.fieldName === fieldName
        ? { ...field, fieldValue: value, value, default: value, source: "", bindPrompt: false, randomEnabled: false }
        : field);
    return { ...flow, graph: { ...flow.graph, [nodeId]: { ...node, inputs: { ...record(node.inputs), [fieldName]: value } } }, fields };
}
