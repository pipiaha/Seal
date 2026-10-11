import crypto from 'node:crypto';
import { toolOperationId } from './session-identity.mjs';
import { budgetError, spendToolStep } from './request-budget.mjs';
import path from 'node:path';
import { readSnapshotSkillFile, rememberSkillRead } from './skill-read-bridge.mjs';

export function createHypitBridge({ opsUrl, hostToken, desktopToken, turnBudgetContext, readOnly = false }) {
  async function request(canvasId, editId, action, payload, signal, turnId) {
    const base = `${opsUrl}/edit-projects/${encodeURIComponent(canvasId)}`;
    const response = await fetch(editId ? `${base}/edits/${encodeURIComponent(editId)}/hypit/${action}` : `${base}/production`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Beeftv-Agent-Token': hostToken,
        'X-Desktop-Token': desktopToken, 'X-Beeftv-Agent-Turn': turnId }, body: JSON.stringify(payload), signal,
    });
    const envelope = await response.json();
    if (!response.ok || envelope.code !== 0) throw Object.assign(new Error(envelope.msg || 'Hypit operation failed'), { reason: envelope.reason });
    return envelope.data;
  }
  const definitions = [
    { name: 'hypit_project', action: 'open', readOnly: true, description: 'Open the current project Hypit workspace; returns saved source file hashes, editor identity and installed version.', properties: {} },
    { name: 'hypit_read', action: 'read', readOnly: true, description: 'Read official Hypit Skill references or a source file. Start with area=skill,file=SKILL.md for video production.',
      properties: { area: { type: 'string', enum: ['skill', 'project'] }, file: { type: 'string' } }, required: ['area', 'file'] },
    { name: 'hypit_write', action: 'write', description: 'Write a Hypit SVML/SVS/SVRun, author component or note. Read existing files first; pass their exact hash, or null for a new file. Do not install packages or write Runtime/credential configuration.',
      properties: { file: { type: 'string' }, text: { type: 'string' }, expectedHash: { type: ['string', 'null'] } }, required: ['file', 'text', 'expectedHash'] },
    { name: 'hypit_run', action: 'start', description: 'Start an official Hypit check, plan or build on a frozen SVRun. Build targets must include Composition and Timeline for editable delivery. Uses local endpoints; generated media must come from approved Seal generation tasks. Returns a jobId; read status until finished.',
      properties: { command: { type: 'string', enum: ['check', 'plan', 'build'] }, source: { type: 'string' }, compositionOutput: { type: 'string' }, timelineOutput: { type: 'string' } }, required: ['command', 'source'] },
    { name: 'hypit_job_status', action: 'status', readOnly: true, description: 'Read actual production progress and result. A submitted job is not a finished video.', properties: { jobId: { type: 'string' } }, required: ['jobId'] },
    { name: 'hypit_jobs', action: 'list', readOnly: true, description: 'List current project production jobs, including saved results after reopening.', properties: {} },
    { name: 'hypit_import_asset', action: 'assets/import', description: 'Copy any current-user-owned saved asset into the current Hypit author project. Find its ID with assets_search; no prior conversation attachment is required. Returns a relative file and inputId. Use it as an existing local resource.',
      properties: { assetId: { type: 'string' } }, required: ['assetId'] },
    { name: 'hypit_reference_frames', action: 'frames', readOnly: true, description: 'View an imported image or up to eight frames from a reference video. Times are seconds within the saved duration. Returns actual images for visual reference analysis.',
      properties: { inputId: { type: 'string' }, times: { type: 'array', items: { type: 'number' }, minItems: 1, maxItems: 8 } }, required: ['inputId'] },
    { name: 'hypit_cancel', action: 'cancel', description: 'Cancel the requested production job.', properties: { jobId: { type: 'string' } }, required: ['jobId'] },
    { name: 'hypit_candidate', action: 'publish', description: 'Turn a completed production into an immutable editable candidate; leaves the editing timeline unchanged.', properties: { jobId: { type: 'string' } }, required: ['jobId'] },
    { name: 'hypit_add_scene', action: 'promote', description: 'Add a ready Hypit candidate to the HyperFrames timeline. Confirm placement through the user request; preserve current manual edits. A revision conflict keeps the candidate.',
      properties: { candidateId: { type: 'string' }, start: { type: 'number' }, track: { type: 'integer' }, replaceSceneId: { type: 'string', description: 'Only when the user requests replacement: exact existing master clip ID. Keeps its start, track and visible duration; candidate must be long enough. Old content remains recoverable by native undo.' } }, required: ['candidateId'] },
  ];
  function buildTools(canvasId, log, generation, turn, identityPrefix) {
    return definitions.filter(item => !readOnly || item.readOnly).map(item => ({
      name: item.name, label: item.name, description: item.description,
      parameters: { type: 'object', properties: item.properties, required: item.required || [], additionalProperties: false },
      executionMode: 'sequential',
      execute: async (toolCallId, args, signal) => {
        if (generation.aborted || signal?.aborted) throw new Error('aborted');
        if (!item.readOnly && !toolCallId) throw new Error('missing_tool_call_id');
        if (turn.workspaceContext && turn.workspaceContext.projectId !== canvasId) throw new Error('hypit_scope_mismatch');
        const budget = turnBudgetContext.getStore(); const step = spendToolStep(budget);
        if (!step.allowed) throw budgetError(step);
        if (item.name === 'hypit_read' && args.area === 'skill') {
          const skill = turn.skillSnapshot?.skills.find(skill => skill.name === 'hypit');
          if (!skill) throw new Error('hypit_skill_disabled');
          const result = await readSnapshotSkillFile(turn.skillSnapshot, path.resolve(skill.root, args.file));
          if (result.skill.id !== skill.id) throw new Error('hypit_skill_path_out_of_scope');
          rememberSkillRead(turn, skill);
          log.push({ toolCallId, tool: item.name, args, isError: false });
          return { content: [{ type: 'text', text: result.text }] };
        }
        let context = turn.workspaceContext?.mode === 'edit' ? turn.workspaceContext : turn.hypitContext;
        if (!context) {
          const opened = await request(canvasId, null, 'open', {}, signal, turn.turnId);
          context = Object.freeze({ projectId: canvasId, editId: opened.editId, revision: opened.revision });
          turn.hypitContext = context;
        }
        const payload = { ...args, ...(!item.readOnly ? { operationId: crypto.createHash('sha256').update(toolOperationId(identityPrefix, toolCallId)).digest('hex') } : {}),
          ...(['start', 'assets/import'].includes(item.action) ? { expectedRevision: turn.editRevision ?? context.revision } : {}) };
        try {
          let result;
          if (item.action === 'promote') {
            const response = await fetch(`${opsUrl}/edit-projects/${encodeURIComponent(canvasId)}/edits/${encodeURIComponent(context.editId)}/promote`, {
              method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Beeftv-Agent-Token': hostToken, 'X-Desktop-Token': desktopToken, 'X-Beeftv-Agent-Turn': turn.turnId }, body: JSON.stringify(payload), signal });
            const envelope = await response.json();
            if (!response.ok || envelope.code !== 0) throw new Error(envelope.msg || 'Candidate import failed');
            result = envelope.data; turn.editRevision = result.revision;
          } else result = await request(canvasId, context.editId, item.action, payload, signal, turn.turnId);
          log.push({ toolCallId, tool: item.name, args, isError: false });
          if (item.action === 'frames') return { content: [{ type: 'text', text: JSON.stringify({ inputId: result.inputId, title: result.title, durationMs: result.durationMs, times: result.frames.map(frame => frame.time) }) },
            ...result.frames.map(frame => ({ type: 'image', data: frame.data, mimeType: frame.mimeType }))] };
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch (error) { log.push({ toolCallId, tool: item.name, isError: true, error: error.reason || 'hypit_failed' }); throw error; }
      },
    }));
  }
  return { buildTools };
}
