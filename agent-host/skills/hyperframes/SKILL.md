---
name: hyperframes
description: Create editable HTML and GSAP video scenes, titles, motion graphics, keyframes and audio in BeefTV. Use the pinned official HyperFrames knowledge and product candidate/check/snapshot/timeline tools.
metadata:
  version: 0.8.130
---

# HyperFrames in BeefTV

This is the product entry point for the COMPLETE official skill suite at CLI 0.8.130,
commit 6791ea580c811fe3f1a532a2ced4bbed29008ee7. Its original instructions,
references, scripts and examples are preserved under `official/skills/`.
Read references on demand with the supplied `read` tool. Do not load all of them
into a turn. Read [the local execution contract](references/local-workflow.md)
before authoring. This contract overrides operational instructions in the original
suite, not its composition and motion-design knowledge.

## Knowledge routing

- Structure, timing, media, variables, nested scenes: `official/skills/hyperframes-core/SKILL.md`.
- Motion, transitions, multi-phase scenes: `official/skills/hyperframes-animation/SKILL.md`.
- Zoom/reframe/Ken Burns: `official/skills/hyperframes-keyframes/SKILL.md`.
- Gain, fades, crossfades and automation: `official/skills/hyperframes-audio/SKILL.md`.
- Typography, palette, storyboards: `official/skills/hyperframes-creative/SKILL.md`.
- Check and screenshot interpretation: `official/skills/hyperframes-cli/references/lint-validate-inspect.md`.
- Human editing semantics: `official/skills/hyperframes-studio/SKILL.md`.
- Workflow selection and remaining skills: `official/skills/hyperframes/SKILL.md`.
- All 21 skill directories, including video workflows, captions, registry, Figma
  import knowledge and migration guidance, remain in `official/skills/`.

## Local workflow

1. Call `hyperframes_context` to read the actual timeline, selection, dimensions,
   frame rate and revision. For existing clip changes use `edit_*` tools.
2. Read relevant official references. For a new scene call `hyperframes_candidate`
   with body HTML, CSS, GSAP script, duration and dimensions. This never writes
   over the live project. Iterate by creating another candidate.
3. Call `hyperframes_check` (`lint` while drafting, `check` for the final gate).
   Correct errors. `browserSkipped=true` is NOT a pass.
4. Call `hyperframes_snapshot` and inspect the returned images. A green checker
   does not prove the requested appearance.
5. Call `hyperframes_add_scene` with the exact candidate ID and placement requested
   by the user. A revision conflict preserves the candidate; never silently
   rebase or overwrite manual edits. The user can review it in the product.
6. Preview uses the already open Studio. Export only when requested, through
   `hyperframes_export`; inspect `hyperframes_exports` until complete. Undo uses
   `edit_history` and `edit_undo_entry`.

Use workspace_skill to copy helpers and workspace_run to execute JS/Python with
the current OS user's full local access; no extra script approval is required.
Use workspace_install for project dependencies and workspace_info to check tools.
The project directory is the default cwd, not an OS sandbox. Do not read credentials.
Keep the pinned CLI and native preview/export path; do not auto-upgrade, publish
to a cloud service, enable telemetry, or start another Studio. Paid media generation
continues through Seal's existing asset/generation approval tools.
Native timeline tools remain bound to the frozen current edit project.
