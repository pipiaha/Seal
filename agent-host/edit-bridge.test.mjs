import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createEditBridge } from './edit-bridge.mjs';

const parameters = { opsUrl: 'http://127.0.0.1:1/api', hostToken: 'test-only', desktopToken: 'test-only', turnBudgetContext: new AsyncLocalStorage() };
test('read-only assistants receive no editing write tools', () => {
  const tools = createEditBridge({ ...parameters, readOnly: true }).buildTools('canvas_1', [], {}, {}, 'session_1');
  assert.deepEqual(tools.map(tool => tool.name), ['edit_view', 'edit_media_info', 'edit_read', 'edit_history']);
});
test('edit commands cannot escape the frozen project or write without a tool-call identity', async () => {
  const bridge = createEditBridge(parameters);
  const tools = bridge.buildTools('canvas_1', [], {}, { workspaceContext: { mode: 'edit', projectId: 'canvas_2', editId: 'edit_2' } }, 'session_1');
  await assert.rejects(tools[0].execute('call_1', {}, undefined), /edit_scope_required/);
  const scoped = bridge.buildTools('canvas_1', [], {}, { workspaceContext: { mode: 'edit', projectId: 'canvas_1', editId: 'edit_1' }, editRevision: 0 }, 'session_1');
  await assert.rejects(scoped.find(tool => tool.name === 'edit_patch_element').execute('', {}, undefined), /missing_tool_call_id/);
});
