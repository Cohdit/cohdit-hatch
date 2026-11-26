---
name: mock
description: Draw the agreed idea as a clickable mock-up of every screen, before anything is built, and change it until the person signs it off; also for a later change big enough to see first. Triggers on "show me the mock-up", "show me the mock", "let me see what it will look like", "change the mock-up", "that's it" or "sign it off" while a mock-up is open, "skip the mock", and straight after an idea is agreed.
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/hatch.js" content skill mock`.
If it prints an error line, show that line to the person word for word and stop.
Otherwise follow the printed instructions exactly as if they were this file.
