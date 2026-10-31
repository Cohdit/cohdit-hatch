---
name: fix
description: Find what is wrong before anyone else does. Pulls the problems people reported from the live app onto the list, then sets the four lenses (bugs, security, cost, privacy) over the whole project; what they find joins the list, and "build it" fixes it. Triggers on "fix the bugs", "scan it", "check for problems", "anything wrong?", "is it safe", "fix the bugs every week", "stop the weekly check", "is a check due".
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/hatch.js" content skill fix`.
If it prints an error line, show that line to the person word for word and stop.
Otherwise follow the printed instructions exactly as if they were this file.
