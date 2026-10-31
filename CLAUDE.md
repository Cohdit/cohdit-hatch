# cohdit-hatch

This repo is public. The plugin here is a thin client: code, hooks and stubs only.

- Playbooks, agent instructions, data, lessons and maintainer docs are private. They live in
  `../cohdit-access/hatch-content/` and `../cohdit-access/docs/hatch/` (start with `CONTRACTS.md` and
  `MAINTAINERS.md` there). Never copy their text into this repo: not into code, comments, tests,
  fixtures, the README or the changelog.
- "remember …" writes `../cohdit-access/hatch-content/data/lessons.json` through
  `HATCH_DEV_DIR=../cohdit-access/hatch-content node plugins/hatch/scripts/hatch.js remember …`.
  Content changes ship by deploying cohdit-access, not by releasing the plugin.
- A new skill, agent or data file: add it to cohdit-access first (file and name list), deploy, then
  the name and stub here. Removing one: here first. The contract is `../cohdit-access/docs/THIN-CLIENT.md`.
- `bash scripts/check.sh` runs everything when cohdit-access sits beside this repo, and only the code
  checks without it (as the public CI does). `scripts/ip-guard.js` fails on anything private.
- Hooks: `git config core.hooksPath .githooks` once per clone.
- Never paste a file from `~/.hatch/cache`: it carries a customer's mark.
