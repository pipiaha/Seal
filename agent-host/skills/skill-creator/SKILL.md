---
name: skill-creator
description: Create, update and refine local user Skills in BeefTV, including reusable production methods and explicitly requested personal style. Use actual successful work and supplied preferences; preserve task scope.
metadata:
  version: 1.0.0-beeftv.1
---

# Skill Creator in BeefTV

Read `upstream/SKILL.md` for the original skill-creator writing and organization
workflow. The original instructions, references, scripts and Apache-2.0 license
are preserved in `upstream/`. This product execution contract overrides its
Codex-specific paths, initialization commands and UI metadata instructions.

Create or update a user Skill through the product Skill tools and Skill Hub.
Do not write to Codex's global skill directories or alter runtime builtins.
Supply SKILL.md with a concise name, description and relevant instructions.
Add references/examples only when they serve a concrete recurring task.
Prefer updating the relevant existing user Skill over duplicate skill creation.

When the user asks to remember a production method or recurring personal style,
preserve its intended content type and scope. A one-project edit is not a universal
preference. Parameterize asset references, text, dimensions and timing; never embed
private credentials, machine paths or one task's resource IDs as reusable constants.
Keep source evidence and verification status honest. Format validation does not
prove behavioral quality; do not label an untested workflow as verified.

Use inspect/validate before saving, preserve old versions and require the expected
version for updates. Saved changes load on the next conversation turn through the
existing immutable Skill snapshot; a task already running keeps its original copy.
Copy enabled helpers with workspace_skill, then use workspace_run for JS/Python
and workspace_install for project dependencies. Scripts use the current OS user's
full local file/network access without extra script approval. Check actual runtime
availability; report missing capabilities rather than inventing a successful run.
Respect the user's task scope and product paid-generation approvals. Never persist
application credentials or claim the working directory is a security sandbox.
