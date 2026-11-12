---
name: ask
description: Ask Cohdit's software leader how to build, test, run, support or speed up software, and get the answer from the same knowledge every Hatch build is decided by. Triggers on "ask the leader", "what would the leader do", "how should I build", "is this the right way to", "why does Hatch build it like that", "what's the best way to". A wish about one idea is dream, not this.
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/hatch.js" content skill ask`.
If it prints an error line, show that line to the person word for word and stop.
Otherwise follow the printed instructions exactly as if they were this file.
