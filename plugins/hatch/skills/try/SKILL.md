---
name: try
description: The person tries what was built, on their own computer, before anything is shared. Triggers on "let me try it", "test it", "try it", "let me see it", "pass", "it works", "the second one didn't work", "stop the test", and on "share it" when something built has not been tried yet.
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/hatch.js" content skill try`.
If it prints an error line, show that line to the person word for word and stop.
Otherwise follow the printed instructions exactly as if they were this file.
