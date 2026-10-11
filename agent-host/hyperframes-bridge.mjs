import crypto from 'node:crypto';
import { toolOperationId } from './session-identity.mjs';
import { budgetError, spendToolStep } from './request-budget.mjs';

export function createHyperframesBridge({ opsUrl, hostToken, desktopToken, turnBudgetContext, readOnly = false }) {
  const candidateId = { type: 'string' };
  const definitions = [
    { name: 'hyperframes_context', action: 'hyperframes/context', readOnly: true, properties: {}, description: 'Read the current edit timeline, selection, canvas dimensions, fps and source revision before authoring. Only the frozen current edit is accessible.' },
    { name: 'hyperframes_candidate', action: 'hyperframes/candidate', properties: {
      html: { type: 'string', description: 'Body markup only, no scripts/styles/embedded documents. Use local assets.' },
      css: { type: 'string', description: 'Scene CSS; the runtime scopes selectors to this mount.' },
      script: { type: 'string', description: 'Scoped DOM/GSAP JavaScript defining const tl = gsap.timeline({paused:true}). The runtime registers it. No timers, network, global registry or host APIs.' },
      duration: { type: 'number' }, width: { type: 'integer' }, height: { type: 'integer' }, fps: { type: 'integer' },
      assets: { type: 'array', items: { type: 'object', properties: { source: { type: 'string' }, path: { type: 'string' } }, required: ['source', 'path'], additionalProperties: false } },
    }, required: ['html', 'script', 'duration', 'width', 'height'], description: 'Create an immutable native HyperFrames candidate at the last read revision. Live timeline is unchanged. Local asset bindings copy files from this editing project. Iterate with another candidate.' },
    { name: 'hyperframes_candidates', action: 'hyperframes/candidates', readOnly: true, properties: {}, description: 'List saved scene candidates, including candidates preserved after a conflict.' },
    { name: 'hyperframes_check', action: 'hyperframes/inspect', properties: { candidateId, command: { type: 'string', enum: ['lint', 'check'] } }, required: ['candidateId', 'command'], description: 'Run bundled official CLI 0.8.130 on an isolated, mounted candidate. lint is drafting feedback; final check must have ok=true and browserSkipped=false. Returns real findings and screenshots. No shell or arbitrary CLI flags.' },
    { name: 'hyperframes_snapshot', action: 'hyperframes/inspect', command: 'snapshot', properties: { candidateId }, required: ['candidateId'], description: 'Capture five actual candidate frames with the pinned official CLI and return PNG images for visual review.' },
    { name: 'hyperframes_add_scene', action: 'promote', properties: { candidateId, start: { type: 'number' }, track: { type: 'integer' }, append: { type: 'boolean' }, replaceSceneId: { type: 'string' } }, required: ['candidateId'], description: 'Add a checked candidate to the native timeline at its original base revision. Uses native history/undo. Replace only when requested with an exact existing clip ID. Conflict preserves the candidate; never force-rebase.' },
    { name: 'hyperframes_import_asset', action: 'assets/import', properties: { assetId: { type: 'string' } }, required: ['assetId'], description: 'Import any current-user-owned saved asset into this edit project. Find its ID through assets_search or existing references; no prior conversation attachment is required. Returns native clip and local source; read it before binding a scene.' },
    { name: 'hyperframes_export', action: 'hyperframes/export', properties: { fps: { type: 'integer' }, quality: { type: 'string', enum: ['draft', 'standard', 'high'] } }, description: 'When the user requests export, start the existing native export task with frozen source, using the last read revision. Returns job and export IDs; poll hyperframes_exports. This is not an immediate finished video.' },
    { name: 'hyperframes_exports', action: 'hyperframes/exports', readOnly: true, properties: {}, description: 'Read persisted export status and progress for this project. Completed exports appear in the normal product download/asset-import list.' },
  ];
  return {
    buildTools(canvasId, log, generation, turn, identityPrefix) {
      return definitions.filter(item => !readOnly || item.readOnly).map(item => ({
        name: item.name, label: item.name, description: item.description, executionMode: 'sequential',
        parameters: { type: 'object', properties: item.properties, required: item.required || [], additionalProperties: false },
        execute: async (toolCallId, args, signal) => {
          const context = turn.workspaceContext;
          if (context?.mode !== 'edit' || context.projectId !== canvasId) throw new Error('edit_scope_required');
          if (!turn.skillSnapshot?.skills.some(skill => skill.name === 'hyperframes' && skill.version === '0.8.130')) throw new Error('hyperframes_skill_disabled_or_version_mismatch');
          if (generation.aborted || signal?.aborted) throw new Error('aborted');
          if (!item.readOnly && !toolCallId) throw new Error('missing_tool_call_id');
          const step = spendToolStep(turnBudgetContext.getStore());
          if (!step.allowed) throw budgetError(step);
          const payload = { ...args, ...(item.command ? { command: item.command } : {}),
            ...(!item.readOnly ? { operationId: crypto.createHash('sha256').update(toolOperationId(identityPrefix, toolCallId)).digest('hex') } : {}),
            ...(item.name === 'hyperframes_candidate' ? { baseRevision: turn.editRevision ?? context.revision } : {}),
            ...(['hyperframes_export', 'hyperframes_import_asset'].includes(item.name) ? { expectedRevision: turn.editRevision ?? context.revision } : {}) };
          try {
            const response = await fetch(`${opsUrl}/edit-projects/${encodeURIComponent(canvasId)}/edits/${encodeURIComponent(context.editId)}/${item.action}`, {
              method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Beeftv-Agent-Token': hostToken,
                'X-Desktop-Token': desktopToken, 'X-Beeftv-Agent-Turn': turn.turnId }, body: JSON.stringify(payload), signal,
            });
            const envelope = await response.json();
            if (!response.ok || envelope.code !== 0) throw Object.assign(new Error(envelope.msg || 'HyperFrames operation failed'), { reason: envelope.reason });
            const data = envelope.data;
            const images = Array.isArray(data?.images) ? data.images : [];
            const result = Array.isArray(data) ? data : Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'images'));
            if (Number.isSafeInteger(result.revision)) turn.editRevision = result.revision;
            log.push({ toolCallId, tool: item.name, args, isError: false });
            return { content: [{ type: 'text', text: JSON.stringify(result) }, ...images.map(image => ({ type: 'image', data: image.data, mimeType: image.mimeType }))] };
          } catch (error) { log.push({ toolCallId, tool: item.name, isError: true, error: error.reason || 'hyperframes_failed' }); throw error; }
        },
      }));
    },
  };
}
