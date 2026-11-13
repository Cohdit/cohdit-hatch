# Changelog

## 0.0.15 — up to three makers at once (2026-11-13)

- "Build it" runs up to three makers at once (`caps.lanes`, default 3, never more), one thing each,
  never more than there is to build. The lead is the project folder; the others are lanes: side copies
  under `~/Hatch/.work` with their packages installed, opened by `build open` (`lanes=` on stderr).
- One run, one digest: every lane writes the same run, and only the lead saves the ledger.
- Finished things reach main one at a time through the gate: replayed onto the current main, checked
  again, pushed only as a fast-forward.
- A clash there (the same lines, or checks that fail combined) builds the thing again once on the
  current main, its first version kept and handed to the maker, and the run drops to one lane.
- `build next` may answer `next=wait` (a lane sits out a round while others finish what it needs);
  `build narrow` drops to one lane by hand (used when Claude's usage limit stops an agent).
- Caps (things per run, budget) count the whole run. Without a shared copy on GitHub, one lane.
- Usage is matched to the thing a prompt names before the folder's branch, so each lane is charged its own.
- Content: deploy the new build playbook with this release. It also works with an older plugin (no
  `lanes=` means one lane).

## 0.0.14 — the software leader decides (2026-11-13)

- Builds are decided against the software leader: the owner's whole knowledge, fetched from Cohdit as
  data `leader` (values, trade-off calls, limits, every rule by area).
- Every maker brief carries `## How Cohdit decides` (the values and calls), before the lessons.
- The advisor carries all of it and answers as the leader. The checker and each lens carry the rules of
  their own areas, on a build and on a scan.
- `hatch.js leader [--for <reader>]` prints it; the new `ask` skill uses it to answer the person's own
  questions about building software. The interview reads its part when shaping the first version.
- Nothing breaks without it: when the leader cannot be fetched, the sections are left out.
- Order: deploy the content first (it adds `ask` and `leader`), then release this plugin.

## 0.0.13 — the try list is short (2026-11-12)

- The try standard, at every level: each thing on the list is a short title (48 characters at most;
  the tech level adds its id) and one line of how to try it, at most 100 characters. The line is the
  first sentence of the maker's note that is not about wording, else the first check. Before this,
  every check and the maker's whole note were printed, and a list of nine things ran to a page.
- A maker that drafted wording sets `words: true` in its report; the list names those things once, in
  one line at the end. An older note that says so in its own words counts too.
- A bug from a report is titled with the first sentence of what the person saw, cut to 60 characters,
  not the first 80 characters of a pasted error. Their words stay whole in the bug's check.
- Content must be deployed after this release: the maker's instructions now ask for a one-sentence
  `try_note` and `words: true`.

## 0.0.12 — builds start from this computer; reshaped lists keep clean ids; work is never deleted (2026-11-11)

- `build next` starts each thing from this computer's main line. Commits the person made and never pushed
  (a reshaped list, say) are pushed first. Before this, the build started from the GitHub copy and could
  pick up an old list.
- After `idea reopen`, a reshaped list never reuses an id the ledger has seen. A thing sent back unchanged
  (same title and checks) keeps its id and history; everything else gets a new id. Before this, the new
  ITEM-001 to ITEM-003 inherited the old ones' set-aside marks. `idea change` and reported bugs take the
  next free id too.
- A maker's report is no longer refused over a side note: a test path, finding, decision or try note
  that does not fit is left out and named on stderr. A bad decision type was the last such refusal.
- A thing set aside after its work was committed keeps that work on `kept/<branch>`, here and on GitHub
  (hint `kept=`). Before this, the branch was deleted.

## 0.0.11 — agreed ideas can change; maker reports are forgiven (2026-11-08)

- `idea change` adds to, edits or records decisions on an agreed idea without a second yes; `idea reopen`
  sends it back to the interview. Anything else on an agreed idea is refused with `reagree`.
- A maker's report is normalised instead of refused: a test path may contain `[id]` and `(group)`
  (Next.js routes), several test files keep the first, and a long decision choice becomes a short slug.
  The brief now states these limits. Before this, a finished thing could be set aside for its report alone.
- The fixtures check compares files, not empty folders, so it passes on a fresh checkout.
- Content must be deployed after this release: the new playbook text calls `idea change` and `idea reopen`.

## 0.0.10 — the thin client (2026-10-31)

Hatch becomes a thin plugin: its playbooks, agent briefs and data come from Cohdit at run time with the
person's access key (the site repo's `docs/THIN-CLIENT.md` is the contract).

