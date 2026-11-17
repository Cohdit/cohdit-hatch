# cohdit-hatch

This repo is public. The plugin here is a thin client: code, hooks and stubs only.

Repos sit side by side in this folder; work from here and `bash scripts/repos.sh` shows all of them
(branch, uncommitted, unpushed, unmerged). Why they are split, which repo owns which change and how
content reaches users: `../hatch-private/docs/ARCHITECTURE.md` (read it before a cross-repo change).

Plan and work all of Hatch from here. Content is live from hatch-private's service, but its `publish` pipeline waits on ITEM-001: until then a content change ships only by `vercel deploy --prod` there. The one backlog is `../hatch-private/tasks/BACKLOG.md` (private); each item's
`Repo:` says which repo to edit, so a change is never made in the wrong folder.

- `cohdit-hatch` (this): code, hooks, stubs. Released as a plugin version.
- `hatch-private`: **all of Hatch's own** content and docs (playbooks, agent instructions, rule files, Hatch's lessons, the
  charter, maintainer docs). Deploys Hatch's content service on its own; users have a change in about 10 minutes.
- `cohdit-access`: the site, keys, subscriptions and the API that fetches the content. Holds none of it.
- `cohdit-expertise`: **Ten Years only**: the knowledge agents (software builder, software leader, domain agents), their packs and the
  sync from the knowledge repos. Hatch reads an agent a person owns through the API and holds none of it. Edited from its own session.
- `cohdit-knowledge-*` and `cohdit-knowlege-interviewer` (the spelling is the real one): the owner's knowledge as atoms and its tools.
  **Left alone by default:** edited only from their own sessions, never from Hatch work. Read them, never write them; do not add their changes to a Hatch plan.

- Playbooks, agent instructions, data, lessons and maintainer docs are private. They live in
  `../hatch-private/hatch-content/` and `../hatch-private/docs/` (start with `CHARTER.md`, `CONTRACTS.md` and
  `MAINTAINERS.md`). Never copy their text into this repo: not into code, comments, tests,
  fixtures, the README or the changelog.
- "remember …" is a Hatch lesson and Hatch's own: `remember` writes `../hatch-private/hatch-content/data/lessons.json` when
  `HATCH_DEV_DIR` points there. Keep lessons generic and about process; engineering, leadership and domain judgement belong to the
  Ten Years agents and are never copied into Hatch. Content changes ship by deploying hatch-private, not by releasing the plugin.
- A new skill, agent or data file: add it to hatch-private first (file and `manifest.json`), deploy, then
  the name and stub here. Removing one: here first. The contract is `../cohdit-access/docs/THIN-CLIENT.md`.
- `bash scripts/check.sh` runs everything when hatch-private sits beside this repo, and only the code
  checks without it (as the public CI does). `scripts/ip-guard.js` fails on anything private.
- Hooks: `git config core.hooksPath .githooks` once per clone.
- Never paste a file from `~/.hatch/cache`: it carries a customer's mark.
