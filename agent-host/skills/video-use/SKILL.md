---
name: video-use
description: Analyze supplied video and audio, locate spoken or visual moments, plan conversational edits and review finished footage in BeefTV. Read transcript and actual frames on demand, then use native editing tools.
metadata:
  version: 0.1.0-beeftv.1
---

# Video Use in BeefTV

The original Browser Use Video Use suite at commit
b877063835e6ea6e457124da7e28a0ae26691dc3 is preserved in `upstream/`,
including its helpers, examples and MIT attribution. Read
`upstream/SKILL.md` for editorial reasoning and relevant helper source on demand.
The execution contract below takes precedence over upstream setup instructions.

Use the current project's referenced assets, actual ASR timestamps and real frames.
Never infer footage from its filename. Cache and reuse completed transcription;
ask for word-level output when choosing word cuts. Segment-level output must not
be represented as precise word alignment. Preserve speech with reasonable padding.
Use frame inspection for source selection and rendered-output review. Combine
visual review with the existing official HyperFrames check, timing and audio checks.

All execution uses product tools: local ASR or configured channels for recognition;
existing image/video/audio generation and asset tasks; edit_* for existing clips;
HyperFrames checked candidates for new animation; Hypit for its production workflow.
Keep editable native projects and use the existing preview/export path.
Respect the user's existing requested scope and paid-generation authorization.
Do not add a mandatory confirmation to an already authorized edit.

Use workspace_skill and workspace_run for JS/Python helpers, and workspace_install
for project dependencies. Scripts run with the current OS user's full local access
without extra approval; the cwd is a working location, not a filesystem sandbox.
Check workspace_info and actual executable availability before assuming a helper works.
Use owned product media tools or local files needed for the user's request. Preserve
source assets. Do not read application credentials, request unrelated provider keys,
start another editor or bypass the product's paid-generation approvals.
Persist reusable editorial methods and explicit user style as user Skills via
skill-creator; use durable product task records for production progress.
