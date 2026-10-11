// 零模型浏览器验收：生产 Sidebar / hook / NDJSON，按钮推进模拟执行事件。
import fs from 'node:fs/promises';
import path from 'node:path';
import { createModelChannel, defaultConfig } from '../../src/stores/use-config-store';
import { createTurnObserver } from '../../../agent-host/lifecycle-events.mjs';

const build = await Bun.build({ entrypoints: [path.join(import.meta.dir, 'assistant-streaming-harness.tsx')], target: 'browser',
    define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true', 'import.meta.env.MODE': '"production"', 'import.meta.env.VITE_CANVAS_LOCAL_MODE': '"true"', 'import.meta.env.VITE_CANVAS_BACKEND_URL': '"/api"', 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'source', setup(builder) {
        builder.onResolve({ filter: /^@\/components\/model-logo$/ }, () => ({ path: 'model-logo', namespace: 'test-icons' }));
        builder.onLoad({ filter: /.*/, namespace: 'test-icons' }, () => ({ contents: 'export function ModelLogo(){return null}', loader: 'js' }));
        builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync('../../src/' + args.path.slice(2), import.meta.dir) }));
    } }] });
if (!build.success) throw new Error(build.logs.map(String).join('\n'));
const files = new Map(await Promise.all(build.outputs.map(async file => ['/' + path.basename(file.path), { text: await file.text(), type: file.type }] as const)));
const dist = path.resolve(import.meta.dir, '../../dist');
const styles = (await fs.readdir(path.join(dist, 'static'))).filter(file => file.endsWith('.css')).map(file => `/static/${file}`);
styles.push(...[...files.keys()].filter(file => file.endsWith('.css')));
const config = { ...defaultConfig, assistantModel: 'fixture::test', channels: [createModelChannel({ id: 'fixture', enabled: true, models: ['test'], modelProfiles: [{ model: 'test', capability: 'text', protocol: 'chat-completion' }] })] };
const histories = new Map<string, any[]>();
for (const [canvas, count] of [['short', 4], ['long', 200]] as const) histories.set(canvas, Array.from({ length: count }, (_, index) => ({ turnId: `${canvas}-${index}`, userText: `历史问题 ${index + 1}`,
    selectedNodeIds: [], reply: `### 第 ${index + 1} 次剪辑\n\n检查画面和声音，保持当前工程的素材与节奏。\n\n- 已读取素材\n- 已检查片段\n\n这是保存的历史回复。`, toolCalls: [], proposals: [], change: null, error: null, cancelled: false, createdAt: '' } )));
