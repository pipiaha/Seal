import { beforeAll, afterAll, expect, test } from "bun:test";
import { chromium, type Browser } from "playwright";

let browser: Browser;
let server: ReturnType<typeof Bun.serve>;
beforeAll(async () => {
    const build = await Bun.build({
        entrypoints: [import.meta.dir + "/fixtures/model-discovery-harness.tsx"], target: "browser",
        define: { "import.meta.env.DEV": "false", "import.meta.env.PROD": "true", "import.meta.env.MODE": '"production"', "import.meta.env.VITE_CANVAS_LOCAL_MODE": '"true"', "import.meta.env.VITE_CANVAS_BACKEND_URL": '"/api"', "process.env.NODE_ENV": '"production"', __APP_VERSION__: '"test"', __APP_CHANGELOG__: '""', __BEEFTV_HEAVY_MEDIA_ENABLED__: "false" },
        plugins: [{ name: "source-alias", setup(builder) { builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync("../src/" + args.path.slice(2), import.meta.dir) })); } }],
    });
    if (!build.success) throw new Error(build.logs.join("\n"));
    const js = await build.outputs.find(output => output.path.endsWith(".js"))!.text();
    const css = await build.outputs.find(output => output.path.endsWith(".css"))?.text() || "";
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/app.js") return new Response(js, { headers: { "Content-Type": "application/javascript" } });
        return new Response(`<!doctype html><meta charset="utf-8"><style>body{background:#121212;color:#fff}${css}</style><div id="root"></div><script type="module" src="/app.js"></script>`, { headers: { "Content-Type": "text/html" } });
    } });
    browser = await chromium.launch({ headless: true, executablePath: process.env.SEAL_TEST_CHROME || undefined });
}, 60000);
afterAll(async () => { await browser?.close(); server?.stop(true); });

test("ComfyUI refresh shows live loader files and saves the new model in the graph", async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    await page.addInitScript(() => { Object.defineProperty(globalThis, "Bun", { value: {} }); });
    await page.route("**/api/**", async route => {
        const nodes = { CheckpointLoaderSimple: { input: { required: { ckpt_name: [["old.safetensors", "new.safetensors"]] } } }, CLIPTextEncode: {}, SaveImage: {} };
        const data = route.request().url().includes("comfyui/inspect") ? { stats: {}, nodes } : { providers: [] };
        await route.fulfill({ json: { code: 0, data } });
    });
    await page.goto(`http://127.0.0.1:${server.port}/?comfy`);
    expect(await page.getByRole("button", { name: "导入工作流配置", exact: true }).count()).toBe(0);
    expect(await page.getByRole("button", { name: "导出工作流配置", exact: true }).count()).toBe(0);
    expect(await page.locator(".workflow-graph-editor").count()).toBe(0);
    expect(await page.getByRole("combobox", { name: "鉴权方式" }).count()).toBe(0);
    await page.getByRole("button", { name: "刷新本机模型", exact: true }).click();
    const select = page.getByRole("combobox", { name: "本机模型 1 ckpt_name" });
    await select.click();
    await page.locator(".ant-select-item-option-content").filter({ hasText: /^new\.safetensors$/ }).click();
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#saved")?.textContent?.includes('"ckpt_name":"new.safetensors"'));
    const saved = JSON.parse(await page.locator("#saved").innerText());
    expect(saved.modelProfiles[0].comfyui.graph["1"].inputs.ckpt_name).toBe("new.safetensors");
    expect(saved.modelProfiles[0].comfyui.graph["3"].inputs.images).toEqual(["1", 0]);
    await page.close();
}, 30000);

