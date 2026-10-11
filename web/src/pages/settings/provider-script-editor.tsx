import { useEffect, useRef, useState } from "react";
import { Alert, Button, Form, Input, InputNumber, Select } from "antd";
import { javascript } from "@codemirror/lang-javascript";
import copy from "copy-to-clipboard";
import { Clipboard, Eye } from "lucide-react";
import { PromptCodeEditor, type PromptCodeEditorHandle } from "@/components/prompt/prompt-code-editor";
import { PROVIDER_SCRIPT_VARIABLES, providerToScript, providerScriptTemplate, providerScriptAuthoringPrompt } from "@/lib/provider-script";
import type { CustomProvider } from "@/lib/configured-provider";
import { previewProviderScript, providerScriptSample } from "@/services/api/configured-provider";

const extensions = [javascript()];

export function ProviderScriptEditor({ provider, capability, model, baseUrl, onChange }: { provider: CustomProvider; capability: "image" | "video"; model: string; baseUrl: string; onChange: (provider: CustomProvider) => void }) {
    const editor = useRef<PromptCodeEditorHandle>(null);
    const previewVersion = useRef(0);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [preview, setPreview] = useState<unknown>();
    const [prompt, setPrompt] = useState("生成一段小狗游泳的视频");
    const [seconds, setSeconds] = useState(5);
    const [imageUrls, setImageUrls] = useState("https://example.com/image.png");
    const [videoUrls, setVideoUrls] = useState("https://example.com/video.mp4");
    const [response, setResponse] = useState("");
    let source = "", conversionError = "";
    try { source = providerToScript(provider); } catch (failure) { conversionError = failure instanceof Error ? failure.message : "无法读取已有配置"; }
    useEffect(() => {
        previewVersion.current += 1;
        setPreview(undefined); setError(""); setNotice(""); setBusy(false);
    }, [source, model, capability]);
    const updateSource = (script: string) => { onChange({ ...provider, script }); setError(""); setNotice(""); setPreview(undefined); };
    const check = async () => {
        const version = ++previewVersion.current;
        setBusy(true); setError(""); setPreview(undefined);
        try {
            const refs = (text: string, kind: string) => text.split(/\r?\n/).map(url => url.trim()).filter(Boolean).map(url => ({ url, kind }));
            const request = { ...providerScriptSample(capability, model), prompt, duration: seconds, images: refs(imageUrls, "image"), videos: refs(videoUrls, "video") };
            const result = await previewProviderScript(source, request, response.trim() ? JSON.parse(response) : undefined);
            if (result.valid !== true) throw new Error("运行端未确认接口配置有效");
            if (version === previewVersion.current) setPreview(result);
        } catch (failure) { if (version === previewVersion.current) setError(failure instanceof Error ? failure.message : "接口预览失败"); }
        finally { if (version === previewVersion.current) setBusy(false); }
    };

    return <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
            <Select<"default" | "array" | "multipart"> aria-label="接口脚本模板" placeholder="选择模板" className="min-w-40" disabled={busy} value={undefined} options={[{ value: "default", label: capability === "image" ? "同步图片生成" : "异步视频生成" }, { value: "array", label: "数组与嵌套参数" }, { value: "multipart", label: "Multipart 文件上传" }]} onChange={kind => updateSource(providerScriptTemplate(capability, kind))} />
            <Select<string> aria-label="插入接口变量" placeholder="插入变量" className="min-w-44" disabled={busy} value={undefined} options={PROVIDER_SCRIPT_VARIABLES.map(([value, label]) => ({ value, label: `${label} · ${value}` }))} onChange={value => editor.current?.insertText(value)} />
            <Button size="small" icon={<Clipboard size={14} />} disabled={busy} onClick={async () => {
                if (await copy(providerScriptAuthoringPrompt(model, capability, baseUrl))) setNotice("配置说明已复制。把它和供应商 API 文档发给 Seal 创作助手，可让助手检查并直接保存渠道。");
                else setError("复制失败，请检查剪贴板权限");
            }}>复制给助手的配置说明</Button>
        </div>
        <div className="text-xs text-foreground/55">JavaScript 接口配置：直接组织数组和嵌套参数；提交、查询和下载由 Seal 执行。</div>
        <div className="text-xs text-foreground/55">也可以把接口文档、服务地址、模型 ID 和 API Key 一起发给创作助手，让它配置并保存，不需要复制代码或再次填写密钥。</div>
        <div className="h-[360px] overflow-hidden rounded-md border border-border bg-background">
            <PromptCodeEditor ref={editor} value={source} onChange={updateSource} extensions={extensions} readOnly={busy} ariaLabel="JavaScript 接口配置" />
        </div>
        <details className="text-xs text-foreground/60"><summary className="cursor-pointer">变量和结果说明</summary>
            <p className="mt-2 leading-6">images、videos、audios 是链接数组；request.images / videos / audios 是完整素材对象。body 可以使用数组、map 和条件表达式。response 中的 taskId、status、result、error、message 可以写字段路径或同步函数。任务地址可用 /tasks/&#123;task_id&#125;；API Key 可在渠道设置填写或交给助手保存，请求头值在渠道设置填写，都不写入脚本。</p>
        </details>
        <details className="text-xs text-foreground/60"><summary className="cursor-pointer">预览示例输入（不会生成或计费）</summary>
            <Form layout="vertical" requiredMark={false} disabled={busy} className="mt-3">
                <Form.Item label="示例提示词"><Input.TextArea aria-label="脚本示例提示词" value={prompt} onChange={event => { setPrompt(event.target.value); setPreview(undefined); }} /></Form.Item>
                {capability === "video" && <Form.Item label="示例时长（秒）"><InputNumber aria-label="脚本示例时长" min={1} max={3600} value={seconds} onChange={value => { setSeconds(value ?? 5); setPreview(undefined); }} /></Form.Item>}
                <Form.Item label="示例图片链接（每行一条）"><Input.TextArea aria-label="脚本示例图片" value={imageUrls} onChange={event => { setImageUrls(event.target.value); setPreview(undefined); }} /></Form.Item>
                <Form.Item label="示例视频链接（每行一条）"><Input.TextArea aria-label="脚本示例视频" value={videoUrls} onChange={event => { setVideoUrls(event.target.value); setPreview(undefined); }} /></Form.Item>
                <Form.Item label="供应商响应 JSON（可选，用于检查提取规则）"><Input.TextArea aria-label="脚本示例响应" value={response} placeholder={'{"id":"example-task","status":"completed","url":"https://example.com/result.mp4"}'} autoSize={{ minRows: 2, maxRows: 8 }} onChange={event => { setResponse(event.target.value); setPreview(undefined); }} /></Form.Item>
            </Form>
        </details>
        <Button icon={<Eye size={14} />} loading={busy} disabled={!source.trim() || Boolean(conversionError)} onClick={() => void check()}>检查并预览请求</Button>
        {preview !== undefined && <div className="space-y-2"><p className="text-xs text-foreground/55">检查通过。以下使用示例输入；鉴权由渠道设置提供，尚未发送给供应商。</p><pre aria-label="接口请求预览" className="max-h-80 overflow-auto rounded-md border border-border bg-background p-3 text-xs whitespace-pre-wrap break-all">{JSON.stringify(preview, null, 2)}</pre></div>}
        {(error || conversionError) && <Alert type="error" showIcon title={error || conversionError} />}
        {notice && <Alert type="info" title={notice} />}
    </div>;
}
