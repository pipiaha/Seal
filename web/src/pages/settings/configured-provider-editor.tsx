import { useRef, useState } from "react";
import { Alert, Button, Checkbox, Form, Input, Select } from "antd";
import { Download, Upload } from "lucide-react";
import { WorkflowGraphEditor } from "@/components/workflow-graph-editor";
import { normalizeWorkflowFieldMappings, type ModelChannel } from "@/stores/use-config-store";
import { workflowVideoFieldsFromJson } from "@/lib/model-capabilities";
import { defaultCustomProvider, exportModelRecipe, importModelRecipe, parseComfyGraph, type CustomProvider, type GenerationModelProfile, type ProviderOperation } from "@/lib/configured-provider";
import { inspectComfyUI } from "@/services/api/configured-provider";

const splitPaths = (text: string) => text.split(",").map(item => item.trim()).filter(Boolean);
const methodOptions = ["POST", "GET", "PUT", "DELETE"].map(value => ({ value, label: value }));

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
    const patchProvider = (patch: Partial<CustomProvider>) => onChange({ customProvider: { ...provider, ...patch } });
    const patchOperation = (key: "create" | "poll" | "cancel" | "result", patch: Partial<ProviderOperation>) => patchProvider({ [key]: { ...(provider[key] || { method: key === "poll" || key === "result" ? "GET" : "POST", path: "/" }), ...patch } });
    const readFile = async (file: File, workflow: boolean) => {
        try {
            if (file.size > 2 * 1024 * 1024) throw new Error("配置文件不能超过 2 MB");
            const text = await file.text();
            if (!workflow) onChange(importModelRecipe(text, capability));
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
        <input hidden ref={fileInput} type="file" accept=".json,application/json" onChange={event => { const file = event.target.files?.[0]; if (file) void readFile(file, false); event.target.value = ""; }} />
        <p className="text-xs text-foreground/50">配置保存在模型中。导出不包含渠道密钥和请求头；密钥请填写在渠道连接设置。</p>
        {custom && <Form layout="vertical" requiredMark={false}>
            <Form.Item label="提交接口"><div className="flex gap-2"><Select aria-label="提交方法" value={provider.create.method} options={methodOptions} onChange={method => patchOperation("create", { method })} /><Input aria-label="提交路径" value={provider.create.path} onChange={event => patchOperation("create", { path: event.target.value })} placeholder="/videos" /></div></Form.Item>
            <Form.Item label="提交格式"><Select value={provider.create.contentType || "application/json"} options={[{ value: "application/json", label: "JSON" }, { value: "multipart/form-data", label: "Multipart 文件表单" }]} onChange={contentType => patchOperation("create", { contentType })} /></Form.Item>
            <ProviderFieldRows fields={provider.create.fields || {}} onChange={fields => patchOperation("create", { fields })} />
            <JsonField key={`${profile.model}:body`} label="固定参数／JSON 模板（可选）" value={provider.create.body || {}} onChange={body => patchOperation("create", { body })} help='可用 {"$ref":"request.model"} 引用输入，$map 映射素材数组；不能执行 JavaScript。完整规则见接口配置文档。' />
            {provider.create.contentType === "multipart/form-data" && <JsonField key={`${profile.model}:files`} label="文件字段" value={provider.create.files || []} onChange={files => { if (!Array.isArray(files)) throw new Error("文件字段必须是数组"); patchOperation("create", { files }); }} help='例如 [{"name":"image","source":{"$ref":"request.images.0"}}]。' />}
            <Checkbox checked={Boolean(provider.requiresPublicMediaUrls)} onChange={event => patchProvider({ requiresPublicMediaUrls: event.target.checked })}>服务要求公开可访问的素材 URL</Checkbox>
            <div className="mt-4"><Checkbox checked={Boolean(provider.poll)} onChange={event => patchProvider({ poll: event.target.checked ? { method: "GET", path: "/tasks/{task_id}" } : undefined })}>异步任务：提交后查询状态</Checkbox></div>
            {provider.poll && <>
                <Form.Item label="查询接口" className="mt-3"><div className="flex gap-2"><Select value={provider.poll.method} options={methodOptions} onChange={method => patchOperation("poll", { method })} /><Input aria-label="查询路径" value={provider.poll.path} onChange={event => patchOperation("poll", { path: event.target.value })} placeholder="/tasks/{task_id}" /></div></Form.Item>
                <Checkbox checked={Boolean(provider.poll.originPath)} onChange={event => patchOperation("poll", { originPath: event.target.checked })}>查询路径从域名根开始（不追加基础地址路径）</Checkbox>
                <JsonField key={`${profile.model}:query`} label="查询参数（可选）" value={provider.poll.query || {}} onChange={query => patchOperation("poll", { query })} help='例如 {"id":{"$ref":"taskId"}}。' />
                {provider.poll.method !== "GET" && <JsonField key={`${profile.model}:pollbody`} label="查询请求体" value={provider.poll.body || {}} onChange={body => patchOperation("poll", { body })} help='例如 {"task_id":{"$ref":"taskId"}}。' />}
                <Form.Item label="任务 ID 路径"><Input value={provider.response.taskIdPaths?.join(", ")} onChange={event => patchProvider({ response: { ...provider.response, taskIdPaths: splitPaths(event.target.value) } })} placeholder="data.task_id" /></Form.Item>
                <Form.Item label="状态路径"><Input value={provider.response.statusPaths?.join(", ")} onChange={event => patchProvider({ response: { ...provider.response, statusPaths: splitPaths(event.target.value) } })} placeholder="data.status" /></Form.Item>
                <JsonField key={`${profile.model}:status`} label="状态值映射" value={provider.response.statusMap || {}} onChange={statusMap => patchProvider({ response: { ...provider.response, statusMap } })} help='例：{"0":"pending","1":"processing","2":"succeeded","3":"failed"}。常见状态名称可自动识别。' />
                <Checkbox checked={Boolean(provider.cancel)} onChange={event => patchProvider({ cancel: event.target.checked ? { method: "DELETE", path: "/tasks/{task_id}" } : undefined })}>供应商支持定向取消</Checkbox>
                {provider.cancel && <Form.Item label="取消接口"><div className="flex gap-2"><Select value={provider.cancel.method} options={methodOptions} onChange={method => patchOperation("cancel", { method })} /><Input value={provider.cancel.path} onChange={event => patchOperation("cancel", { path: event.target.value })} /></div></Form.Item>}
                {provider.cancel && provider.cancel.method !== "GET" && provider.cancel.method !== "DELETE" && <JsonField key={`${profile.model}:cancelbody`} label="取消请求体" value={provider.cancel.body || {}} onChange={body => patchOperation("cancel", { body })} help='例如 {"id":{"$ref":"taskId"}}。' />}
            </>}
            <Form.Item label="结果 URL 路径" className="mt-3" help="多条路径用逗号分隔；数组可用 data.*.url。仅在任务成功后下载并加入资产库。"><Input aria-label="结果路径" value={provider.response.resultUrlPaths?.join(", ")} onChange={event => patchProvider({ response: { ...provider.response, resultUrlPaths: splitPaths(event.target.value), resultKind: capability } })} /></Form.Item>
            <Form.Item label="Base64 结果路径（可选）" help="服务直接返回图片／视频数据时填写，例如 data.*.b64_json。"><Input aria-label="Base64 结果路径" value={provider.response.inlineBase64Paths?.join(", ")} onChange={event => patchProvider({ response: { ...provider.response, inlineBase64Paths: splitPaths(event.target.value), resultKind: capability } })} /></Form.Item>
            {Boolean(provider.response.inlineBase64Paths?.length) && <Form.Item label="Base64 文件类型"><Select value={provider.response.inlineMime || (capability === "image" ? "image/png" : "video/mp4")} options={(capability === "image" ? ["image/png", "image/jpeg", "image/webp"] : ["video/mp4", "video/webm"]).map(value => ({ value, label: value }))} onChange={inlineMime => patchProvider({ response: { ...provider.response, inlineMime } })} /></Form.Item>}
            <Checkbox checked={Boolean(provider.result)} onChange={event => patchProvider({ result: event.target.checked ? { method: "GET", path: "/tasks/{task_id}/content" } : undefined })}>结果需要从独立文件接口下载（使用当前渠道鉴权）</Checkbox>
            {provider.result && <Form.Item label="文件下载路径" className="mt-3"><Input aria-label="文件下载路径" value={provider.result.path} onChange={event => patchOperation("result", { path: event.target.value })} /></Form.Item>}
            <Form.Item label="错误说明路径"><Input value={provider.response.messagePaths?.join(", ")} onChange={event => patchProvider({ response: { ...provider.response, messagePaths: splitPaths(event.target.value) } })} placeholder="message, error.message" /></Form.Item>
        </Form>}
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

function ProviderFieldRows({ fields, onChange }: { fields: Record<string, string>; onChange: (fields: Record<string, string>) => void }) {
    const sources = [
        ["request.model", "模型 ID"], ["request.prompt", "提示词"], ["request.duration", "视频时长（数字）"], ["request.aspectRatio", "画面比例"], ["request.resolution", "分辨率"], ["request.extra.size", "原始尺寸值"], ["request.quality", "质量"], ["request.imageCount", "数量"], ["request.generateAudio", "生成音频"], ["request.watermark", "水印"], ["request.images", "参考图片对象数组"], ["request.videos", "参考视频对象数组"], ["request.audios", "参考音频对象数组"],
    ].map(([value, label]) => ({ value, label }));
    return <Form.Item label="参数映射" help="左侧填写供应商的字段名，右侧选择输入。更复杂的素材或类型转换可在下方 JSON 模板中配置。">
        <div className="space-y-2">{Object.entries(fields).map(([key, source], index) => <div key={index} className="flex gap-2">
            <Input aria-label={`上游字段 ${index + 1}`} value={key} placeholder="例如 prompt" onChange={event => { const entries = Object.entries(fields); entries[index] = [event.target.value, source]; onChange(Object.fromEntries(entries)); }} />
            <Select aria-label={`输入来源 ${index + 1}`} className="min-w-[190px]" showSearch value={source} options={sources} onChange={value => onChange({ ...fields, [key]: value })} />
            <Button aria-label={`移除参数 ${index + 1}`} onClick={() => onChange(Object.fromEntries(Object.entries(fields).filter(([name]) => name !== key)))}>移除</Button>
        </div>)}<Button size="small" onClick={() => { let name = "parameter"; for (let i = 2; Object.hasOwn(fields, name); i++) name = `parameter${i}`; onChange({ ...fields, [name]: "request.prompt" }); }}>添加参数</Button></div>
    </Form.Item>;
}

function JsonField({ label, value, onChange, help }: { label: string; value: unknown; onChange: (value: any) => void; help: string }) {
    const canonical = JSON.stringify(value, null, 2);
    const [edited, setEdited] = useState<string | null>(null);
    const [error, setError] = useState("");
    return <Form.Item label={label} help={error || help} validateStatus={error ? "error" : undefined}><Input.TextArea aria-label={label} autoSize={{ minRows: 2, maxRows: 12 }} value={edited ?? canonical} onChange={event => {
        setEdited(event.target.value);
        try { const next: unknown = JSON.parse(event.target.value); if (!next || typeof next !== "object") throw new Error("请填写 JSON 对象或数组"); onChange(next); setError(""); }
        catch (failure) { setError(failure instanceof Error ? failure.message : "JSON 格式不正确"); }
    }} onBlur={() => { if (!error) setEdited(null); }} /></Form.Item>;
}
