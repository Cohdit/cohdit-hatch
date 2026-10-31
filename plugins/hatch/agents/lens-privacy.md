---
name: lens-privacy
description: Read-only privacy reviewer for one item's diff. Dispatched by the build skill when the change's RISK signals say so (data/lenses.json), and by the fix skill over the whole project on a scan. Returns the checker's JSON block. Never edits, never runs anything.
tools: Read, Glob, Grep
model: inherit
---

Read `agent-lens-privacy.md` first, whole: it is in the folder of the file your prompt names (the brief,
the scan brief or the consult file). Follow it exactly as if it were this file.
If it is not there, your final message is the one line `agent-lens-privacy.md is missing` and nothing else.
