'use strict';
// usage.test.js — the hook turns Claude Code transcripts into USAGE events bound to the run's own
// session, attributes subagents by branch, charges nothing before the run starts, and prices
// models by exact match only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const ml = require('../scripts/lib/ledger');

// In-process loaders read content synchronously; fetch it first when it comes over the API.
test.before(() => H.ready());

const L = (cwd, ...args) => H.run('ledger.js', args, { cwd });
const U = (cwd, payload) => H.run('usage.js', ['hook'], { cwd, input: typeof payload === 'string' ? payload : JSON.stringify(payload) });
const row = (ts, id, model, inTok, outTok, cr, cw, branch = 'main', text = 'ok') => JSON.stringify({
  type: 'assistant', timestamp: ts, gitBranch: branch,
  message: { id, model, content: [{ type: 'text', text }, { type: 'tool_use', name: 'Bash', input: { command: 'x'.repeat(500) } }],
    usage: { input_tokens: inTok, output_tokens: outTok, cache_read_input_tokens: cr, cache_creation_input_tokens: cw } },
}) + '\n';

test('the hook is a no-op before a run, binds the session on start, charges only later turns', () => {
  const repo = H.mkrepo();
  const sp = H.spool(repo);
  const main = path.join(H.tmpdir(), 'main.jsonl');
  fs.writeFileSync(main, row('2026-11-01T09:00:00Z', 'm1', 'claude-sonnet-5-5', 100, 10, 0, 0));
  const post = (session, command) => ({ hook_event_name: 'PostToolUse', tool_name: 'Bash', session_id: session, cwd: repo, transcript_path: main, tool_input: { command } });

  let r = U(repo, post('s1', 'node ledger.js start --skill build'));
  assert.equal(r.code, 0, 'exit 0 with no active run');
  assert.equal(H.lines(sp).length, 0, 'nothing written before a run exists');

  L(repo, 'start', '--skill', 'build');
  U(repo, post('s1', 'node "' + H.S + '/ledger.js" start --skill build'));
  assert.equal(H.lines(sp).length, 1, 'only RUN_START in the spool: the start call charges nothing');
  assert.equal(H.readJson(path.join(path.dirname(sp), 'active-run.json')).session, 's1', 'session bound');

  fs.appendFileSync(main, row('2026-11-01T09:05:00Z', 'm2', 'claude-sonnet-5-5', 1000, 5, 0, 0, 'main', 'Built it.')
    + row('2026-11-01T09:05:01Z', 'm2', 'claude-sonnet-5-5', 1000, 400, 0, 0, 'main', 'Built it. Two things are done.'));
  U(repo, post('s1', 'node step.js pick'));
  const rec = H.lastLine(sp);
  assert.equal(rec.c, 'USAGE', 'USAGE written');
  assert.equal(rec.f.attrib, 'orchestrator', 'attributed to the orchestrator');
  assert.equal(rec.f.models['claude-sonnet-5-5'].out, 400, 'last row per message id wins');
  assert.equal(rec.f.models['claude-sonnet-5-5'].msgs, 1, 'one message counted once');
  assert.equal(rec.f.models['claude-sonnet-5-5'].said, 'Built it. Two things are done.'.length, 'said counts shown text only, never tool calls');
  assert.ok(!('i' in rec), 'no item on orchestrator usage');

  const n0 = H.lines(sp).length;
  U(repo, post('s2', 'node step.js pick'));
  assert.equal(H.lines(sp).length, n0, 'another session in the same clone is never billed');
  U(repo, post('s1', 'ls -la'));
  assert.equal(H.lines(sp).length, n0, 'an unrelated command is ignored');
});

test('a subagent on item/NNN is attributed by its branch; a second stop records only what is new', () => {
  const repo = H.mkrepo();
  const sp = H.spool(repo);
  const main = path.join(H.tmpdir(), 'main.jsonl');
  const sub = path.join(H.tmpdir(), 'sub.jsonl');
  fs.writeFileSync(main, row('2026-11-01T09:00:00Z', 'm1', 'claude-sonnet-5-5', 100, 10, 0, 0));
  L(repo, 'start', '--skill', 'build');
  U(repo, { hook_event_name: 'PostToolUse', tool_name: 'Bash', session_id: 's1', cwd: repo, transcript_path: main, tool_input: { command: 'node ledger.js start --skill build' } });
  L(repo, 'emit', 'PICK', 'ITEM-002', 'branch=item/002-tick', 'fork=3f2a9c1e');
  const stop = { hook_event_name: 'SubagentStop', session_id: 's1', cwd: repo, agent_id: 'ag1', agent_type: 'hatch:maker', agent_transcript_path: sub };

  fs.writeFileSync(sub, row('2026-11-01T09:10:00Z', 'a1', 'claude-sonnet-5-5', 5000, 800, 20000, 3000, 'item/002-tick'));
  U(repo, stop);
  let rec = H.lastLine(sp);
  assert.equal(rec.f.agent, 'maker', 'USAGE for the subagent');
  assert.equal(rec.i + ' ' + rec.f.attrib, 'ITEM-002 branch', 'attributed by branch');
  assert.equal(rec.f.models['claude-sonnet-5-5'].cold5, 0, 'a turn that read cache is not a cold write');

  const n0 = H.lines(sp).length;
  U(repo, stop);
  assert.equal(H.lines(sp).length, n0, 'nothing new, nothing written');
  fs.appendFileSync(sub, row('2026-11-01T09:12:00Z', 'a2', 'claude-sonnet-5-5', 100, 50, 0, 0, 'item/002-tick'));
  U(repo, stop);
  rec = H.lastLine(sp);
  assert.equal(rec.f.models['claude-sonnet-5-5'].in, 100, 'only the new turn');
});

test('pricing is exact-match', () => {
  const p = ml.loadPrices();
  assert.equal(ml.usageCost({ 'claude-sonnet-5-5': { in: 1000000 } }, p), 2.0, 'claude-sonnet-5-5 priced');
  assert.equal(ml.usageCost({ 'claude-sonnet-5-5-preview': { in: 1 } }, p), null, 'a prefix never matches');
  assert.equal(Math.round(ml.usageCost({ 'claude-sonnet-5-5': { cw5: 1000000 } }, p) * 100) / 100, 2.5, 'cache writes use the multiplier');
});

test('attribution order: branch beats prompt beats the only open item', () => {
  assert.deepEqual(ml.attribute({ branch: 'item/003-x', promptItems: ['ITEM-001'] }, ['ITEM-001', 'ITEM-003']), ['ITEM-003', 'branch']);
  assert.deepEqual(ml.attribute({ branch: 'main', promptItems: ['ITEM-001'] }, ['ITEM-001', 'ITEM-003']), ['ITEM-001', 'prompt']);
  assert.deepEqual(ml.attribute({ branch: 'main', promptItems: [] }, ['ITEM-003']), ['ITEM-003', 'window']);
  assert.deepEqual(ml.attribute({ branch: 'main', promptItems: [] }, ['ITEM-001', 'ITEM-003']), [null, 'none']);
});

test('a hook crash never fails the session', () => {
  const repo = H.mkrepo();
  assert.equal(U(repo, 'garbage').code, 0, 'bad stdin → exit 0');
  assert.equal(H.run('usage.js', [], { cwd: repo }).code, 64, 'no verb → 64');
});
