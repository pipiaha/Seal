import { expect, test } from "bun:test";
import { chromium } from "playwright";

test("Agnes site switching retains credentials and selected model", async () => {
    const build = await Bun.build({
        entrypoints: [import.meta.dir + "/fixtures/custom-service-interface-harness.tsx"], target: "browser",
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
            else if (path.startsWith("/api/")) await route.fulfill({ contentType: "application/json", body: JSON.stringify({ code: 0, data: { providers: [{ id: "agnes-video", name: "Agnes Video", vendor: "Agnes", version: "1", categories: ["video"], enabled: true }] } }) });
            else await route.fulfill({ contentType: "text/html", body: '<div id="root"></div><script type="module" src="/harness.js"></script>' });
        });
        await page.goto("http://seal-fixture.local/");
        await page.getByRole("button", { name: "Agnes AI", exact: true }).click();
        expect(await page.getByRole("textbox", { name: "服务地址", exact: true }).inputValue()).toBe("https://api.agnes-ai.cn/v1");
        await page.locator('input[aria-label="API Key"]').fill("fixture-not-a-real-key");
        await page.getByRole("combobox", { name: "服务站点", exact: true }).click();
        await page.getByTitle("国际站 · agnes-ai.com", { exact: true }).last().click();
        expect(await page.getByRole("textbox", { name: "服务地址", exact: true }).inputValue()).toBe("https://apihub.agnes-ai.com/v1");
        expect(await page.locator('input[aria-label="API Key"]').inputValue()).toBe("fixture-not-a-real-key");
        await page.getByRole("combobox", { name: "服务站点", exact: true }).click();
        await page.getByTitle("国内站 · agnes-ai.cn", { exact: true }).last().click();
        await page.locator(".model-service-footer button").last().click();
        await page.waitForFunction(() => Boolean((window as unknown as { savedChannel?: unknown }).savedChannel));
        const saved = await page.evaluate(() => (window as unknown as { savedChannel: { baseUrl: string; apiKey: string; models: string[]; modelProfiles: { protocol: string }[] } }).savedChannel);
        expect(saved).toMatchObject({ baseUrl: "https://api.agnes-ai.cn/v1", apiKey: "fixture-not-a-real-key", models: ["agnes-video-2.5-flash"] });
        expect(saved.modelProfiles[0].protocol).toBe("agnes-video");
        expect(errors).toEqual([]);
    } finally { await browser.close(); }
}, 60000);