- `scripts/lib/api.js`: `fetchContent`, a cache at `~/.hatch/cache` (fresh for 10 minutes, served for 24
  hours when Cohdit cannot answer, never after a 401, 403 or 404, all of it deleted on a 403), `setKey`, `keyStatus`,
  and `HATCH_DEV_DIR` to read the content from a folder instead.
- `hatch.js content skill|agent|data <name>` prints the text with the plugin's path filled in, or one
  line for the person and exit 1. `hatch.js key set <key>` and `key status`; neither prints the key.
- Every skill and the maker are their frontmatter and a three-line stub that fetches the playbook. The
  setup stub asks for the key first: without one it could not fetch its own playbook.
- Every data reader goes through the client. Each script loads the data once at its start; the usage
  hook stays silent when it cannot.
- A hung Cohdit costs one wait: a request with a cached copy to fall back on gives up after 5 seconds,
  and for a minute after a failure the cache is served without asking.
- The six read-only agents are stubs too. They have no Bash, so `build` and `fix` fetch their bodies and
  write `agent-<name>.md` beside the brief, with the rules they check; `roles=` names the folder.
- The suite passes with `data/` removed and the content fetched with a key (`H.ready()` loads it for
  in-process tests).
- `data/` is still in the plugin until the end-to-end test passes; `remember` writes the bank in the
  content folder (`HATCH_DEV_DIR`).
- `check.sh` runs the playbook and data checks against `HATCH_DEV_DIR`, defaulting to the sibling site
  repo's `hatch-content/` and skipping the playbook checks without it.

## 0.0.9 — the owner's lessons, four lenses, the fix run (2026-10-29)

Delon's lessons on building software (L-001 to L-019, `data/lessons.json`, said with "remember …") and
the five changes that make them true in the run rather than stated.

- `hatch.js remember add | set | drop | list | show`, `lib/lessons.js`, the `remember` skill: one lesson
  per call, a gist under 180 characters, readers (maker, checker, dream, maintainer), tags that make it
  ride only with a thing whose own words carry one, a cap of 24 per reader per brief. Every maker brief
  carries a `## Lessons` section; the interview reads its own.
- The gate enforces the pyramid and the 80% floor: the scaffold adds `@vitest/coverage-v8`, `npm test`
  writes `coverage/coverage-summary.json`, `config.json` gets `coverage_min: 80`, and `build commit`
  refuses under it with the lower of lines and branches (`VERIFY.cov`). The maker names the test that
  proves each check (`criteria[].test`).
- Four lenses at the gate (`data/lenses.json`): `checker` (bugs), `lens-security`, `lens-privacy`,
  `lens-cost`, dispatched at once by the build skill after the maker's report, chosen by the risk
  signals (the change kind, dependencies, the rules attached as personal | money | uploads | messaging |
  content, paid packages, secrets, the network); a low-risk change still goes straight to the gate.
  `build checked <ITEM> --agent <lens>`; one `REVIEW{agent}` and `RETURN` per lens; the gate waits for the
  last; every must-fix reaches the maker's brief with its lens named.
- The advisor: the maker may return `verdict: consult` once per thing with a role (architect, tester,
  analyst, owner, security, privacy, cost) and a question; `hatch:advisor` answers from a consult file;
  `build advised` puts the answer in the brief and the maker carries on (`ROUND{cause:consult}`). A
  second question is `BLOCKED{ambiguous}`.
- The fix run: `hatch.js fix open | found | close | every | due`, `report add | pull`, the `fix` skill.
  Reports from the scaffold's `/report` page (saved to a private blob store in production, made by share;
  to `.cohdit/reports/` on the person's computer) and the four lenses over the whole project become
  bugs on the list (`kind: bug`, appended, never re-numbering); "build it" fixes them from a brief that
  says so, failing test first. `fix every <days>` is the person's schedule; `build open` says when a
  check is due.
