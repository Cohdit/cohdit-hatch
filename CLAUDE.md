# cohdit-hatch

This repo is public. The plugin here is a thin client: code, hooks and stubs only.

Five repos sit side by side in this folder; work from here and `bash scripts/repos.sh` shows all of them
(branch, uncommitted, unpushed, unmerged). Why they are split, which repo owns which change and how
knowledge reaches users: `../cohdit-hatch-private/docs/ARCHITECTURE.md` (read it before a cross-repo change).

Plan and work all of Hatch from here. Until ITEM-001 in that backlog is Done, nothing is deployed: a content or knowledge push reaches no user yet. The one backlog is `../cohdit-hatch-private/tasks/BACKLOG.md` (private); each item's
`Repo:` says which repo to edit, so a change is never made in the wrong folder.

- `cohdit-hatch` (this): code, hooks, stubs. Released as a plugin version.
- `cohdit-hatch-private`: **all** Hatch content and docs (playbooks, agents, data, lessons, maintainer docs). Deploys the
  content service on its own; users have a change in about 10 minutes.
- `cohdit-access`: the site, keys, subscriptions and the API that fetches the content. Holds none of it.
- `cohdit-knowledge-software-leader`: the owner's knowledge as atoms; confirmed ones become lessons on a push.
- `cohdit-knowlege-interviewer`: tools that validate and export the atoms (the spelling is the real one).
  **Left alone by default:** the two knowledge repos are edited only from their own sessions, never from Hatch work. Read them, never write them; do not add their changes to a Hatch plan.

- Playbooks, agent instructions, data, lessons and maintainer docs are private. They live in
  `../cohdit-hatch-private/hatch-content/` and `../cohdit-hatch-private/docs/` (start with `CONTRACTS.md` and
  `MAINTAINERS.md`). Never copy their text into this repo: not into code, comments, tests,
  fixtures, the README or the changelog.
- "remember …" is a Hatch lesson, owned by the knowledge repo. From here: draft the atom and hand it to the owner to add
  from a knowledge session. Never write it into the knowledge repo, and never hand-edit `lessons.json`.
  Content changes ship by deploying cohdit-hatch-private, not by releasing the plugin.
- A new skill, agent or data file: add it to cohdit-hatch-private first (file and `manifest.json`), deploy, then
  the name and stub here. Removing one: here first. The contract is `../cohdit-access/docs/THIN-CLIENT.md`.
- `bash scripts/check.sh` runs everything when cohdit-hatch-private sits beside this repo, and only the code
  checks without it (as the public CI does). `scripts/ip-guard.js` fails on anything private.
- Hooks: `git config core.hooksPath .githooks` once per clone.
- Never paste a file from `~/.hatch/cache`: it carries a customer's mark.
