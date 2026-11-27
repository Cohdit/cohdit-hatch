---
name: runner
description: Drives exactly one thing of a Hatch idea from its pick to the script's decision, in a fresh context. Dispatched by the build skill once per lane per round; calls the script, dispatches the maker and the lenses, passes their reports, and returns the script's output. Builds, reviews and edits nothing.
tools: Agent, Read, Bash
model: claude-sonnet-5-5
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/hatch.js" content agent runner`.
If it prints an error line, show that line to the person word for word and stop.
Otherwise follow the printed instructions exactly as if they were this file.