let active: { canvas: string; turnId: string; userText: string; instructions: any[]; send: (value: unknown) => void; emit: (value: any) => void; observer: ReturnType<typeof createTurnObserver>; started: number; close: () => void; disconnect: () => void; phase: number; reply: string } | null = null;
const ok = (data: unknown) => Response.json({ code: 0, data });
const server = Bun.serve({ port: Number(process.env.SEAL_ASSISTANT_FIXTURE_PORT || 0), hostname: '127.0.0.1', idleTimeout: 255, async fetch(request) {
    const url = new URL(request.url), route = url.pathname;
    const file = files.get(route);
    if (file) return new Response(file.text, { headers: { 'content-type': file.type || (route.endsWith('.css') ? 'text/css' : 'application/javascript') } });
    if (route.startsWith('/static/') && !route.includes('..')) return new Response(await fs.readFile(path.join(dist, route)), { headers: { 'content-type': route.endsWith('.css') ? 'text/css' : 'application/octet-stream' } });
    if (route === '/fixture/advance') {
        if (active) {
            for (const instruction of active.instructions) if (instruction.state === 'queued') {
                instruction.state = 'received'; active.send({ type: 'instruction', instruction });
            }
            active.phase++;
            if (active.phase === 1) {
                active.emit({ type: 'tool_execution_update', toolCallId: 'read', toolName: 'edit_read' });
                active.emit({ type: 'tool_execution_start', toolCallId: 'script', toolName: 'workspace_run', args: { runtime: 'node', script: 'scripts/check-scene.mjs', args: ['candidate.html'] } });
                active.emit({ type: 'tool_execution_end', toolCallId: 'script', toolName: 'workspace_run', isError: false, result: { content: [{ type: 'text', text: '{"exitCode":0,"stdout":"Candidate syntax valid"}' }] } });
            }
            if (active.phase === 2) {
                active.emit({ type: 'tool_execution_end', toolCallId: 'read', toolName: 'edit_read', isError: false, result: { content: [{ type: 'text', text: '{"width":1080,"height":1920,"fps":30,"clips":[]}' }] } });
                active.emit({ type: 'message_start', message: { role: 'assistant' } });
                active.emit({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: '工程已经读到，接下来检查场景是否可以正常预览。' }], stopReason: 'toolUse' } });
                active.emit({ type: 'tool_execution_start', toolCallId: 'inspect', toolName: 'hyperframes_inspect' });
            }
            if (active.phase === 3) {
                active.emit({ type: 'tool_execution_end', toolCallId: 'inspect', toolName: 'hyperframes_inspect', isError: true, result: { content: [{ type: 'text', text: '场景检查返回无效响应（模拟错误）。' }] } });
                active.emit({ type: 'message_start', message: { role: 'assistant' } });
                const text = '### 检查结果\n\n已读取工程，检查发现一个问题。\n\n| 项目 | 结果 |\n|---|---|\n| 读取工程 | 完成 |\n| 场景检查 | 需要调整 |\n\n```js\nconst title = "Seal";\nconsole.log(title);\n```\n\n';
                const run = active;
                for (let index = 0; index < text.length; index += 4) {
                    if (active !== run) break;
                    const delta = text.slice(index, index + 4); run.reply += delta; run.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta } });
                    await Bun.sleep(25);
                }
                run.emit({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: run.reply }], stopReason: 'stop' } });
            }
        }
        return ok({});
    }
    if (route === '/fixture/finish' || route === '/fixture/fail' || route.endsWith('/assistant/cancel')) {
        if (active) {
            const cancelled = route.endsWith('/cancel');
            const toolActivity = active.observer.toolActivity;
            const turn = { turnId: active.turnId, userText: active.userText, instructions: active.instructions.map(item => ({ ...item, state: item.state === 'queued' ? 'not_processed' : item.state })), reply: active.reply, selectedNodeIds: [], toolCalls: toolActivity.map(item => ({ toolCallId: item.toolCallId, tool: item.tool, isError: item.status === 'error' })), toolActivity,
                execution: active.observer.execution, finalMessageId: active.observer.finalMessageId, metrics: { firstTokenMs: null, totalMs: Date.now() - active.started },
                skillsUsed: [{ id: 'fixture-skill', name: 'hyperframes', displayName: 'HyperFrames 视频创作', version: '0.8.130', contentHash: 'fixture' }], proposals: [], change: null, error: route === '/fixture/fail' ? 'Synthetic model failure' : null, errorReason: route === '/fixture/fail' ? 'model_request_failed' : null, cancelled, createdAt: '' };
            histories.get(active.canvas)?.push(turn);
            active.send({ type: 'turn_end', ...turn }); active.close(); active = null;
        }
        return ok({});
    }
    if (route === '/fixture/disconnect') { active?.disconnect(); return ok({}); }
    if (route.endsWith('/assistant/steer')) {
        const body = await request.json();
        if (!active || body.turnId !== active.turnId || body.sessionId !== active.canvas) return Response.json({ code: 409, reason: 'turn_not_running' }, { status: 409 });
        const previous = active.instructions.find(item => item.instructionId === body.instructionId);
        if (previous) return ok(previous);
        const instruction = { ...body, state: 'queued' };
        active.instructions.push(instruction);
        return ok(instruction);
    }
    if (route.endsWith('/assistant/chat')) {
        const body = await request.json();
        let disconnected = false;
        return new Response(new ReadableStream({ start(controller) {
            const encoder = new TextEncoder();
            const observer = createTurnObserver();
            active = { canvas: body.canvasId, turnId: 'live-' + Date.now(), userText: body.message, instructions: [], reply: '', phase: 0,
                observer, started: Date.now(), emit: event => { const payload = observer.handle(event); if (payload) active?.send(payload); },
                send: value => { if (!disconnected) controller.enqueue(encoder.encode(JSON.stringify(value) + '\n')); },
                close: () => { if (!disconnected) controller.close(); }, disconnect: () => { disconnected = true; controller.error(new Error('fixture disconnected')); } };
            active.send({ type: 'turn_start', turnId: active.turnId, sessionId: body.canvasId });
            active.emit({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: '我先读取技能说明，再检查当前剪辑工程。' }], stopReason: 'toolUse' } });
            active.emit({ type: 'message_update', assistantMessageEvent: { type: 'thinking_start' } });
            for (let index = 0; index < 3; index++) {
                active.emit({ type: 'tool_execution_start', toolCallId: `skill-${index}`, toolName: 'read', args: { path: ['skills/hyperframes/SKILL.md', 'skills/hyperframes/local-rules.md', 'skills/hyperframes/animation.md'][index] } });
                active.emit({ type: 'tool_execution_end', toolCallId: `skill-${index}`, toolName: 'read', isError: false, result: { content: [{ type: 'text', text: ['HyperFrames 本地规则：候选通过检查后才能加入轨道。', '项目规则：当前工程 1080×1920，30fps。', '动画规则：GSAP 时间线保持暂停并可以定位到指定时间。'][index] }] } });
            }
            active.emit({ type: 'tool_execution_start', toolCallId: 'read', toolName: 'edit_read' });
        }, cancel() { disconnected = true; } }), { headers: { 'content-type': 'application/x-ndjson' } });
    }
    if (route.endsWith('/assistant/history')) return ok({ sessionId: url.searchParams.get('canvasId'), turns: histories.get(url.searchParams.get('canvasId') || '') || [],
        activeTurn: active?.canvas === url.searchParams.get('canvasId') ? { sessionId: active.canvas, turnId: active.turnId, userText: active.userText, selectedNodeIds: [], instructions: active.instructions,
            execution: active.observer.execution, toolActivity: active.observer.activeToolActivity, lifecycle: active.observer.lifecycle } : null });
    if (route.endsWith('/assistant/sessions')) return ok({ currentSessionId: url.searchParams.get('canvasId'), sessions: [] });
    if (route.endsWith('/assistant/status')) return ok({ available: true, model: { id: 'test', channelId: 'fixture' } });
    if (route.endsWith('/assistant/ui-session')) return ok({ token: 'fixture-only', expiresAt: new Date(Date.now() + 1800000).toISOString() });
    if (route.includes('model-config')) return ok({ config, revision: 0 });
    if (route.endsWith('/media/proposals')) return ok({ items: [] });
    if (route.endsWith('/skill-hub')) return ok({ skills: [] });
    if (route.startsWith('/api/')) return ok({});
    return new Response(`<html class="dark"><head>${styles.map(src => `<link rel="stylesheet" href="${src}">`).join('')}</head><body><div id="root"></div><script type="module" src="/${path.basename(build.outputs.find(file => file.path.endsWith('.js'))!.path)}"></script></body></html>`, { headers: { 'content-type': 'text/html' } });
} });
console.log(`Assistant harness: http://127.0.0.1:${server.port}`);
