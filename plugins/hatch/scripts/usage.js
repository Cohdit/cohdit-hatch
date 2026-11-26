#!/usr/bin/env node
'use strict';
/**
 * usage.js hook — token usage from Claude Code transcripts into the ledger as USAGE events.
 *
 * Wired to two hooks (hooks/hooks.json); reads the hook's JSON on stdin:
 *
 * - SubagentStop — the subagent's usage since its last checkpoint, attributed to an item by the
 *   branch it ran on, else the one open item its prompt names, else the run's only open item.
 * - PostToolUse on a subagent's Bash call to `hatch.js build verify|commit` — the same, midway, so the cost limit for
 *   one thing is checked while the maker works (hatch.js reads it at its next verify or commit).
 * - PostToolUse on the main session's own Bash call to ledger.js, step.js or hatch.js (never a subagent's —
 *   their payload carries agent_id) — the orchestrator's usage since its checkpoint. On
 *   `ledger.js start` / `hatch.js build open` / `try start` / `share open` it only sets the checkpoint, so the
 *   conversation before the run is never charged to it. The run is found in the session's folder, else in the project
 *   <home>/.cohdit/active.json points at, so a build started from any folder is still measured.
 *
 * Records only for the run's own session: the start call binds the active run to the session_id
 * the hook sees. Never blocks and never fails the session — every error goes to errors.log in the
 * spool and the hook exits 0.
 */
const fs = require('fs');
const path = require('path');
const ml = require('./lib/ledger');
const api = require('./lib/api');

const MARKS = /(?:ledger|step|hatch)\.js\b/;
const MIDWAY = /hatch\.js["']?\s+build\s+(?:verify|commit)\b/;
const STARTS = /ledger\.js["']?\s+start\b|step\.js["']?\s+open\b|hatch\.js["']?\s+(?:build\s+open|try\s+start|share\s+open)\b/;

/** The working copy that is building: the one this session opened (build writes a pointer per session),
 *  else the last one opened on this computer, for a call that carries no session. */
function pointedDir(session) {
  const p = ml.readJson(ml.pointerPath(session), null);
  return p && p.path && fs.existsSync(p.path) ? p.path : null;
}

function activeAt(cwd) {
  try { return cwd ? ml.activeRun(cwd) : null; } catch (e) { return null; }   // not a git repository
}

function usageRec(cur, ts, agent, attrib, models, item, extra) {
  const f = { agent, attrib, models };
  for (const k of Object.keys(extra || {})) {
    if (extra[k] !== undefined && extra[k] !== null) f[k] = extra[k];
  }
  const rec = { c: 'USAGE', f, r: cur.run, ts: ts || ml.utcNow() };
  if (item) rec.i = item;
  return rec;
}

/** A subagent's own transcript: the hook names it at SubagentStop; on its tool calls it sits beside the session's,
 *  at <session>/subagents/agent-<id>.jsonl. */
function agentTranscript(h) {
  if (h.agent_transcript_path) return h.agent_transcript_path;
  if (!h.transcript_path || !h.agent_id || !/^[\w-]{1,96}$/.test(String(h.agent_id))) return null;
  return path.join(h.transcript_path.replace(/\.jsonl$/, ''), 'subagents', 'agent-' + h.agent_id + '.jsonl');
}

function subagentStop(h, cwd, cur) {
  const file = agentTranscript(h);
  if (!file || !fs.existsSync(file)) return;
  const key = 'transcript:' + file;
  const { models, lastTs } = ml.transcriptUsage(file, ml.checkpoint(key, cwd));
  if (!Object.keys(models).length) return;
  const open = Object.keys(cur.open || {});
  for (const d of cur.lanes || []) {                             // a run built in lanes: every lane's things are this run's
    const c = activeAt(d);
    if (c && c.run === cur.run) open.push(...Object.keys(c.open || {}));
  }
  const [item, how] = ml.attribute(ml.transcriptMeta(file), open.sort());
  const agent = String(h.agent_type || 'unknown').split(':').pop();
  ml.appendSpool(usageRec(cur, lastTs, agent, how, models, item, { agent_id: h.agent_id, session: h.session_id }), cwd);
  ml.checkpoint(key, cwd, lastTs);
}

function orchestrator(h, cwd, cur, command) {
  const file = h.transcript_path;
  if (!file || !fs.existsSync(file)) return;
  const key = 'transcript:' + file;
  const after = ml.checkpoint(key, cwd);
  if (STARTS.test(command) || after === null) {
    const { lastTs } = ml.transcriptUsage(file);
    if (lastTs) ml.checkpoint(key, cwd, lastTs);
    if (STARTS.test(command)) {
      cur.ctx_start = ml.lastContext(file);
      ml.setActiveRun(cur, cwd);
    }
    return;
  }
  const { models, lastTs } = ml.transcriptUsage(file, after);
  if (!Object.keys(models).length) return;
  let ctxStart = null;
  if (cur.ctx_start !== undefined) {
    ctxStart = cur.ctx_start;
    delete cur.ctx_start;
    ml.setActiveRun(cur, cwd);
  }
  ml.appendSpool(usageRec(cur, lastTs, 'orchestrator', 'orchestrator', models, null, { session: h.session_id, ctx_start: ctxStart }), cwd);
  ml.checkpoint(key, cwd, lastTs);
}

function handle(h) {
  const event = h.hook_event_name;
  const session = h.session_id;
  let cwd = null, cur = null;
  for (const dir of [session ? pointedDir(session) : null, h.cwd || process.cwd(), pointedDir()]) {
    cur = activeAt(dir);
    if (cur) { cwd = dir; break; }
  }
  if (!cur) return;
  if (event === 'PostToolUse' && h.tool_name === 'Bash' && !h.agent_id) {
    const command = (h.tool_input || {}).command || '';
    if (!MARKS.test(command)) return;
    if (STARTS.test(command) && session) {
      cur.session = session;
      ml.setActiveRun(cur, cwd);
    }
    if (session && session === cur.session) orchestrator(h, cwd, cur, command);
  } else if (event === 'SubagentStop' && session && session === cur.session) {
    subagentStop(h, cwd, cur);
  } else if (event === 'PostToolUse' && h.tool_name === 'Bash' && h.agent_id && session && session === cur.session
    && MIDWAY.test((h.tool_input || {}).command || '')) {
    // A maker's spend so far, each time it runs the checks: the cost limit for one thing is then checked while it
    // works, not only once it is done. The same checkpoint as SubagentStop, so nothing is counted twice.
    subagentStop(h, cwd, cur);
  }
}

function main() {
  if (process.argv[2] !== 'hook') {
    process.stderr.write('usage: usage.js hook   (reads the hook payload on stdin)\n');
    return 64;
  }
  const payload = fs.readFileSync(0, 'utf8') || '{}';
  // No content (no key, offline past the cache): a hook stays silent rather than block the tool call.
  return api.preloadData().then(() => {
    try {
      handle(JSON.parse(payload));
    } catch (e) {
      ml.logError('usage: ' + (e && e.stack ? e.stack : String(e)));
    }
    return 0;
  }, () => 0);
}

if (require.main === module) Promise.resolve(main()).then((code) => { process.exitCode = code; });
module.exports = { handle, MARKS, STARTS, MIDWAY, agentTranscript };
