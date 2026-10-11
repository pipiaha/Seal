import { useEffect, useRef, useState } from "react";
import { Alert, Button, Checkbox, Form, Input, Select, Spin } from "antd";
import { Check, ChevronDown, RefreshCw, Search, Settings2, X } from "lucide-react";
import { AppModal } from "@/components/ui/product/app-modal";
import { ModelLogo } from "@/components/model-logo";
import { ChannelHeadersEditor, validateChannelHeaders } from "@/components/channel-headers-editor";
import { fetchChannelModels, type ChannelModelFetchResult } from "@/services/api/image-models";
import { fetchPluginProviderCatalog } from "@/services/api/plugin-catalog";
import { mergeFetchedChannelModelProfiles, type ChannelModelCatalogItem } from "@/lib/channel-model-catalog";
import { MODEL_SERVICE_PRESETS, modelServicePresetsFor, modelServicePresetConnection, modelCatalogRequestURL, serviceConnectionError, serviceModelProfile, servicePresetFor, type ModelServicePresetId } from "@/lib/model-service-presets";
import { channelModelsForCapability, mergeCategoryModelProfiles } from "@/lib/model-channel-settings";
import type { ModelProtocolDefinition } from "@/lib/model-protocols";
import { createModelChannel, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";
import { ChannelModelSettings } from "./channel-model-settings";
import { ConfiguredProviderEditor } from "./configured-provider-editor";
import "./model-service-editor.css";
import { configuredProfileError, defaultCustomProvider, type GenerationModelProfile } from "@/lib/configured-provider";
import { defaultModelCapabilityConfig } from "@/lib/model-capabilities";
import { previewProviderScript, providerScriptSample } from "@/services/api/configured-provider";

const labels: Record<ModelCapability, string> = { text: "文字", image: "图片", video: "视频", audio: "配音" };

export function ModelServiceEditor({ initial, capability = "text", onClose, onSave }: { initial?: ModelChannel; capability?: ModelCapability; onClose: () => void; onSave: (channel: ModelChannel) => Promise<void> }) {
    const [draft, setDraft] = useState<ModelChannel>(() => initial ? structuredClone(initial) : { ...createModelChannel(), name: "", baseUrl: "" });
    const [presetId, setPresetId] = useState<ModelServicePresetId>(() => initial ? servicePresetFor(initial) : "compatible");
    const [advanced, setAdvanced] = useState(() => (capability === "image" || capability === "video") && (!initial || servicePresetFor(initial) === "compatible"));
    const [catalog, setCatalog] = useState<ChannelModelCatalogItem[]>(() => (initial?.models || []).map((id) => ({ id })));
    const [protocols, setProtocols] = useState<ModelProtocolDefinition[]>([]);
    const [protocolLoading, setProtocolLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [query, setQuery] = useState("");
    const [manualName, setManualName] = useState("");
    const [editingCapabilities, setEditingCapabilities] = useState(false);
    const [interfaceModel, setInterfaceModel] = useState("");
    const [pendingInterface, setPendingInterface] = useState<GenerationModelProfile>(() => newCustomInterface(capability));
    const alive = useRef(true);

    useEffect(() => {
        alive.current = true;
        void fetchPluginProviderCatalog("user.custom-channel")
            .then((items) => { if (alive.current) setProtocols(items); })
            .catch(() => { if (alive.current) setError("无法读取协议目录，请关闭后重试"); })
            .finally(() => { if (alive.current) setProtocolLoading(false); });
        return () => { alive.current = false; };
    }, []);

    const patch = (value: Partial<ModelChannel>) => {
        setDraft((current) => ({ ...current, ...value }));
        setError("");
    };
    const choosePreset = (id: ModelServicePresetId) => {
        const preset = MODEL_SERVICE_PRESETS.find((item) => item.id === id)!;
        setPresetId(id);
        setAdvanced(id === "compatible" && (capability === "image" || capability === "video"));
        setInterfaceModel("");
        setPendingInterface(newCustomInterface(capability));
        const previous = MODEL_SERVICE_PRESETS.find((item) => item.id === presetId);
        const resetModels = !initial && id !== presetId;
        const seededModel = capability === "audio" ? preset.audioModel : id === "agnes" ? capability === "image" ? "agnes-image-2.5-flash" : "agnes-video-2.5-flash" : id === "comfyui" ? `comfyui-${capability}` : undefined;
        const seededProfiles = seededModel ? [{ ...serviceModelProfile({ ...draft, baseUrl: preset.baseUrl }, { id: seededModel, modelType: capability }, protocols, capability), protocol: preset.protocols[capability], ...(capability === "audio" ? { defaultOptions: { voice: "", ...(id === "xfyun-tts" ? { appId: "" } : {}) } } : {}) }] : [];
        if (resetModels) setCatalog(seededModel ? [{ id: seededModel, modelType: capability }] : []);
        patch({ ...modelServicePresetConnection(preset, capability), ...(resetModels ? { models: seededModel ? [seededModel] : [], modelProfiles: seededProfiles } : {}), ...(id !== presetId ? { apiKey: "", hasApiKey: false, secretKey: "", hasSecretKey: false, headers: [], authType: id === "comfyui" ? "none" : "bearer", authHeader: "" } : {}), name: !draft.name || draft.name === previous?.name ? id === "compatible" ? "" : preset.name : draft.name });
        if (id === "comfyui") setEditingCapabilities(true);
        setNotice("");
    };
    const validateConnection = () => {
        const problem = serviceConnectionError(draft) || validateChannelHeaders(draft.headers);
        if (problem) setError(problem);
        return !problem;
    };
    const applyCatalog = (result: ChannelModelFetchResult) => {
        const byId = new Map(catalog.map((item) => [item.id, item]));
        for (const item of result.catalog) byId.set(item.id, item);
        for (const id of result.models) if (!byId.has(id)) byId.set(id, { id });
        const next = [...byId.values()];
        const enriched = mergeFetchedChannelModelProfiles({ ...draft, modelProfiles: [] }, result.catalog);
        const existing = new Map((draft.modelProfiles || []).map((profile) => [profile.model, profile]));
        const profiles = next.map((item) => {
            const profile = serviceModelProfile(draft, item, protocols);
            const metadata = enriched.find((entry) => entry.model === item.id);
            return existing.has(item.id) ? existing.get(item.id)! : { ...profile, capabilityConfig: metadata?.capabilityConfig || profile.capabilityConfig };
        });
        setDraft((current) => ({ ...current, modelProfiles: mergeCategoryModelProfiles(current, profiles) }));
        setCatalog(next);
        setNotice(result.models.length ? `已读取 ${result.models.length} 个模型，仅展示${labels[capability]}模型。目录未标明类型的模型可在下方手动添加。` : "服务未返回模型，可以手动添加模型 ID。");
    };
    const fetchModels = async () => {
        if (!validateConnection()) return;
        setBusy(true); setError(""); setNotice("");
        try {
            const result = await fetchChannelModels(draft, true);
            if (alive.current) applyCatalog(result);
        } catch (failure) {
            if (alive.current) setError(failure instanceof Error ? failure.message : "读取模型失败，可手动添加模型 ID");
        } finally { if (alive.current) setBusy(false); }
    };
    const showModelSettings = (model: string) => {
        if (customMedia) { setAdvanced(true); setInterfaceModel(model); }
        else setEditingCapabilities(true);
    };
    const toggleModel = (id: string, enabled: boolean) => {
        const item = catalog.find((candidate) => candidate.id === id) || { id };
        const profile = serviceModelProfile(draft, item, protocols);
        setDraft((current) => ({ ...current, models: enabled ? [...new Set([...current.models, id])] : current.models.filter((model) => model !== id), modelProfiles: mergeCategoryModelProfiles(current, [profile]) }));
        if (enabled && !profile.protocol) { showModelSettings(id); setNotice("请为该模型选择实际请求协议，并按服务商要求配置输入与参数。"); }
        setError("");
    };
    const addManual = () => {
        const id = manualName.trim();
        if (!id) return;
        if (draft.models.includes(id)) { setError("这个模型已在渠道中，请管理已有模型"); return; }
        const item = { id, modelType: capability };
        const profile = customMedia ? { ...interfaceProfile, model: id, displayName: undefined } : serviceModelProfile(draft, item, protocols, capability);
        if (!profile.protocol) { setNotice("请为新模型选择服务商的实际请求协议。"); showModelSettings(id); }
        setCatalog((current) => current.some((entry) => entry.id === id) ? current.map((entry) => entry.id === id ? item : entry) : [...current, item]);
        setDraft((current) => ({ ...current, models: [...current.models, id], modelProfiles: mergeCategoryModelProfiles(current, [profile]) }));
        if (customMedia) setInterfaceModel(id);
        setManualName(""); setError("");
    };
    const save = async () => {
        if (!validateConnection()) return;
        if (!draft.name.trim()) { setError("请填写渠道名称"); return; }
        if (!draft.models.length) { setError("请至少选择或添加一个模型"); return; }
        const profiles = draft.models.map((id) => serviceModelProfile(draft, catalog.find((item) => item.id === id) || { id }, protocols));
        const missing = profiles.find((profile) => profile.capability === capability && !protocols.some((protocol) => protocol.value === profile.protocol && protocol.capability === capability && protocol.enabled !== false));
        if (missing) { setError(`${missing.model} 需要选择已安装的${labels[capability]}请求协议`); showModelSettings(missing.model); return; }
        for (const profile of profiles) { const problem = configuredProfileError(profile); if (problem) { setError(`${profile.model}：${problem}`); showModelSettings(profile.model); return; } }
        setBusy(true); setError("");
        try {
            for (const profile of profiles) {
                if (profile.protocol?.startsWith("custom-") && profile.customProvider?.script && (profile.capability === "image" || profile.capability === "video")) {
                    try {
                        const checked = await previewProviderScript(profile.customProvider.script, providerScriptSample(profile.capability, profile.model));
                        if (checked.valid !== true) throw new Error("运行端未确认脚本有效");
                    } catch (failure) {
                        showModelSettings(profile.model);
                        throw new Error(`${profile.model}：${failure instanceof Error ? failure.message : "接口脚本检查失败"}`);
                    }
                }
            }
            await onSave({ ...draft, name: draft.name.trim(), baseUrl: draft.baseUrl.trim().replace(/\/+$/, ""), apiKey: draft.apiKey.trim(), modelProfiles: mergeCategoryModelProfiles(draft, profiles) });
            onClose();
        } catch (failure) { setError(failure instanceof Error ? failure.message : "保存失败，请重试"); }
        finally { if (alive.current) setBusy(false); }
    };
    const visibleModels = catalog.filter((item) => serviceModelProfile(draft, item, protocols).capability === capability && `${item.id} ${item.displayName || ""}`.toLowerCase().includes(query.toLowerCase()));
    const selectedModels = channelModelsForCapability(draft, capability);
    const customMedia = presetId === "compatible" && (capability === "image" || capability === "video");
    const configuredModel = selectedModels.includes(interfaceModel) ? interfaceModel : selectedModels[0];
    const interfaceProfile = configuredModel ? draft.modelProfiles?.find(profile => profile.model === configuredModel) || serviceModelProfile(draft, catalog.find(item => item.id === configuredModel) || { id: configuredModel, modelType: capability }, protocols, capability) : pendingInterface;
    const updateInterface = (value: Partial<GenerationModelProfile>) => {
        if (!configuredModel) setPendingInterface(current => ({ ...current, ...value, model: "", capability }));
        else setDraft(current => ({ ...current, modelProfiles: mergeCategoryModelProfiles(current, [{ ...interfaceProfile, ...value, model: configuredModel, capability }]) }));
        setError("");
    };
    const otherModels = draft.models.length - selectedModels.length;
    const scopedChannel = { ...draft, models: selectedModels };
    const catalogURL = modelCatalogRequestURL(draft);
    const presets = modelServicePresetsFor(capability);
    const selectedPreset = MODEL_SERVICE_PRESETS.find((item) => item.id === presetId)!;
    const nativeSpeech = capability === "audio" && (presetId === "doubao-tts" || presetId === "xfyun-tts");
    const manualCatalog = draft.apiFormat === "claude" || selectedPreset.manualCatalog?.includes(capability);

    return <AppModal open centered width={760} flush footer={null} title={null} closable={false} keyboard={!busy} mask={{ closable: false }} onCancel={onClose} rootClassName="model-service-modal">
        <header className="model-service-header">
            <div><span className="model-service-eyebrow">{labels[capability]}渠道</span><h2>{initial ? "管理渠道" : "添加渠道"}</h2></div>
            <Button type="text" aria-label="关闭渠道配置" disabled={busy} icon={<X size={18} />} onClick={onClose} />
        </header>
        <div className="model-service-body" aria-busy={busy} inert={busy}>
            <Form layout="vertical" requiredMark={false} className="model-service-fields" disabled={busy} onFinish={() => void save()}>
                {!initial && <div className="model-service-presets" role="group" aria-label={`${labels[capability]}供应商预设`}><span>供应商预设</span><div>{presets.map((preset) => <button key={preset.id} type="button" aria-pressed={presetId === preset.id} onClick={() => choosePreset(preset.id)}><ModelLogo icon={preset.icon} size={17} color />{preset.name}{presetId === preset.id && <Check size={13} />}</button>)}</div></div>}
                <div className={nativeSpeech ? "model-service-field-grid" : undefined}>
                    <Form.Item label="渠道名称"><Input aria-label="渠道名称" placeholder={`例如：我的${labels[capability]}渠道`} value={draft.name} onChange={(event) => patch({ name: event.target.value })} /></Form.Item>
                    {nativeSpeech && <Form.Item label="接口类型"><Input aria-label="语音接口类型" readOnly value={presetId === "doubao-tts" ? "豆包原生语音 · HTTP SSE" : "讯飞在线合成 · WebSocket"} /></Form.Item>}
                </div>
                {selectedPreset.connections && <Form.Item label="服务站点" extra="选择创建 API Key 的站点；国内站与国际站的密钥不应混用。"><Select aria-label="服务站点" placeholder="按供应商提供的地址选择" value={selectedPreset.connections.find(connection => connection.value === draft.baseUrl.replace(/\/$/, ""))?.value} options={selectedPreset.connections} onChange={baseUrl => patch({ baseUrl })} /></Form.Item>}
                <Form.Item label="服务地址"><Input aria-label="服务地址" inputMode="url" placeholder="https://api.example.com/v1" value={draft.baseUrl} onChange={(event) => patch({ baseUrl: event.target.value })} /></Form.Item>
                <Form.Item label="鉴权方式"><Select aria-label="鉴权方式" value={draft.authType || "bearer"} options={[{ value: "bearer", label: "API Key / Bearer" }, { value: "header", label: "指定请求头" }, { value: "none", label: "无需鉴权（本地服务）" }]} onChange={authType => patch({ authType })} /></Form.Item>
                {draft.authType === "header" && <Form.Item label="鉴权请求头名称"><Input aria-label="鉴权请求头名称" placeholder="X-API-Key" value={draft.authHeader || ""} onChange={event => patch({ authHeader: event.target.value })} /></Form.Item>}
                {draft.authType !== "none" && <Form.Item label="API Key"><Input.Password aria-label="API Key" autoComplete="new-password" placeholder={draft.hasApiKey ? "已保存密钥，留空保留" : "填写服务商提供的 API Key"} value={draft.apiKey} onChange={(event) => patch({ apiKey: event.target.value })} /></Form.Item>}
                {capability === "audio" && draft.modelProfiles?.some((profile) => profile.protocol === "xfyun-tts") && <Form.Item label="API Secret"><Input.Password aria-label="讯飞 API Secret" autoComplete="new-password" placeholder={draft.hasSecretKey ? "已保存，留空保留" : "在线语音合成服务的 API Secret"} value={draft.secretKey || ""} onChange={(event) => patch({ secretKey: event.target.value })} /></Form.Item>}
            </Form>
            <section className="model-service-settings" aria-label="渠道高级设置">
                <button type="button" className="model-service-advanced" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}><Settings2 size={14} />高级设置<ChevronDown size={14} /></button>
                {advanced && <>
                {customMedia && <section className="model-service-interface" aria-label="自定义服务接口配置">
                    <p className="model-service-contract-note">按服务商文档配置接口，然后添加模型 ID。</p>
                    <Form layout="vertical" requiredMark={false} disabled={busy}>
                        {selectedModels.length > 0 && <Form.Item label="配置模型"><Select aria-label="配置模型" value={configuredModel} options={selectedModels.map(model => ({ value: model, label: model }))} onChange={setInterfaceModel} /></Form.Item>}
                        <Form.Item label="调用方式"><Select aria-label="自定义服务调用方式" loading={protocolLoading} value={interfaceProfile.protocol || undefined} placeholder="选择服务商使用的调用协议" options={protocols.filter(item => item.capability === capability && item.enabled !== false && !item.value.startsWith("comfyui-")).map(item => ({ value: item.value, label: item.label }))} onChange={protocol => updateInterface({ protocol, ...(protocol.startsWith("custom-") ? { customProvider: interfaceProfile.customProvider || defaultCustomProvider(capability === "video" ? "video" : "image") } : {}), ...(protocol !== interfaceProfile.protocol ? { capabilityConfig: defaultModelCapabilityConfig(protocol, interfaceProfile.model) } : {}) })} /></Form.Item>
                    </Form>
                    <ConfiguredProviderEditor key={`${configuredModel || "new"}:${interfaceProfile.protocol}`} channel={draft} profile={interfaceProfile} onChange={updateInterface} />
                    {configuredModel && <ChannelModelSettings draft capabilitiesOnly channel={{ ...draft, models: [configuredModel] }} onChange={profiles => setDraft(current => ({ ...current, modelProfiles: mergeCategoryModelProfiles(current, profiles) }))} />}
                </section>}
                <details className="model-service-connection-options"><summary>附加连接参数</summary><Form layout="vertical" requiredMark={false} disabled={busy} className="model-service-advanced-fields">
                    {!nativeSpeech && <Form.Item label="模型目录格式"><Select aria-label="模型目录格式" value={draft.apiFormat} options={[{ value: "openai", label: "OpenAI 兼容" }, { value: "gemini", label: "Gemini 原生" }, { value: "claude", label: "Anthropic（手动添加模型）" }]} onChange={apiFormat => patch({ apiFormat })} /></Form.Item>}
                    <Form.Item label="素材服务地址（可选）" help="服务使用独立素材域名时填写 HTTPS 域名。"><Input aria-label="素材服务地址" value={draft.referenceAssetOrigin || ""} onChange={event => patch({ referenceAssetOrigin: event.target.value })} /></Form.Item>
                    {!draft.modelProfiles?.some(profile => profile.protocol === "xfyun-tts") && <Form.Item label="Secret Key（按需填写）"><Input.Password aria-label="Secret Key" autoComplete="new-password" value={draft.secretKey || ""} placeholder={draft.hasSecretKey ? "已保存密钥，留空保留" : "AK/SK 鉴权时填写"} onChange={event => patch({ secretKey: event.target.value })} /></Form.Item>}
                    <ChannelHeadersEditor value={draft.headers} onChange={headers => patch({ headers })} />
                    {catalogURL && <div className="model-service-url"><span>模型目录地址</span><code>{catalogURL}</code></div>}
                </Form></details>
                </>}
            </section>
            <section className="model-service-models">
                <div className="model-service-catalog-header"><h3>模型</h3><Button size="small" icon={<RefreshCw size={14} />} loading={busy} disabled={protocolLoading || Boolean(manualCatalog)} onClick={() => void fetchModels()}>读取模型</Button></div>
                {manualCatalog && <p className="model-service-contract-note">{presetId === "comfyui" ? "点击下方「模型协议与参数 → 配置使用」，导入 API 工作流。不同工作流可以作为不同模型添加。" : nativeSpeech ? "已加入对应的语音服务，请在下方配置应用信息和音色。此服务无需读取模型目录。" : "此预设使用手动模型 ID，请填写服务商控制台提供的模型名称。未调用不适用的模型目录接口。"}</p>}
                {capability === "video" && !customMedia && <p className="model-service-contract-note">目录格式只负责读取模型。每个视频模型独立选择请求协议；图片、视频、音频引用与输出规格按模型分别配置。</p>}
                {otherModels > 0 && <p className="model-service-contract-note">该连接还包含 {otherModels} 个其他类型模型，会保留原有配置；连接信息和渠道启停由各类型共用。</p>}
                <Input aria-label="搜索模型" prefix={<Search size={15} />} placeholder={`搜索${labels[capability]}模型`} value={query} onChange={(event) => setQuery(event.target.value)} allowClear />
                <div className="model-service-catalog">
                    {protocolLoading ? <Spin size="small" /> : visibleModels.length ? visibleModels.map((item) => {
                        const profile = serviceModelProfile(draft, item, protocols);
                        const protocol = protocols.find((entry) => entry.value === profile.protocol);
                        return <label key={item.id} className="model-service-model"><Checkbox disabled={busy} checked={draft.models.includes(item.id)} onChange={(event) => toggleModel(item.id, event.target.checked)} /><span><strong>{profile.displayName || item.displayName || item.id}</strong><small>{profile.displayName || item.displayName ? item.id : protocol?.label || "需要配置请求协议"}</small></span>{draft.models.includes(item.id) && !profile.protocol && <small>待配置协议</small>}</label>;
                    }) : <div className="model-service-empty"><strong>{query ? "没有匹配的模型" : `添加${labels[capability]}模型`}</strong><p>读取目录，或手动输入模型 ID。</p></div>}
                </div>
                <div className="model-service-manual"><Input aria-label="模型 ID" placeholder={`手动输入${labels[capability]}模型 ID`} value={manualName} onChange={(event) => setManualName(event.target.value)} onPressEnter={addManual} /><Button disabled={busy || protocolLoading || !manualName.trim()} onClick={addManual}>添加</Button></div>
                {capability === "audio" && draft.modelProfiles?.filter((profile) => draft.models.includes(profile.model) && (profile.protocol === "doubao-tts" || profile.protocol === "xfyun-tts")).map((profile) => <div className="model-service-native-speech" key={profile.model}>
                    <h3>{profile.protocol === "doubao-tts" ? "豆包语音配置" : "讯飞语音配置"} · {profile.model}</h3>
                    <p className="model-service-contract-note">{profile.protocol === "doubao-tts" ? "使用语音控制台的 API Key，音色需与资源 ID 匹配；方舟模型的 API Key 不能替代语音凭证。" : "填写在线语音合成（流式版）的 APPID、API Key 和 API Secret，发音人需在控制台开通。"}当前输出 MP3。</p>
                    {profile.protocol === "xfyun-tts" && <Form.Item label="APPID"><Input aria-label={`讯飞 APPID ${profile.model}`} value={String(profile.defaultOptions?.appId || "")} onChange={(event) => patch({ modelProfiles: mergeCategoryModelProfiles(draft, [{ ...profile, defaultOptions: { ...profile.defaultOptions, appId: event.target.value } }]) })} /></Form.Item>}
                    <Form.Item label={profile.protocol === "doubao-tts" ? "音色 ID" : "发音人 ID"}><Input aria-label={`语音音色 ID ${profile.model}`} placeholder="填写服务商控制台中的 ID" value={String(profile.defaultOptions?.voice || "")} onChange={(event) => patch({ modelProfiles: mergeCategoryModelProfiles(draft, [{ ...profile, defaultOptions: { ...profile.defaultOptions, voice: event.target.value } }]) })} /></Form.Item>
                </div>)}
                {!customMedia && selectedModels.length > 0 && <><button type="button" className="model-service-advanced" aria-expanded={editingCapabilities} onClick={() => setEditingCapabilities(!editingCapabilities)}><Settings2 size={14} />{capability === "video" ? "视频模型协议、输入与输出参数" : "模型协议与参数"}<ChevronDown size={14} /></button>{editingCapabilities && <ChannelModelSettings draft channel={scopedChannel} onChange={(profiles) => setDraft((current) => ({ ...current, modelProfiles: mergeCategoryModelProfiles(current, profiles) }))} />}</>}
            </section>
            {(error || notice) && <div className="model-service-feedback">{error && <Alert type="error" showIcon title={error} />}{notice && <Alert type="info" showIcon title={notice} />}</div>}
        </div>
        <footer className="model-service-footer"><span>更改保存到当前工作区</span><div><Button disabled={busy} onClick={onClose}>取消</Button><Button type="primary" loading={busy} disabled={!draft.models.length || protocolLoading} icon={<Check size={14} />} onClick={() => void save()}>保存</Button></div></footer>
    </AppModal>;
}

function newCustomInterface(capability: ModelCapability): GenerationModelProfile {
    return { model: "", capability, protocol: capability === "image" || capability === "video" ? `custom-${capability}` : "", ...(capability === "image" || capability === "video" ? { customProvider: defaultCustomProvider(capability), capabilityConfig: defaultModelCapabilityConfig(`custom-${capability}`, "") } : {}) };
}
