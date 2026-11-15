'use strict';
// leader.test.js — the software leader as one agent an idea uses: the maker's brief carries its values and
// calls, the advisor's instructions carry everything, the checker and each lens carry the rules of their own
// areas, and `hatch.js leader` prints the same text. An idea that does not use it leaves every section out
// and builds go on with the person's own model. The leader here is made up; the real one is private.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const ld = require('../scripts/lib/leader');
const bd = require('../scripts/lib/build');
const ml = require('../scripts/lib/ledger');

test.before(() => H.ready());

const LEADER = {
  v: 1, name: 'Test Leader', sha: 'abc', slug: 'software-leader', kind: 'software', field: 'building software',
  values: ['Small steps win.'],
  calls: ['Fast vs safe: safe, unless it is down.'],
  limits: ['No tax advice.'],
  knowledge: [
    { id: 'A-001', domain: 'testing', rule: 'Test the path a person takes.', why: 'That is what breaks.' },
    { id: 'A-002', domain: 'cost', rule: 'Watch the paid calls.', unless: 'it is a one-off' },
    { id: 'A-003', domain: 'security', rule: 'Never log a secret.' },
  ],
  reads: { checker: ['testing'], 'lens-cost': ['cost'], dream: [] },
};

/** A packs folder holding the leader (or not json, for "cannot be had"). */
function withLeader(value, fn) {
  const prev = process.env.COHDIT_EXPERTS;
  const dir = H.tmpdir();
  fs.writeFileSync(path.join(dir, 'software-leader.json'), value === null ? 'not json' : JSON.stringify(value));
  process.env.COHDIT_EXPERTS = dir;
  try { return fn(dir); } finally { if (prev === undefined) delete process.env.COHDIT_EXPERTS; else process.env.COHDIT_EXPERTS = prev; }
}

test('each reader carries its own part: core always, its domains, everything for the advisor', () => {
  const cost = ld.forReader(LEADER, 'lens-cost');
  assert.match(cost, /^Values:\n- Small steps win\.\n\nTrade-off calls[^\n]*\n- Fast vs safe/);
  assert.match(cost, /### Cost\n- Watch the paid calls\.\n {2}Unless: it is a one-off/);
  assert.doesNotMatch(cost, /Test the path|Never log a secret|No tax advice/);
  const all = ld.forReader(LEADER, 'advisor');
  for (const s of ['No tax advice.', '### Testing', 'Why: That is what breaks.', '### Security']) assert.ok(all.includes(s), s);
  assert.equal(ld.forReader(LEADER, 'all'), all);
  assert.doesNotMatch(ld.forReader(LEADER, 'lens-compliance'), /###/, 'a reader with no domains gets the core only');
  assert.equal(ld.forReader(null, 'advisor'), '');
});

test('an idea using the leader: the brief says how it decides, before the lessons; the roles carry their part', () => {
  const spec = { name: 'Chores', pitch: 'a list', rails: [], experts: ['software-leader'], items: [{ id: 'ITEM-001', title: 'Add a chore', criteria: ['type and add'], source: 'said', status: 'queued' }] };
  const dir = H.mkrepo();
  fs.mkdirSync(ml.spoolDir(dir), { recursive: true });
  fs.mkdirSync(path.join(dir, '.cohdit'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.cohdit', 'spec.json'), JSON.stringify(spec));
  const st = new Map([['ITEM-001', 'queued']]);
  withLeader(LEADER, () => {
    const brief = bd.brief(dir, spec, 'ITEM-001', { verify: 'npm test' }, null, st);
    assert.match(brief, /## What Test Leader knows about this business\n[^\n]+\nValues:\n- Small steps win\./);
    assert.ok(brief.indexOf('## What Test Leader knows') < brief.indexOf('## Technology'));
    const advisor = fs.readFileSync(bd.writeRole(dir, 'advisor'), 'utf8');
    assert.match(advisor, /## Test Leader\n\nValues:/);
    assert.ok(advisor.includes('Never log a secret.'));
    const checker = fs.readFileSync(bd.writeRole(dir, 'checker'), 'utf8');
    assert.ok(checker.includes('Test the path a person takes.') && !checker.includes('Watch the paid calls.'));
  });
  withLeader(null, () => {
    const brief = bd.brief(dir, spec, 'ITEM-001', { verify: 'npm test' }, null, st);
    assert.doesNotMatch(brief, /knows about this business/, 'the leader cannot be had: the build goes on without the section');
    assert.doesNotMatch(fs.readFileSync(bd.writeRole(dir, 'advisor'), 'utf8'), /^## Test Leader/m);
  });
  const vanilla = Object.assign({}, spec, { experts: [] });
  withLeader(LEADER, () => {
    const brief = bd.brief(dir, vanilla, 'ITEM-001', { verify: 'npm test' }, null, st);
    assert.doesNotMatch(brief, /knows about this business|Small steps win/, 'an idea that uses no agent builds with the person\'s own model');
  });
});

test('hatch.js leader prints all of it, or one reader\'s part; one the person does not have says how to add it', () => {
  withLeader(LEADER, (dir) => {
    const env = { COHDIT_EXPERTS: dir };
    const all = H.run('hatch.js', ['leader'], { env });
    assert.equal(all.code, 0, all.err);
    assert.ok(all.out.includes('No tax advice.') && all.out.includes('### Security'));
    const cost = H.run('hatch.js', ['leader', '--for', 'lens-cost'], { env });
    assert.ok(cost.out.includes('Watch the paid calls.') && !cost.out.includes('Never log a secret.'));
  });
  withLeader(null, (dir) => {
    const r = H.run('hatch.js', ['leader'], { env: { COHDIT_EXPERTS: dir } });
    assert.deepEqual([r.code, r.out], [1, 'The software leader isn\'t one of your agents yet. Say "what agents are there" to add it.']);
  });
});
