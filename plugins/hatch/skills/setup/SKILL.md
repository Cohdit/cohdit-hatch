---
name: setup
description: Get this computer ready for Hatch. Triggers on "set me up", "get started", "is everything ready", "fix my setup", "continue" after a setup stopped, and on the first "I have an idea" on a computer that has never been checked. Also handles "talk to me like a developer / a product person / plainly".
---

First run `node "${CLAUDE_PLUGIN_ROOT}/scripts/hatch.js" key status`. If it prints `missing` or `bad_key`,
ask the person to paste the access key from their welcome page, and tell them the key is stored on this
computer only. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/hatch.js" key set <the key>`. If it prints an
error line, show that line word for word and ask again. Continue only once it prints `ok`.

Then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/hatch.js" content skill setup`.
If it prints an error line, show that line to the person word for word and stop.
Otherwise follow the printed instructions exactly as if they were this file.