- Roles: each skill names the hats it wears; every item carries which lens raised it (`lens: product |
  technical`).

## 0.0.8 — share it (2026-10-28)

The one yes and the deploy, built after a fifth five-persona simulation (page: Share It, Five Ways) and
five rulings, all as recommended: one line before the yes, printed by the script, naming the likely
address and what becomes public (the app; the code and anything typed into it stay in the person's
accounts); no extra warning when a gate is on; nothing asked about who gets the link first, the digest
says it; a failed publish is one stop with the build log and the next phrase, never a second attempt in
the run; share stops on changes Hatch did not make, as build does.

- `scripts/lib/share.js` and `hatch.js share open | go | wait | later`: the gate (a live build, nothing
  built, something untried hands off to try, a dirty tree, the publishing tool and its sign-in, team
  membership), the run, the question once per project (`DECIDE publish live`; a no is `not_yet` and the
  question returns), one production deploy through the tool with `--create-if-missing` (the only
  non-interactive way to make a project; it links the folder too), `DEPLOY building`, a bounded wait
  (eight minutes, repeatable with `wait`, so no call runs past Claude Code's limit), `DEPLOY ready` and
  `URL_SHARED` with the production address, or the build log as the blob and `STOP connector`. The
  project is named after the GitHub copy, suffixed only when that name is taken in the person's scope,
  and recorded in `config.json` `connectors.vercel` so a second computer deploys to the same project
  without a `.vercel` folder. The deployment's own address, protected by default, is never handed back.
- The share digest: the Live line, "Still to check at that link" for device checks, "Not fixed yet" for a
  thing whose try failed and is not rebuilt, "Something wrong? Say "let me try it"", the retry phrase
  after a failed publish, "Say "share it" when you're ready" after a no. Fixtures `shared` and `declined`
  with goldens for every view; the publish decision's templates branch on the choice (a no used to
  render as "Publish approved."); `URL_SHARED` plain says "send it to whoever should try it first".
- Team hosting made real: `doctor.probe` knows `vercel_team` and `gh_org` (they threw "unknown
  capability" before), `idea agree --hosting team --team <slug>` writes the scope (it used to copy the
  placeholder "<team slug from the tool's list>" into config), share passes `--scope`.
- `.vercelignore` (`.cohdit`, `.env`, `.env.*`) in the scaffold and written by share when missing: the
  ledger and any secrets file never travel with a deploy (the tool reads no `.gitignore` and its default
  list skips `.env.local` only). usage.js resets its checkpoint on `share open`; the permission hook adds
  `--session` to share calls. `build.js stopBefore` takes lead records, so a stop can carry its CHECK.
- `skills/share/SKILL.md`: the walk, the yes or no in the person's words, the handoff to try, three fixed
  answers, the public address only. Docs: CONTRACTS § Share, Connectors, Hosting, footprint.
