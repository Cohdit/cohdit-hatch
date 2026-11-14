---
name: fix
description: File a bug, or find what is wrong before anyone else does. Files a bug the person describes onto the list in their words, one per problem; pulls the problems people reported from the live app; sets the four lenses (bugs, security, cost, privacy) over the whole project. Fixes nothing: "fix all" does. Triggers on "bug: <what is wrong>", "file a bug", "log a bug", "there's a bug", "I found a bug", "this is broken", "add a bug", "scan it", "check for problems", "anything wrong?", "is it safe", "scan it every week", "stop the weekly check", "is a scan due".
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/hatch.js" content skill fix`.
If it prints an error line, show that line to the person word for word and stop.
Otherwise follow the printed instructions exactly as if they were this file.