test("ComfyUI file import reads models automatically and keeps advanced fields folded", async () => {
    const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
    page.setDefaultTimeout(8000);
    await page.addInitScript(() => { Object.defineProperty(globalThis, "Bun", { value: {} }); });
    let inspections = 0;
    await page.route("**/api/**", async route => {
        const inspect = route.request().url().includes("comfyui/inspect");
        if (inspect) inspections++;
        const nodes = { CheckpointLoaderSimple: { input: { required: { ckpt_name: [["old.safetensors", "new.safetensors"]] } } }, CLIPTextEncode: {}, SaveImage: {}, KSampler: { input: { required: { steps: ["INT", { min: 1, max: 100, step: 1 }] } } } };
        await route.fulfill({ json: { code: 0, data: inspect ? { stats: {}, nodes } : { providers: [] } } });
    });
    await page.goto(`http://127.0.0.1:${server.port}/?comfy&empty`);
    await page.getByRole("button", { name: "导入文件", exact: true }).waitFor();
    expect(await page.getByRole("button", { name: "导入文件", exact: true }).count()).toBe(1);
    expect(await page.getByRole("textbox", { name: "当前工作流名称", exact: true }).count()).toBe(0);
    expect(await page.getByText("还没有工作流", { exact: true }).count()).toBe(0);
    const input = page.locator('input[type="file"]');
    expect(await input.count()).toBe(1);
    await input.setInputFiles({ name: "canvas.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ nodes: [], links: [] })) });
    await page.getByText("请从 ComfyUI 导出 API 格式工作流，普通画布 JSON 不能提交", { exact: true }).waitFor();
    const graph = {
        "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "old.safetensors" } },
        "2": { class_type: "CLIPTextEncode", inputs: { text: "positive", clip: ["1", 1] } },
        "3": { class_type: "SaveImage", inputs: { images: ["4", 0] } },
        "4": { class_type: "KSampler", inputs: { positive: ["2", 0], steps: 20 } },
    };
    await input.setInputFiles({ name: "product-api.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(graph)) });
    await page.getByRole("combobox", { name: "本机模型 1 ckpt_name" }).waitFor();
    expect(await page.getByRole("textbox", { name: "当前工作流名称", exact: true }).isVisible()).toBe(true);
    expect(inspections).toBe(1);
    expect(await page.locator(".workflow-graph-editor").count()).toBe(0);
    expect(await page.getByRole("combobox", { name: "工作流提示词输入" }).count()).toBe(0);
    await page.getByRole("spinbutton", { name: "工作流参数 4 steps" }).fill("28");
    if (process.env.SEAL_COMFY_UI_SCREENSHOT) await page.screenshot({ path: process.env.SEAL_COMFY_UI_SCREENSHOT });
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#saved")?.textContent?.includes('"steps":28'));
    const saved = JSON.parse(await page.locator("#saved").innerText());
    expect(saved.modelProfiles[0].comfyui.outputNodeId).toBe("3");
    expect(saved.modelProfiles[0].comfyui.fields.find((field: { nodeId: string }) => field.nodeId === "2")).toMatchObject({ source: "prompt", enabled: true });
    await page.close();
}, 30000);

test("ComfyUI accepts pasted JSON, reports syntax errors and preserves bindings while editing", async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    await page.addInitScript(() => { Object.defineProperty(globalThis, "Bun", { value: {} }); });
    await page.route("**/api/**", async route => {
        const nodes = { CheckpointLoaderSimple: { input: { required: { ckpt_name: [["old.safetensors", "new.safetensors"]] } } }, CLIPTextEncode: {}, SaveImage: {} };
        await route.fulfill({ json: { code: 0, data: route.request().url().includes("comfyui/inspect") ? { stats: {}, nodes } : { providers: [] } } });
    });
    await page.goto(`http://127.0.0.1:${server.port}/?comfy&empty`);
    await page.getByRole("button", { name: "粘贴 JSON", exact: true }).click();
    const editor = page.getByRole("textbox", { name: "工作流 JSON", exact: true });
    await editor.fill('{"broken":');
    await page.getByRole("button", { name: "检查并应用", exact: true }).click();
    await page.getByText("JSON 格式不正确，请检查引号、逗号和括号", { exact: true }).waitFor();
    expect(await page.getByRole("textbox", { name: "当前工作流名称", exact: true }).count()).toBe(0);
    const graph = {
        "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "old.safetensors" } },
        "2": { class_type: "CLIPTextEncode", inputs: { text: "positive", clip: ["1", 1] } },
        "3": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
    };
    await editor.fill(JSON.stringify(graph));
    await page.getByRole("button", { name: "检查并应用", exact: true }).click();
    await page.getByRole("combobox", { name: "本机模型 1 ckpt_name" }).waitFor();
    expect(await page.getByRole("textbox", { name: "工作流 JSON", exact: true }).count()).toBe(0);
    await page.getByRole("button", { name: "高级设置 · 节点与字段绑定", exact: true }).click();
    await page.getByRole("button", { name: "编辑 JSON", exact: true }).click();
    expect(JSON.parse(await editor.inputValue())).toEqual(graph);
    graph["1"].inputs.ckpt_name = "new.safetensors";
    graph["2"].inputs.text = "new prompt";
    await editor.fill(JSON.stringify(graph));
    await page.getByRole("button", { name: "检查并应用", exact: true }).click();
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#saved")?.textContent?.includes('"ckpt_name":"new.safetensors"'));
    const saved = JSON.parse(await page.locator("#saved").innerText());
    expect(saved.modelProfiles[0].comfyui.fields.find((field: { nodeId: string }) => field.nodeId === "2")).toMatchObject({ source: "prompt", enabled: true, fieldValue: "new prompt" });
    expect(saved.modelProfiles[0].comfyui.outputNodeId).toBe("3");
    await page.close();
}, 30000);

test("cloud refresh survives reopening, preserves selection and retains cached directory after failure", async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    await page.addInitScript(() => { Object.defineProperty(globalThis, "Bun", { value: {} }); });
    let fail = false;
    let count = 0;
    await page.route("**/api/**", async route => {
        if (route.request().url().includes("/ai/models")) {
            count++;
            if (fail) { await route.fulfill({ status: 502, json: { code: 502, msg: "模型服务鉴权失败，请检查 API Key" } }); return; }
            await route.fulfill({ json: { code: 0, data: { models: [{ id: "image-old", modelType: "image" }, { id: "image-new", modelType: "image" }, { id: "opaque-new" }] } } });
        } else await route.fulfill({ json: { code: 0, data: { providers: [{ id: "openai-image", name: "OpenAI Images", categories: ["image"], scopes: [], enabled: true }] } } });
    });
    await page.goto(`http://127.0.0.1:${server.port}/`);
    await page.getByRole("button", { name: "刷新模型", exact: true }).click();
    await page.locator(".model-service-model strong").filter({ hasText: /^image-new$/ }).waitFor();
    expect(await page.locator(".model-service-model").filter({ hasText: "image-new" }).getByRole("checkbox").isChecked()).toBe(false);
    expect(await page.locator(".model-service-model").filter({ hasText: "manual-image" }).getByRole("checkbox").isChecked()).toBe(true);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByRole("button", { name: "重新打开", exact: true }).click();
    await page.locator(".model-service-model strong").filter({ hasText: /^opaque-new$/ }).waitFor();
    expect(count).toBe(1);
    fail = true;
    await page.getByRole("button", { name: "刷新模型", exact: true }).click();
    await page.getByText("模型服务鉴权失败，请检查 API Key；保留上次目录和已配置模型，也可手动添加", { exact: true }).waitFor();
    expect(await page.locator(".model-service-model strong").filter({ hasText: /^image-new$/ }).count()).toBe(1);
    const saved = JSON.parse(await page.locator("#saved").innerText());
    expect(saved.models).toEqual(["image-old", "manual-image"]);
    expect(saved.modelProfiles.find((item: { model: string }) => item.model === "image-old").defaultOptions.quality).toBe("custom");
    await page.close();
}, 30000);
