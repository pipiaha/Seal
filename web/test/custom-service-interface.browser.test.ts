import { expect, test } from "bun:test";
import { chromium } from "playwright";

test("custom service exposes its interface before adding models and preserves each model recipe", async () => {
    const build = await Bun.build({
        entrypoints: [import.meta.dir + "/fixtures/custom-service-interface-harness.tsx"],
        target: "browser",
        define: { "import.meta.env.DEV": "false", "import.meta.env.PROD": "true", "import.meta.env.MODE": '"production"', "import.meta.env.VITE_CANVAS_LOCAL_MODE": '"true"', "import.meta.env.VITE_CANVAS_BACKEND_URL": '"/api"', "process.env.NODE_ENV": '"production"' },
        plugins: [{ name: "source", setup(builder) {
            builder.onResolve({ filter: /^@\/components\/model-logo$/ }, () => ({ path: "model-logo", namespace: "test-icons" }));
            builder.onLoad({ filter: /.*/, namespace: "test-icons" }, () => ({ contents: "export function ModelLogo(){return null}", loader: "js" }));
            builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync("../src/" + args.path.slice(2), import.meta.dir) }));
        } }],
    });
    expect(build.success).toBe(true);
    const javascript = await build.outputs.find(item => item.path.endsWith(".js"))!.text();
    const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    try {
        const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
        const errors: string[] = [];
        const previewed: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.route("**/*", async route => {
            const path = new URL(route.request().url()).pathname;
            if (path === "/harness.js") await route.fulfill({ contentType: "application/javascript", body: javascript });
            else if (path === "/api/workspace/providers/script/preview") {
                const input = route.request().postDataJSON() as { script: string };
                previewed.push(input.script);
                await route.fulfill({ contentType: "application/json", body: JSON.stringify({ code: 0, data: { valid: true, create: { method: "POST", path: "/jobs", body: { params: ["fixture"] } } } }) });
            }
            else if (path.startsWith("/api/")) await route.fulfill({ contentType: "application/json", body: JSON.stringify({ code: 0, data: { providers: [] } }) });
            else await route.fulfill({ contentType: "text/html", body: '<div id="root"></div><script type="module" src="/harness.js"></script>' });
        });
        await page.goto("http://seal-fixture.local/");
        await page.locator(".cm-content").waitFor();
        expect(await page.getByRole("button", { name: "高级设置", exact: true }).count()).toBe(1);
        expect(await page.locator(".cm-content").count()).toBe(1);
        await page.getByRole("button", { name: "高级设置", exact: true }).click();
        expect(await page.locator(".cm-content").count()).toBe(0);
        await page.getByRole("button", { name: "高级设置", exact: true }).click();
        const firstScript = '{create:{method:"POST",path:"/jobs",body:{params:[prompt,...images]}},poll:{method:"GET",path:"/jobs/{task_id}"},response:{taskId:"id",status:"status",result:"url"}}';
        const secondScript = firstScript.replace('path:"/jobs"', 'path:"/jobs/v2"');
        const writeScript = async (source: string) => {
            await page.locator(".cm-content").click();
            await page.keyboard.press("Control+A");
            await page.keyboard.insertText(source);
        };
        expect(await page.locator(".cm-content").innerText()).toContain("/videos");
        await writeScript(firstScript);
        await page.getByRole("button", { name: "检查并预览请求", exact: true }).click();
        await page.locator('[aria-label="接口请求预览"]').waitFor();
        expect(await page.locator('[aria-label="接口请求预览"]').innerText()).toContain('"params"');
        await page.getByRole("textbox", { name: "模型 ID", exact: true }).fill("first-video");
        await page.locator(".model-service-manual button").click();
        expect(await page.locator(".cm-content").innerText()).toContain('path:"/jobs"');
        await page.getByRole("button", { name: "生成参数与连接测试", exact: true }).click();
        await page.getByRole("tab", { name: "能力与参数", exact: true }).waitFor();
        expect(await page.getByRole("tab", { name: "基本信息", exact: true }).count()).toBe(0);
        expect(await page.locator(".cm-content").count()).toBe(1);
        await page.getByRole("button", { name: /完\s*成/ }).click();
        await page.getByRole("textbox", { name: "模型 ID", exact: true }).fill("second-video");
        await page.locator(".model-service-manual button").click();
        await writeScript(secondScript);
        await page.getByRole("textbox", { name: "渠道名称", exact: true }).fill("Fixture service");
        await page.getByRole("textbox", { name: "服务地址", exact: true }).fill("https://example.com/v1");
        await page.locator('input[aria-label="API Key"]').fill("fixture-not-a-real-key");
        await page.locator(".model-service-footer button").last().click();
        await page.waitForFunction(() => Boolean((window as unknown as { savedChannel?: unknown }).savedChannel));
        const saved = await page.evaluate(() => (window as unknown as { savedChannel: { modelProfiles: Array<{ model: string; protocol: string; customProvider: { script: string } }> } }).savedChannel);
        expect(saved.modelProfiles.map(profile => [profile.model, profile.protocol, profile.customProvider.script])).toEqual([
            ["first-video", "custom-video", firstScript],
            ["second-video", "custom-video", secondScript],
        ]);
        expect(previewed).toEqual([firstScript, firstScript, secondScript]);
        expect(errors).toEqual([]);
    } finally {
        await browser.close();
    }
}, 60000);
