import { useRef, useState } from "react";
import { Alert, Button, Form, Select } from "antd";
import { Download, Upload } from "lucide-react";
import { WorkflowGraphEditor } from "@/components/workflow-graph-editor";
import { normalizeWorkflowFieldMappings, type ModelChannel } from "@/stores/use-config-store";
import { workflowVideoFieldsFromJson } from "@/lib/model-capabilities";
import { defaultCustomProvider, exportModelRecipe, importModelRecipe, parseComfyGraph, type GenerationModelProfile } from "@/lib/configured-provider";
import { inspectComfyUI } from "@/services/api/configured-provider";
import { ProviderScriptEditor } from "./provider-script-editor";

export function ConfiguredProviderEditor({ channel, profile, onChange }: { channel: ModelChannel; profile: GenerationModelProfile; onChange: (patch: Partial<GenerationModelProfile>) => void }) {
    const [error, setError] = useState("");
    const [checking, setChecking] = useState(false);
    const [connection, setConnection] = useState("");
    const [nodes, setNodes] = useState<Record<string, unknown>>();
    const fileInput = useRef<HTMLInputElement>(null);
    const workflowInput = useRef<HTMLInputElement>(null);
    const custom = profile.protocol?.startsWith("custom-");
    const comfy = profile.protocol?.startsWith("comfyui-");
    if (!custom && !comfy) return null;
    const capability = profile.capability === "video" ? "video" : "image";
    const provider = profile.customProvider || defaultCustomProvider(capability);
    const readFile = async (file: File, workflow: boolean) => {
        try {
            if (file.size > 2 * 1024 * 1024) throw new Error("配置文件不能超过 2 MB");
            const text = await file.text();
            if (!workflow && /\.js$/i.test(file.name)) onChange({ protocol: `custom-${capability}`, customProvider: { ...defaultCustomProvider(capability), script: text } });
            else if (!workflow) onChange(importModelRecipe(text, capability));
            else {
                const graph = parseComfyGraph(text);
                const output = Object.entries(graph).filter(([, raw]) => /SaveImage|VideoCombine|SaveVideo|SaveAnimated/i.test(String((raw as Record<string, unknown>).class_type)));
                const fields = normalizeWorkflowFieldMappings(workflowVideoFieldsFromJson(graph), capability);
                // A negative encoder is not a user prompt. Keep ambiguous encoders unchanged until explicitly bound.
                const promptFields = fields.filter(field => field.source === "prompt" && !/negative|负向/i.test(String((graph[field.nodeId] as Record<string, unknown>)._meta ? JSON.stringify((graph[field.nodeId] as Record<string, unknown>)._meta) : "")));
                for (const field of fields) if (field.source === "prompt") field.enabled = promptFields.length === 1 && field === promptFields[0];
                onChange({ comfyui: { graph, fields, outputNodeId: output.length === 1 ? output[0][0] : "", outputField: capability === "image" ? "images" : "gifs" } });
                setConnection("");
            }
            setError("");
        } catch (failure) { setError(failure instanceof Error ? failure.message : "导入失败"); }
    };
    const checkConnection = async () => {
        setChecking(true); setError("");
        try {
            const result = await inspectComfyUI(channel);
            setNodes(result.nodes);
            setConnection(`连接成功，服务提供 ${Object.keys(result.nodes).length} 种节点。此检查未提交生成任务。`);
        } catch (failure) { setError(failure instanceof Error ? failure.message : "无法连接 ComfyUI"); }
        finally { setChecking(false); }
    };
    const exportRecipe = () => {
        try {
            const blob = new Blob([exportModelRecipe({ ...profile, ...(custom ? { customProvider: provider } : {}) })], { type: "application/json" });
            const url = URL.createObjectURL(blob); const link = document.createElement("a");
            link.href = url; link.download = `seal-${capability}-recipe.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setError("");
        } catch (failure) { setError(failure instanceof Error ? failure.message : "导出失败"); }
    };
    const flow = profile.comfyui;
    const missing = nodes && flow ? [...new Set(Object.values(flow.graph).map(raw => String((raw as Record<string, unknown>).class_type)))].filter(name => !nodes[name]) : [];
    return <div className="space-y-4">
        <div className="flex flex-wrap gap-2"><Button size="small" icon={<Upload size={14} />} onClick={() => fileInput.current?.click()}>导入接口配置</Button><Button size="small" icon={<Download size={14} />} onClick={exportRecipe}>导出接口配置</Button></div>
        <input hidden ref={fileInput} type="file" accept=".json,.js,application/json,text/javascript" onChange={event => { const file = event.target.files?.[0]; if (file) void readFile(file, false); event.target.value = ""; }} />
        <p className="text-xs text-foreground/50">配置保存在模型中。导出不包含渠道密钥和请求头；密钥请填写在渠道连接设置。</p>
        {custom && <ProviderScriptEditor provider={provider} capability={capability} model={profile.model} baseUrl={channel.baseUrl} onChange={customProvider => onChange({ customProvider })} />}
        {comfy && <>
            <div className="flex flex-wrap gap-2"><Button icon={<Upload size={14} />} onClick={() => workflowInput.current?.click()}>导入 ComfyUI API 工作流</Button><Button loading={checking} onClick={() => void checkConnection()}>检查连接与节点</Button></div>
            <input hidden ref={workflowInput} type="file" accept=".json,application/json" onChange={event => { const file = event.target.files?.[0]; if (file) void readFile(file, true); event.target.value = ""; }} />
            <p className="text-xs text-foreground/50">先启动已有 ComfyUI。Seal 不安装模型或节点；导入后绑定正向提示词、参考图片及需要调整的参数。视频／音频文件输入暂不支持，工作流可生成视频。</p>
            {flow && <>
                <Form layout="vertical"><Form.Item label="最终输出节点"><Select aria-label="输出节点" value={flow.outputNodeId || undefined} placeholder="选择保存图片／视频的节点" options={Object.entries(flow.graph).map(([id, raw]) => ({ value: id, label: `${id} · ${String((raw as Record<string, unknown>).class_type)}` }))} onChange={outputNodeId => onChange({ comfyui: { ...flow, outputNodeId } })} /></Form.Item>
                    <Form.Item label="输出字段"><Select value={flow.outputField} options={(capability === "image" ? ["images"] : ["gifs", "videos"]).map(value => ({ value, label: value === "gifs" ? "gifs（VHS 视频输出）" : value }))} onChange={outputField => onChange({ comfyui: { ...flow, outputField } })} /></Form.Item></Form>
                <WorkflowGraphEditor workflowJson={flow.graph} fields={flow.fields} onChange={fields => onChange({ comfyui: { ...flow, fields } })} />
            </>}
            {connection && <Alert type="success" title={connection} />}{missing.length > 0 && <Alert type="warning" title={`缺少节点：${missing.join("、")}`} />}
        </>}
        {error && <Alert type="error" showIcon title={error} />}
    </div>;
}
