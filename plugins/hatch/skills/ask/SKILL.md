---
name: ask
description: Ask one of your knowledge agents (the software leader, when you have it: how to build, test, run, support or speed up software, from the same knowledge your builds are decided by), or try an agent with free questions. Triggers on "ask the leader", "what would the leader do", "how should I build", "is this the right way to", "why does Hatch build it like that", "what's the best way to", "ask the <name> agent", "what agents are there", "add the <name> agent", "manage my agents", "cancel an agent". A wish about one idea is dream, not this.
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/hatch.js" content skill ask`.
If it prints an error line, show that line to the person word for word and stop.
Otherwise follow the printed instructions exactly as if they were this file.
