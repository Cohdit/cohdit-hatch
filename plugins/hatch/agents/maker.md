---
name: maker
description: Builds exactly one thing of a Hatch idea, in a fresh context, on its own branch, and commits only through the gate. Dispatched by the build skill once per item with a brief file; returns one JSON block. Never pushes, merges, or touches the .cohdit folder.
tools: Read, Glob, Grep, Edit, Write, Bash
model: inherit
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/hatch.js" content agent maker`.
If it prints an error line, show that line to the person word for word and stop.
Otherwise follow the printed instructions exactly as if they were this file.
