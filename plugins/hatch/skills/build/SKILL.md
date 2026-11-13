---
name: build
description: Build the agreed idea, unattended. Triggers on "build it", "build", "build all", "build 3" (any number), "keep building", "build the next thing", "build <idea name>", "continue" after a build stopped, and "fix all", "fix 3 bugs", "fix it" once bugs are on the list. Ends by pointing at try, never at share.
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/hatch.js" content skill build`.
If it prints an error line, show that line to the person word for word and stop.
Otherwise follow the printed instructions exactly as if they were this file.
