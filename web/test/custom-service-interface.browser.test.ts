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
        page.on("pageerror", error => errors.push(error.message));
        await page.route("**/*", async route => {
            const path = new URL(route.request().url()).pathname;
            if (path === "/harness.js") await route.fulfill({ contentType: "application/javascript", body: javascript });
            else if (path.startsWith("/api/")) await route.fulfill({ contentType: "application/json", body: JSON.stringify({ code: 0, data: { providers: [] } }) });
            else await route.fulfill({ contentType: "text/html", body: '<div id="root"></div><script type="module" src="/harness.js"></script>' });
        });
        await page.goto("http://seal-fixture.local/");
        await page.getByRole("textbox", { name: "提交路径", exact: true }).waitFor();
        expect(await page.getByRole("button", { name: "高级设置", exact: true }).count()).toBe(1);
        expect(await page.getByRole("textbox", { name: "提交路径", exact: true }).count()).toBe(1);
        await page.getByRole("button", { name: "高级设置", exact: true }).click();
        expect(await page.getByRole("textbox", { name: "提交路径", exact: true }).count()).toBe(0);
        await page.getByRole("button", { name: "高级设置", exact: true }).click();
        expect(await page.getByRole("textbox", { name: "提交路径", exact: true }).inputValue()).toBe("/videos");
        await page.getByRole("textbox", { name: "提交路径", exact: true }).fill("/jobs");
        await page.getByRole("textbox", { name: "模型 ID", exact: true }).fill("first-video");
        await page.locator(".model-service-manual button").click();
        expect(await page.getByRole("textbox", { name: "提交路径", exact: true }).inputValue()).toBe("/jobs");
        await page.getByRole("button", { name: "生成参数与连接测试", exact: true }).click();
        await page.getByRole("tab", { name: "能力与参数", exact: true }).waitFor();
        expect(await page.getByRole("tab", { name: "基本信息", exact: true }).count()).toBe(0);
        expect(await page.getByRole("textbox", { name: "提交路径", exact: true }).count()).toBe(1);
        await page.getByRole("button", { name: /完\s*成/ }).click();
        await page.getByRole("textbox", { name: "模型 ID", exact: true }).fill("second-video");
        await page.locator(".model-service-manual button").click();
        await page.getByRole("textbox", { name: "提交路径", exact: true }).fill("/jobs/v2");
        await page.getByRole("textbox", { name: "渠道名称", exact: true }).fill("Fixture service");
        await page.getByRole("textbox", { name: "服务地址", exact: true }).fill("https://example.com/v1");
        await page.locator('input[aria-label="API Key"]').fill("fixture-not-a-real-key");
        await page.locator(".model-service-footer button").last().click();
        await page.waitForFunction(() => Boolean((window as unknown as { savedChannel?: unknown }).savedChannel));
        const saved = await page.evaluate(() => (window as unknown as { savedChannel: { modelProfiles: Array<{ model: string; protocol: string; customProvider: { create: { path: string } } }> } }).savedChannel);
        expect(saved.modelProfiles.map(profile => [profile.model, profile.protocol, profile.customProvider.create.path])).toEqual([
            ["first-video", "custom-video", "/jobs"],
            ["second-video", "custom-video", "/jobs/v2"],
        ]);
        expect(errors).toEqual([]);
    } finally {
        await browser.close();
    }
}, 60000);
