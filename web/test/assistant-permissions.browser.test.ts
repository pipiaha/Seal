import { test, expect } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { createModelChannel, defaultConfig } from "@/stores/use-config-store";
import type { MediaProposal } from "@/services/api/creator";

// Actual Sidebar, composer, channel preparation, task polling and session controller;
// only the model and HTTP task worker are replaced with local deterministic responses.
test("assistant approval, automatic generation, continuation, stop and new-session isolation", async () => {
    const build = await Bun.build({
        entrypoints: [import.meta.dir + "/fixtures/assistant-skill-picker-harness.tsx"],
        target: "browser",
        define: {
            "import.meta.env.DEV": "false",
            "import.meta.env.PROD": "true",
            "import.meta.env.MODE": '"production"',
            "import.meta.env.VITE_CANVAS_LOCAL_MODE": '"true"',
            "import.meta.env.VITE_CANVAS_BACKEND_URL": '"/api"',
            "process.env.NODE_ENV": '"production"',
        },
        plugins: [
            {
                name: "source",
                setup(builder) {
                    builder.onResolve({ filter: /^@\/components\/model-logo$/ }, () => ({ path: "model-logo", namespace: "icons" }));
                    builder.onLoad({ filter: /.*/, namespace: "icons" }, () => ({ contents: "export function ModelLogo(){return null}", loader: "js" }));
                    builder.onResolve({ filter: /^@\// }, (args) => ({ path: Bun.resolveSync("../src/" + args.path.slice(2), import.meta.dir) }));
                },
            },
        ],
    });
    if (!build.success) throw new Error(build.logs.join("\n"));
    const javascript = await build.outputs.find((item) => item.path.endsWith(".js"))!.text();
    const repo = path.resolve(import.meta.dir, "../..");
    const css = (await fs.readdir(path.join(repo, "web/dist/static"))).filter((file) => file.endsWith(".css"));
    const config = {
        ...defaultConfig,
        assistantModel: "fixture::text",
        imageModel: "fixture::image",
        channels: [
            createModelChannel({
                id: "fixture",
                enabled: true,
                baseUrl: "https://fixture.invalid/v1",
                apiKey: "synthetic-only",
                models: ["text", "image"],
                modelProfiles: [
                    { model: "text", capability: "text", protocol: "chat-completion" },
                    { model: "image", capability: "image", protocol: "openai-image" },
                ],
            }),
        ],
    };
    let sessionId = "s1";
    const modes = new Map<string, string>();
    const proposals: MediaProposal[] = [];
    const tasks = new Map<string, any>();
    const admissions: any[] = [];
    const continuations: any[] = [];
    const proposalReads: string[] = [];
    const histories = new Map<string, any[]>();
    const addProposal = (id: string) => proposals.push({ proposalId: id, projectId: "skill-canvas", kind: "image", prompt: id, model: "image", modelKey: "fixture::image", configRevision: 0, sessionId, autoContinue: true });
    addProposal("manual");
    const ok = (data: unknown) => Response.json({ code: 0, data });
    const server = Bun.serve({
        port: 0,
        async fetch(request) {
            const url = new URL(request.url),
                route = url.pathname;
            if (route === "/harness.js") return new Response(javascript, { headers: { "Content-Type": "application/javascript" } });
            if (route.startsWith("/static/")) return new Response(await fs.readFile(path.join(repo, "web/dist", route)), { headers: { "Content-Type": route.endsWith(".css") ? "text/css" : "application/octet-stream" } });
            if (route.includes("model-config")) return ok({ config, revision: 0 });
            if (route.endsWith("/assistant/ui-session")) return ok({ token: "synthetic-only", expiresAt: new Date(Date.now() + 1800000).toISOString() });
            if (route.endsWith("/assistant/status")) return ok({ available: true, model: { id: "text", channelId: "fixture" } });
            if (route.endsWith("/assistant/history")) return ok({ sessionId, turns: histories.get(sessionId) || [] });
            if (route.endsWith("/assistant/sessions")) {
                if (request.method === "POST") sessionId = "s2";
                return ok({ sessionId, currentSessionId: sessionId, sessions: [] });
            }
            if (route.includes("/permissions/")) {
                const body = await request.json();
                if (route.endsWith("/write")) modes.set(body.sessionId, body.mode);
                if (route.endsWith("/stop")) for (const item of proposals) if (item.sessionId === body.sessionId && !item.continuationTurnId) item.autoContinue = false;
                return ok({ mode: modes.get(body.sessionId) || "ask" });
            }
            if (route.endsWith("/media/proposals")) {
                proposalReads.push(sessionId + ":" + proposals.map((item) => item.proposalId).join(","));
                return ok({ items: proposals });
            }
            if (route.includes("/media/accept/")) {
                const body = await request.json(),
                    item = proposals.find((item) => item.proposalId === route.split("/").at(-1))!;
                if (body.automatic && modes.get(item.sessionId!) !== "allow") return Response.json({ code: 403, msg: "approval required" }, { status: 403 });
                admissions.push(body);
                item.taskId = "task_" + item.proposalId;
                item.decision = "approved";
                const task = { id: item.taskId, status: "running", stage: "制作中", progress: 20, outputs: [] };
                tasks.set(task.id, task);
                return ok(task);
            }
            if (route.includes("/media/reject/")) {
                proposals.find((item) => item.proposalId === route.split("/").at(-1))!.decision = "rejected";
                return ok({ rejected: true });
            }
            if (route.endsWith("/media/task")) return ok(tasks.get((await request.json()).taskId));
            if (route.endsWith("/cancel") && route.includes("/tasks/")) {
                const task = tasks.get(route.split("/").at(-2)!);
                task.status = "cancelled";
                return ok(task);
            }
            if (route.endsWith("/assistant/cancel")) return ok({ accepted: true });
            if (route.endsWith("/assistant/chat")) {
                const body = await request.json();
                continuations.push(body);
                const item = proposals.find((item) => item.proposalId === body.continuationProposalId)!;
                item.continuationTurnId = "turn_" + continuations.length;
                const turn = { turnId: item.continuationTurnId, userText: body.message, reply: "已处理制作结果", toolCalls: [], proposals: [], selectedNodeIds: [] };
                histories.set(body.sessionId, [...(histories.get(body.sessionId) || []), turn]);
                return new Response(JSON.stringify({ type: "turn_end", ...turn }) + "\n");
            }
            if (route.endsWith("/skill-hub")) return ok({ skills: [] });
            if (route.startsWith("/api/")) return ok({});
            return new Response(`<html class="dark"><head>${css.map((file) => `<link rel="stylesheet" href="/static/${file}">`).join("")}</head><body><div id="root"></div><script type="module" src="/harness.js"></script></body></html>`, {
                headers: { "Content-Type": "text/html" },
            });
        },
    });
    let browser;
    try {
        browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
        const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
        page.setDefaultTimeout(10000);
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(server.url.toString());
        const permissions = page.getByRole("button", { name: "助手权限模式" });
        await page.getByRole("button", { name: "批准生成", exact: true }).waitFor();
        expect(await permissions.innerText()).toBe("请求批准");
        expect(admissions).toHaveLength(0);
        await page.getByRole("button", { name: "批准生成", exact: true }).click();
        await page.getByText("制作中 · 20%", { exact: true }).waitFor();
        expect(admissions).toHaveLength(1);
        expect(admissions[0].automatic).toBe(false);
        Object.assign(tasks.get("task_manual"), { status: "succeeded", stage: "已完成", resultState: "READY", outputs: [{ materializedAssetId: "asset_manual" }] });
        await page.waitForFunction(() => document.body.textContent?.includes("结果已交给助手继续处理"));
        expect(continuations).toHaveLength(1);
        expect(continuations[0].sessionId).toBe("s1");
        expect(continuations[0].continuationProposalId).toBe("manual");
        expect(continuations[0].references).toContainEqual({ kind: "asset", id: "asset_manual" });
        await page.reload();
        await permissions.waitFor();
        await permissions.click();
        await page.getByRole("menuitem", { name: "完全允许", exact: true }).click();
        await page.waitForFunction(() => document.querySelector('[aria-label="助手权限模式"]')?.textContent?.includes("完全允许"));
        expect(continuations).toHaveLength(1);
        addProposal("automatic");
        await page.getByText("制作中 · 20%", { exact: true }).waitFor();
        expect(admissions).toHaveLength(2);
        expect(admissions[1].automatic).toBe(true);
        await page.getByRole("button", { name: "停止", exact: true }).click();
        await page.getByRole("button", { name: "取消制作", exact: true }).waitFor({ state: "hidden" });
        expect(tasks.get("task_automatic").status).toBe("cancelled");
        expect(proposals[1].autoContinue).toBe(false);
        await Promise.all([page.waitForResponse((response) => response.url().endsWith("/assistant/sessions") && response.request().method() === "POST"), page.getByRole("button", { name: "新对话", exact: true }).click()]);
        expect(sessionId).toBe("s2");
        await page.waitForFunction(() => document.querySelector('[aria-label="助手权限模式"]')?.textContent?.includes("请求批准"));
        addProposal("rejected");
        try {
            await page.getByRole("button", { name: "拒绝", exact: true }).click();
        } catch (error) {
            throw new Error(JSON.stringify({ sessionId, proposals, modes: [...modes], proposalReads, errors, body: await page.locator("body").innerText() }), { cause: error });
        }
        await page.getByText("已拒绝", { exact: true }).waitFor();
        await page.getByText("已处理制作结果", { exact: true }).waitFor();
        expect(admissions).toHaveLength(2);
        expect(continuations).toHaveLength(2);
        expect(continuations[1].sessionId).toBe("s2");
        expect(continuations[1].continuationProposalId).toBe("rejected");
        expect(errors).toEqual([]);
        const out = path.join(repo, ".local/cache/assistant-permissions");
        await fs.mkdir(out, { recursive: true });
        await page.screenshot({ path: path.join(out, "permissions.png") });
    } finally {
        await browser?.close();
        server.stop(true);
    }
}, 60000);
