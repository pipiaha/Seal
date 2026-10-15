import { useEffect, useRef, useState } from "react";
import { Alert, Button, Form, Input, InputNumber, Select } from "antd";
import { Braces, Download, RefreshCw, Upload } from "lucide-react";
import { WorkflowGraphEditor } from "@/components/workflow-graph-editor";
import { normalizeWorkflowFieldMappings, type ModelChannel } from "@/stores/use-config-store";
import { workflowVideoFieldsFromJson } from "@/lib/model-capabilities";
import { defaultCustomProvider, exportModelRecipe, importModelRecipe, parseComfyGraph, type GenerationModelProfile } from "@/lib/configured-provider";
import { ProviderScriptEditor } from "./provider-script-editor";
import { comfyBasicInputs, comfyModelInputs, comfyModelLabel, enrichComfyFields, selectComfyModel, updateComfyScalar } from "@/lib/comfyui-model-selection";
import { useComfyUIConnection, type ComfyUIConnection } from "./use-comfyui-connection";

export function ConfiguredProviderEditor({ channel, profile, onChange, comfyConnection, onJSONEditingChange }: { channel: ModelChannel; profile: GenerationModelProfile; onChange: (patch: Partial<GenerationModelProfile>) => void; comfyConnection?: ComfyUIConnection; onJSONEditingChange?: (editing: boolean) => void }) {
    const [error, setError] = useState("");
    const ownConnection = useComfyUIConnection(channel);
    const connection = comfyConnection || ownConnection;
    const { nodes, checking, checkedAt: refreshedAt } = connection;
    const [advanced, setAdvanced] = useState(false);
    const [filename, setFilename] = useState("");
    const [jsonEditor, setJsonEditor] = useState<"paste" | "edit" | null>(null);
    const [jsonText, setJsonText] = useState("");
    const [jsonError, setJsonError] = useState("");
    useEffect(() => {
        onJSONEditingChange?.(jsonEditor !== null);
        return () => onJSONEditingChange?.(false);
    }, [jsonEditor, onJSONEditingChange]);
    const fileInput = useRef<HTMLInputElement>(null);
    const workflowInput = useRef<HTMLInputElement>(null);
    const custom = profile.protocol?.startsWith("custom-");
    const comfy = profile.protocol?.startsWith("comfyui-");
    if (!custom && !comfy) return null;
    const capability = profile.capability === "video" ? "video" : "image";
    const provider = profile.customProvider || defaultCustomProvider(capability);
    const applyWorkflow = (text: string, sourceName: string, preserveBindings = false) => {
        if (new Blob([text]).size > 2 * 1024 * 1024) throw new Error("工作流内容不能超过 2 MB");
        let graph: Record<string, unknown>;
        try { graph = parseComfyGraph(text); }
        catch (failure) {
            if (failure instanceof SyntaxError) throw new Error("JSON 格式不正确，请检查引号、逗号和括号");
            throw failure;
        }
        const output = Object.entries(graph).filter(([, raw]) => capability === "image" ? /SaveImage/i.test(String((raw as Record<string, unknown>).class_type)) : /VideoCombine|SaveVideo|SaveAnimated/i.test(String((raw as Record<string, unknown>).class_type)));
        const fields = normalizeWorkflowFieldMappings(workflowVideoFieldsFromJson(graph), capability);
        const promptFields = fields.filter(field => field.source === "prompt" && !/negative|负向/i.test(JSON.stringify((graph[field.nodeId] as Record<string, unknown>)._meta || {})));
        const positiveIds = new Set(Object.values(graph).flatMap(raw => { const positive = ((raw as Record<string, unknown>).inputs as Record<string, unknown>).positive; return Array.isArray(positive) ? [String(positive[0])] : []; }));
        const positiveFields = promptFields.filter(field => positiveIds.has(field.nodeId));
        const chosen = positiveFields.length === 1 ? positiveFields[0] : promptFields.length === 1 ? promptFields[0] : undefined;
        for (const field of fields) if (field.source === "prompt") field.enabled = field === chosen;
        const previousFlow = preserveBindings ? profile.comfyui : undefined;
        const nextFields = fields.map(field => {
            const previous = previousFlow?.fields.find(item => item.nodeId === field.nodeId && item.fieldName === field.fieldName && item.classType === field.classType);
            if (!previous || !previousFlow) return field;
            const previousValue = ((previousFlow.graph[field.nodeId] as Record<string, unknown>)?.inputs as Record<string, unknown> | undefined)?.[field.fieldName];
            return { ...field, ...previous, fieldValue: previousValue === field.fieldValue ? previous.fieldValue ?? field.fieldValue : field.fieldValue };
        });
        const keepOutput = previousFlow && graph[previousFlow.outputNodeId] && (graph[previousFlow.outputNodeId] as Record<string, unknown>).class_type === (previousFlow.graph[previousFlow.outputNodeId] as Record<string, unknown>).class_type;
        const outputClass = output.length === 1 ? String((output[0][1] as Record<string, unknown>).class_type) : "";
        onChange({ comfyui: { graph, fields: nextFields, outputNodeId: keepOutput ? previousFlow.outputNodeId : output.length === 1 ? output[0][0] : "", outputField: keepOutput ? previousFlow.outputField : capability === "image" ? "images" : /SaveVideo/i.test(outputClass) ? "videos" : "gifs" } });
        setFilename(sourceName); setError(""); setJsonError(""); setJsonEditor(null);
        if (!preserveBindings) setAdvanced(false);
        if (!nodes && !checking) void connection.check();
    };
    const openJSON = (mode: "paste" | "edit") => {
        setJsonText(mode === "edit" && profile.comfyui ? JSON.stringify(profile.comfyui.graph, null, 2) : "");
        setJsonError(""); setJsonEditor(mode);
    };
    const readFile = async (file: File, workflow: boolean) => {
        try {
            if (file.size > 2 * 1024 * 1024) throw new Error("配置文件不能超过 2 MB");
            const text = await file.text();
            if (!workflow && /\.js$/i.test(file.name)) onChange({ protocol: `custom-${capability}`, customProvider: { ...defaultCustomProvider(capability), script: text } });
            else if (!workflow) onChange(importModelRecipe(text, capability));
            else applyWorkflow(text, file.name);
            setError("");
        } catch (failure) { setError(failure instanceof Error ? failure.message : "导入失败"); }
    };
    const exportRecipe = () => {
        try {
            const blob = new Blob([exportModelRecipe({ ...profile, ...(custom ? { customProvider: provider } : {}) })], { type: "application/json" });
            const url = URL.createObjectURL(blob); const link = document.createElement("a");
            link.href = url; link.download = `seal-${capability}-recipe.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setError("");
        } catch (failure) { setError(failure instanceof Error ? failure.message : "导出失败"); }
    };
    const flow = profile.comfyui;
    const modelInputs = flow && nodes ? comfyModelInputs(flow, nodes) : [];
    const basicInputs = flow ? comfyBasicInputs(flow, nodes) : [];
    const missingModels = modelInputs.filter(input => !input.choices.includes(input.value));
    const missing = nodes && flow ? [...new Set(Object.values(flow.graph).map(raw => String((raw as Record<string, unknown>).class_type)))].filter(name => !nodes[name]) : [];
    return <div className="space-y-4">
        {custom && <><div className="flex flex-wrap gap-2"><Button size="small" icon={<Upload size={14} />} onClick={() => fileInput.current?.click()}>导入接口配置</Button><Button size="small" icon={<Download size={14} />} onClick={exportRecipe}>导出接口配置</Button></div>
        <input hidden ref={fileInput} type="file" accept=".json,.js,application/json,text/javascript" onChange={event => { const file = event.target.files?.[0]; if (file) void readFile(file, false); event.target.value = ""; }} />
        <p className="text-xs text-foreground/50">配置保存在模型中。导出不包含渠道密钥和请求头；密钥请填写在渠道连接设置。</p></>}
        {custom && <ProviderScriptEditor provider={provider} capability={capability} model={profile.model} onChange={customProvider => onChange({ customProvider })} />}
        {comfy && <>
            <div className={`comfy-workflow-import${flow ? "" : " is-empty"}`}><div>{flow ? <strong>{filename || "工作流已就绪"}</strong> : <p>导入 ComfyUI 工作流文件，或直接粘贴 API 格式 JSON。</p>}</div><div className="comfy-workflow-source-actions"><Button type={flow ? "default" : "primary"} icon={<Upload size={14} />} onClick={() => workflowInput.current?.click()}>{flow ? "更换文件" : "导入文件"}</Button><Button icon={<Braces size={14} />} onClick={() => openJSON("paste")}>粘贴 JSON</Button></div></div>
            <input hidden ref={workflowInput} type="file" accept=".json,application/json" onChange={event => { const file = event.target.files?.[0]; if (file) void readFile(file, true); event.target.value = ""; }} />
            {jsonEditor && <section className="comfy-json-editor" aria-label="工作流 JSON 编辑器">
                <label htmlFor={`comfy-json-${profile.model}`}>{jsonEditor === "edit" ? "编辑工作流 JSON" : "粘贴或编写工作流 JSON"}</label>
                <Input.TextArea id={`comfy-json-${profile.model}`} aria-label="工作流 JSON" spellCheck={false} autoSize={{ minRows: 9, maxRows: 20 }} value={jsonText} placeholder={'{\n  "1": {\n    "class_type": "…",\n    "inputs": {}\n  }\n}'} onChange={event => { setJsonText(event.target.value); setJsonError(""); }} />
                <p>应用后仍需保存渠道。{flow && jsonEditor === "paste" ? "粘贴新的 JSON 会替换当前工作流。" : ""}</p>
                {jsonError && <Alert type="error" showIcon title={jsonError} />}
                <div><Button onClick={() => { setJsonEditor(null); setJsonError(""); }}>取消编辑</Button><Button type="primary" disabled={!jsonText.trim()} onClick={() => { try { applyWorkflow(jsonText, jsonEditor === "edit" ? "工作流 JSON 已更新" : "来自 JSON", jsonEditor === "edit"); } catch (failure) { setJsonError(failure instanceof Error ? failure.message : "工作流 JSON 无效"); } }}>检查并应用</Button></div>
            </section>}
            {flow && <>
                <Form layout="vertical" requiredMark={false}><Form.Item label="名称"><Input aria-label="当前工作流名称" value={profile.displayName || ""} placeholder="例如：产品视频生成" onChange={event => onChange({ displayName: event.target.value })} /></Form.Item></Form>
                {!flow.fields.some(field => field.enabled !== false && field.source === "prompt") && <Form layout="vertical" requiredMark={false}><Form.Item label="提示词输入" extra="请指定生成时使用的正向提示词。"><Select aria-label="工作流提示词输入" placeholder="选择正向提示词" options={flow.fields.filter(field => field.source === "prompt" || /^(text|prompt|positive_prompt)$/i.test(field.fieldName)).map(field => ({ value: `${field.nodeId}:${field.fieldName}`, label: `${field.label || "文本输入"} · ${field.nodeId}` }))} onChange={value => onChange({ comfyui: { ...flow, fields: flow.fields.map(field => `${field.nodeId}:${field.fieldName}` === value ? { ...field, source: "prompt", enabled: true, role: "prompt" } : field.source === "prompt" ? { ...field, enabled: false } : field) } })} /></Form.Item></Form>}
                <div className="comfy-section-heading"><h4>模型</h4><Button size="small" type="text" icon={<RefreshCw size={13} />} loading={checking} onClick={() => void connection.check()}>刷新本机模型</Button></div>
                {!nodes && <p className="model-service-contract-note">测试连接后，会显示这份工作流可用的本机模型。</p>}
                {nodes && <Form layout="vertical" requiredMark={false}>
                    {modelInputs.map(input => <Form.Item key={`${input.nodeId}:${input.fieldName}`} label={`${comfyModelLabel(input.fieldName)}${modelInputs.filter(item => comfyModelLabel(item.fieldName) === comfyModelLabel(input.fieldName)).length > 1 ? ` · ${input.nodeId}` : ""}`} extra={!input.choices.includes(input.value) ? `本机未找到 ${input.value || "对应模型"}，请选择兼容文件` : undefined}>
                        <Select aria-label={`本机模型 ${input.nodeId} ${input.fieldName}`} showSearch optionFilterProp="label" status={input.choices.includes(input.value) ? undefined : "warning"} value={input.value || undefined} disabled={checking || !input.choices.length} placeholder="该节点没有可用模型" options={input.choices.map(value => ({ value, label: value }))} onChange={value => onChange({ comfyui: selectComfyModel(flow, nodes, input.nodeId, input.fieldName, value) })} />
                    </Form.Item>)}
                    {!modelInputs.length && <p className="text-xs text-foreground/50">工作流未提供模型选项，沿用已导入的设置。</p>}
                </Form>}
                {missingModels.length > 0 && <Alert type="warning" title="工作流包含本机未找到的模型" description="请安装缺失模型或选择兼容文件；切换模型架构时需使用匹配的工作流。" />}
                {basicInputs.length > 0 && <section className="comfy-basic-parameters"><h4>常用参数</h4><div>{basicInputs.map(input => <label key={`${input.nodeId}:${input.fieldName}`}><span>{input.label}{basicInputs.filter(item => item.label === input.label).length > 1 ? ` · ${input.nodeId}` : ""}</span><InputNumber aria-label={`工作流参数 ${input.nodeId} ${input.fieldName}`} value={input.value} min={input.min} max={input.max} step={input.step} onChange={value => { if (value !== null) onChange({ comfyui: updateComfyScalar(flow, input.nodeId, input.fieldName, value) }); }} /></label>)}</div></section>}
                {!flow.outputNodeId && <Alert type="warning" title="请选择最终输出" description="在高级设置中选择保存图片或视频的输出节点。" action={<Button size="small" onClick={() => setAdvanced(true)}>选择输出</Button>} />}
                <button type="button" className="model-service-advanced" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>高级设置 · 节点与字段绑定</button>
                {advanced && <div className="comfy-workflow-advanced">
                <Button icon={<Braces size={14} />} onClick={() => openJSON("edit")}>编辑 JSON</Button>
                <Form layout="vertical"><Form.Item label="最终输出节点"><Select aria-label="输出节点" value={flow.outputNodeId || undefined} placeholder="选择保存图片／视频的节点" options={Object.entries(flow.graph).map(([id, raw]) => ({ value: id, label: `${id} · ${String((raw as Record<string, unknown>).class_type)}` }))} onChange={outputNodeId => onChange({ comfyui: { ...flow, outputNodeId } })} /></Form.Item>
                    <Form.Item label="输出字段"><Select value={flow.outputField} options={(capability === "image" ? ["images"] : ["gifs", "videos"]).map(value => ({ value, label: value === "gifs" ? "gifs（VHS 视频输出）" : value }))} onChange={outputField => onChange({ comfyui: { ...flow, outputField } })} /></Form.Item></Form>
                <WorkflowGraphEditor workflowJson={flow.graph} fields={nodes ? enrichComfyFields(flow, nodes) : flow.fields} onChange={fields => onChange({ comfyui: { ...flow, fields } })} />
                </div>}
            </>}
            {!comfyConnection && connection.error && <Alert type="error" title={connection.error} />}{missing.length > 0 && <Alert type="warning" title={`缺少节点：${missing.join("、")}`} />}
            {refreshedAt && <p className="text-xs text-foreground/50">本机列表更新于 {new Date(refreshedAt).toLocaleString()} · 安装新模型后可再次刷新</p>}
        </>}
        {error && <Alert type="error" showIcon title={error} />}
    </div>;
}