- Second pass, a fresh-eyes review: `go` checks the tree again at the moment of the deploy (a change made
  after the question used to be uploaded with the yes); the wait is bounded (two unreadable answers or
  four waits end the run with the tool's words, where a deleted deployment used to loop for a day); every
  address from the tool gets its scheme before it reaches the ledger (a bare one would have wedged the run
  on validation); `go` waits only for the minutes the call has left; a share run left open by an
  unanswered question is closed by a stop, by `build open` and by `try start`, never reported as a crash;
  `share open` leaves main alone while a try is live; the `.vercelignore` commit is checked and undone
  when it cannot land; `--team` is refused with any hosting but team, and `setup` names the teams the
  person is on (`teams=`) so dream offers one only when the tool lists it; the tool out of reach is
  `STOP{offline, name:vercel}` with its own words, not "Publishing failed"; a dirty-tree stop's blob is
  flushed into the ledger (build's too).

## 0.0.7 — let me try it (2026-10-28)

The hands-on test between build and share, built after a fourth five-persona simulation (page: Let Me
Try It, Five Ways) and five rulings, all as recommended: a failure lives in the ledger and reaches the
maker's brief, the checks stay as the interview wrote them; device checks are on the list with the
same-wifi address and never block share; the person talks and the script takes a number, an id or a
title; "pass" ends the try pointing at share, any fail points it at build; share goes ahead after a
fail and names the thing.

- `scripts/lib/try.js` and `hatch.js try start | result | pass | stop`: the folder brought up to date
  when that is safe, the packages installed when the copy never had them, the app started from
  `stack.json` `scaffold.dev` on the first free port (free means nothing answers on it, on either
  loopback address: a bind check alone missed a dev server of the person's own on `*:3000`), the
  browser opened, `TRY_START` with the list frozen in the idea's order, `TRY_RESULT` per thing with the
  person's words as the blob, the app stopped with the run, the ledger landed at every verdict. A try
  that died with the lid is picked up under the same run with the same numbers; one older than a day is
  closed as crashed; `build open` ends a live try first and `try start` refuses while a build is live.
- One status rule for everything: `lib/ledger.js itemStatus`, used by `render.js`, build and try.
  `TRY_RESULT{pass}` → tried, `TRY_RESULT{fail}` → queued again (the next build picks it and its brief
  carries "When they tried it"), a pick lapses with its run. Before this, render.js and build.js each
  derived status and already disagreed on a lapsed pick; a try result changed nothing anywhere, so a
  passed thing stayed "to try" forever and a failed one was never rebuilt.
- `render.js checklist`: the live try's address and the things left, numbered as the try numbered
  them, each with its checks verbatim and the maker's note (`.cohdit/notes/ITEM.txt`, written since
  0.0.6 and never read until now); a device check carries the same-wifi address. The try digest:
  "Tried N things: M worked, K didn't." with one line per fail and the next step. `TRY_RESULT` no longer
  says "You failed"; `STOP{app}` when the app would not start; status says "waiting for you to try it"
  during a try; the read-back says a device check is "checked when you try it".
- `lib/tools.js`: `openUrl` and `stopProcess`, the two platform facts try needs, in the one file allowed
  to know them. `usage.js` resets its checkpoint on `try start` too. The permission hook adds
  `--session` to try calls as well. Fixtures `tried` and `trying` with goldens for every view.
- `skills/try/SKILL.md`: the walk, the one allowed question ("Which one?"), the stdin shape, ends where
  the script says.
- Docs: CONTRACTS § Try and the status rule; the footprint table no longer claims build writes item
  status into spec.json (it never did; § Build said so); stale `step.js` names replaced.
- Second pass, two fresh-eyes reviews: the try's "app would not start" stop was recorded as a build run
  (`stopBefore` now takes the skill) and its details never reached the ledger (flushed and committed);
  a pid is trusted or stopped only within the boot it was started in, so a reboot never kills a
  stranger's process; the app's pid and port are saved before the wait, so a cut-off call leaves no
  orphan; a quiet try is live for a day, not twenty minutes; another computer's crashed try never shows
  as this one's list; `try start` over a paused build says so, and over a day-old one closes it first
  (`build.js abandon`, shared with `build open`); the same-wifi address is the default route's, never a
  link-local one; a resumed try in a new window gets its own usage pointer; "stop" with things
  unanswered points at trying again, not share; the "allow connections" line comes from the script.

## 0.0.6 — build it (2026-10-27)

The unattended run, built after a third five-persona simulation and five rulings (all as recommended):
a scoped permission hook so nobody is asked anything during a build; build touches GitHub only; "build
it" builds the whole first version; the maker drafts words and takes small choices instead of parking;
the gate is `build commit`.

- `scripts/lib/build.js` and `hatch.js build open | next | verify | commit | add | built | checked | close`:
  the run in the project ledger, the skeleton from `stack.json` `scaffold` on the first run, a private
  GitHub repository named after the idea (taken names get `-2`), one fresh maker per thing on `item/NNN`,
  the gate (verify, then commit only on pass), the risk tier from the diff, the checker when it warrants
  it, fix rounds with a hard limit, fast-forward merge, push, `DONE`. Resumes a run under 24 hours old
  and continues a half-built thing on its branch. Device checks are never dispatched.
- `agents/maker.md`, `agents/checker.md`: one page each. The maker's shell is three hatch.js commands;
  the checker is read-only and gets the diff as a file. The maker's report gains `refused`, `decisions`
  and `try_note`.
- `hooks/hooks.json` PreToolUse → `hatch.js allow`: approves one plain call of hatch.js, or an edit inside
  a folder Hatch created; nothing else, and deny rules still win. Nothing written to the person's settings.
- `usage.js`: recognises hatch.js calls and finds a build started from another folder through
  `~/.cohdit/active.<session>.json` (one pointer per session, `active.json` without one), so tokens are
  measured (they were not) and each session pays for its own run.
- Second pass, 2026-10-27, two fresh-eyes reviews of the build code found 24 defects; the ones that would
  have broken the first real run: the hook put `--session` before the verb, so every build call failed
  (`build` now takes the flag anywhere, the hook adds it after the verb); the hook approved anything
  written after a heredoc operator and `$(…)` inside double quotes (now refused; stdin is one quoted
  heredoc, spelled out in the skill); a side copy lost its ledger when a push lost its lease (each side
  copy now works on its own branch and replays); a claim was stale the moment it was made when main's tip
  was a day old (claims now open with a dated start commit); a run that died after picking left the item
  "building" forever (a pick lapses with its run); the maker's uncommitted edits broke the set-aside and
  leaked into the next thing or were blamed on the person (the tree is reset when an item ends; a crashed
  run's leftovers are Hatch's); "continue" in a second window opened a third copy (it finds its own); a
  claim push failing for a network reason ended the run silently (`STOP{offline}`); a done report with an
  unmet check gated as done (set aside); the GitHub repository was never retried after a run started
  signed out; the scaffold staged across volumes; a report in the wrong phase was taken twice. A
  verification pass over those fixes caught one regression of their own before it shipped: a changed
  tracked file under `.cohdit/` (the state every first run is in after the repository is created) made
  the main-line rebase refuse silently, and the next ledger push would have overwritten the shared main
  under a lease that still held. Every push of main is now refused locally unless it is a fast-forward;
  rebases autostash; a side copy that cannot land at close is kept and landed by the next open.
- `render.js`: the build digest ends "Next: say "let me try it"…" (it pointed at share), names the GitHub
  copy, shows a device check as "to check"; status lists done-but-untried things under waiting on you;
  tech digest, status and why are sentences (key=value stays in the events view).
- `stack.json`: the npm packages each option may bring in (`build add` refuses the rest) and the pinned
  scaffold command; `rails.json` carries the refusal clause for the installed plugin (lint: same as
  CONTRACTS). Caps default `items_per_run 8`.
- Many sessions, many computers, one idea (Delon: scaling is Hatch's problem, never the person's).
  Claims are item branches on the shared copy pushed with a lease; stale claims (a day) are taken over;
  the gate fetches, rebases onto the shared main, checks again and pushes with a lease; item status is
  derived from the ledger, so records never conflict; a second session on the same computer gets a side
  working copy (the permission hook passes the session id); "build <name>" fetches an idea this computer
  never saw from the person's GitHub account by topic. Nothing of it is named to the person.
- `skills/build/SKILL.md`: the walk, the two fixed answers, the refusal clause verbatim, ends at try.
- check.sh: agents one page and read-only checker; refusal clause in rails.json; scaffold dated.
- Not yet: `minutes_per_item` is recorded, not enforced; the "show me the details" stack view; Vercel
  belongs to share.

## 0.0.5 — I have an idea (2026-10-26)

The interview, built the way Delon interviews: the person talks, Hatch coaches with casual questions
drawn from their own scenes, reflects what changed, reads back once from a file. Eight rulings from the
five-persona simulation shaped it.

- `data/interview.json`: how to interview. Voice, the three openers by idea shape, the goals with neutral
  probes, the seven gates with their ask / assume-no / assume-yes words, the read-back shape, the modes
  (forthcoming, brief), an interview budget, scorecard targets. Lint: names no technology.
- `data/stack.json`: what Hatch may build with, judged by Delon's five criteria; dated facts, 90-day lint.
- `scripts/lib/spec.js` and `hatch.js idea new | set | show | agree | refuse | terms`: the draft spec is
  written from the first minute into `~/Hatch/<slug>/.cohdit/spec.json` (folder, git init, registry);
  every reflection and the read-back are `render.js spec` over it. Eight items at most; a ninth is "two
  ideas". Every item and gate carries `source: said|inferred`.
- `render.js spec`: the read-back (items in their words, not in the first version, "I'm assuming" for the
  inferred gates with "anything there wrong?", the rule line, decisions taken, open questions, name and
  folder, hosting stated with its catch, the terms line) and `--partial` for "So far: …" / "Added: …".
- Codes `ASK{goal,n}` and `READBACK{kind,items,inferred,open}` so the scorecard can measure the craft;
  `DECIDE.type` gains `stack`.
- Terms: agreed once per computer (`~/.cohdit/settings.json.terms_v`), folded into "agreed" after, re-asked
  on a version change. `TERMS.md` moved into the plugin so it can be read aloud; `docs/TERMS.md` points there.
- Hosting: stated with its catch when the story is personal; "personal or a business" only when money
  appears; a team only from the tool's list. `hosting.json` plain lines rewritten.
- `questions.json`: terms `once_per: computer`, hosting `ask_when: money`, `stack` never asked; the build
  budgets are labelled as build budgets.
- `skills/dream/SKILL.md`: the method as rails, the refusal clause verbatim, no "new chat".
- check.sh: interview.json technology lint, stack.json freshness, no skill says "new chat", dream and build
  carry the refusal clause verbatim.

## 0.0.4 — set me up, without the cliffs (2026-10-26)

A second five-persona simulation ran the setup phase against v0.0.3 as built. It found seven bugs and
two gaps that broke the plain path; this release fixes them.

- Hatch fetches the GitHub tool itself (`lib/tools.js`): the current release for this kind of machine
  into `~/.cohdit/bin`, run by full path. No download page, no admin dialog, no PATH, no restart.
- Children of `hatch.js` see PATH plus the directories installers use, so a tool installed a minute
  ago is found without a restart. `tools.js` is the one file allowed to know those paths.
- The safety net and background measuring are advisory: never `next=`, never blocking, shown at plain
  only when they fail and nothing else is left. "Everything is ready." prints when the four real
  capabilities are ok.
- Plain shows four rows (Node, Git, GitHub, Vercel); a sign-in row says who ("signed in as priya-k",
  `CHECK.who`). A re-run shows only what changed and what is left. Tech shows every check as a sentence;
  the run summary that tech used to print for setup is gone.
- `hookspath_taken` is only hinted when another tool really owns the global hooks path; the templates
  are no longer copied when the guard cannot be wired.
- The global guard hands over to the repo's own `.git/hooks/pre-commit` and `pre-push`, so a
  developer's other projects keep their hooks.
- `wait` is capped at nine minutes, under Claude Code's limit for one call; the skill repeats it and
  says "expired" only when the sign-in really has.
- `connect <what> --switch` signs the current account out and starts again, for the wrong-account case.
- The usage hook exits quietly on a computer without Node instead of failing on every call.
- `skills/setup/SKILL.md`: a "Before the script can run" section owns the one moment the script
  cannot (no Node): install Node and Git together, one restart at most. Fixed lines for "why GitHub"
  and "why does it keep asking". Ten minutes for the setup call.

## 0.0.3 — set me up (2026-10-26)

The first thing you can say. Shaped by a five-persona walkthrough of the "before Hatch" step and
thirteen things that go wrong in it.

- `scripts/hatch.js`: the one script every skill calls (`setup | doctor | wait | connect | level`), so a
  single Claude Code permission covers all of Hatch. stdout is `render.js` output for the person;
  stderr is `key=value` hints for the model.
- `scripts/lib/doctor.js`: capability checks (`node git gh gh_auth vercel vercel_auth guard hook_path`)
  through one runner, fakeable with `COHDIT_PROBES` so tests never touch the machine. The publishing
  tool runs through `npx`, so there is nothing for the person to install for it.
- Setup fixes what it can itself: the settings file, the global secret guard (never taking over a
  hooks path another tool owns), a git identity from the GitHub account once signed in.
- Setup never asks how to talk. Plain is the default; "talk to me like a developer" (or "a product
  person", "plainly") changes it. `hatch.js connect` starts a sign-in in the background and relays the
  one-time code; `hatch.js wait` notices when a tool or sign-in arrives, so there is no "done" to type.
- The machine ledger: a setup run goes to `~/.cohdit/ledger/runs/`, validated like every other event.
- `skills/setup/SKILL.md` (≤ 100 lines): the walk, one capability per message, the install route left
  to the model for the machine in front of it.
- README: "Before you start" names the plans that include Claude Code and warns about plan limits; the
  two install lines are pasted one at a time; the trust lines (no passwords stored, your accounts) sit
  before the install. The tech level is redefined as plain sentences with technical terms, not
  key=value; prose budgets become plain 1 / product 2 / tech 3.
- `check.sh`: every skill must go through `hatch.js`; the enum-restating lint uses fixed strings.
- Install is one line: `/plugin install hatch --marketplace Cohdit/cohdit-hatch` (Claude Code 2.1.275+),
  with the two older lines kept as a fallback. Maintainer notes move to `docs/MAINTAINERS.md`; the README
  is for the person who builds. Marketplace descriptions rewritten for that reader.

## 0.0.2 — tokens first, dollars derived (2026-10-25)

Hatch cannot know what a person is billed (a subscription is a flat fee; the API is metered), so it stops
talking as if it did.

- Tokens are the headline everywhere usage is shown: `status`, `digest`, `score` and the budget stop.
  The scorecard splits them by kind (input, output, cache read, cache write) so the estimate's basis is
  visible, and its per-item, per-stage, orchestrator-share and rework figures are in tokens.
- A dollar figure appears only beside the tokens, as "≈ $X at API list price" with the date of the price
  list; plain says "roughly $X at Claude's public API prices". When a model has no price there is no
  estimate at all — never $0.00 — and the trust gate names the model.
- `prices.json` carries `date`; `check.sh` fails when it is older than 90 days. `RUN_START` records the
  date so re-pricing history is visible.
- *spent*, *spend* and *bill* join the banned-word lists for plain and product; the goldens enforce it.
- `render.js score --json`: `cost` becomes `tokens` + `est` (with `basis` and `prices_date`);
  `status --json`: `spent_usd` becomes `tokens`, `est_usd`, `prices_date`.
- README and TERMS say the same in plain words: the one thing Hatch uses up is your Claude plan, and what
  you pay depends on that plan, not on Hatch.

## 0.0.1 — Phase 0, plumbing (2026-10-25)

The ledger exists before any verb does.

- `data/codes.json`: 26 event codes with closed field types (no string type), enum-checked at write
  time, each with a template per level of language — `plain`, `product`, `tech`. Each level has a
  banned-word list and each view a line budget, both enforced by tests, so mechanism, operating
  systems and owner-dependent steps never leak to a reader who did not ask for them. `RUN_START`
  records the operating system; `DECIDE` records terms acceptance, the hosting choice, and whether
  the person decided or Hatch took a default on their behalf.
- `data/questions.json`: which decisions may reach the person at which level, how each is shaped,
  and the default taken below that level; plus how much prose the model may add per level.
- The person's level lives in `~/.cohdit/settings.json`; a project or a single call can override it.
- `usage.js` records `said` — characters of text the model showed the person — and the scorecard
  reports words per run, so verbosity is measured rather than asserted.
- `scripts/ledger.js`: `start | emit | end | flush | status | lint`, driven entirely by the code table.
  Long text goes to blobs that flush alongside the events. `flush --prune` bounds the ledger (50 runs,
  300 blobs).
- `scripts/render.js`: `status | why | digest | events | score`, two levels, a pure function of the
  ledger and `--now`. `why` explains a stopped, finished, crashed or live run from its last events.
  `score` carries the predecessor's trust gate.
- `scripts/usage.js hook`: token usage from transcripts, bound to the run's own session; exact-match
  pricing (the predecessor's prefix match silently priced `claude-sonnet-5-5` as `claude-sonnet-5`).
- `data/rails.json`: two refusals (harm; children), absolute. Seven build rules, one per interview gate.
- `data/hosting.json`: the hosting options a builder chooses from, with cost, fit and catch; the
  recommended option is free.
- `docs/TERMS.md` v1: you own what you build.
- Runtime is Node ≥ 20 with no dependencies (ported from a Python first draft so that Windows adds
  no install step). `.gitattributes` pins LF.
- Tests: fixture generator, 4 `node --test` suites, golden files for every view × level × fixture.
- CI on macOS, Ubuntu and Windows (`scripts/check.sh`).
