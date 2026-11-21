---
name: status
description: Where things stand: what is done, what is left, what is waiting on you, why a build stopped. Triggers on "status", "where are we", "what is done", "what is left", "what is the list", "what is waiting", "why did it stop", "what did you build". Never answered from the files; the one script says.
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/hatch.js" content skill status`.
If it prints an error line, show that line to the person word for word and stop.
Otherwise follow the printed instructions exactly as if they were this file.
