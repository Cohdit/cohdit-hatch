'use strict';
// leader.test.js — the software leader: the maker's brief carries the values and calls, the advisor's
// instructions carry everything, the checker and each lens carry the rules of their own areas, and
// `hatch.js leader` prints the same text. A missing leader leaves every section out and builds go on.
// The leader here is made up; the real one is private.
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
  v: 1, name: 'Test Leader', sha: 'abc',
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

function withLeader(value, fn) {
  const prev = process.env.COHDIT_LEADER;
  const file = path.join(H.tmpdir(), 'leader.json');
  fs.writeFileSync(file, value === null ? 'not json' : JSON.stringify(value));
  process.env.COHDIT_LEADER = file;
  try { return fn(file); } finally { if (prev === undefined) delete process.env.COHDIT_LEADER; else process.env.COHDIT_LEADER = prev; }
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

test('the brief says how Cohdit decides, before the lessons; the roles carry their part', () => {
  const spec = { name: 'Chores', pitch: 'a list', rails: [], items: [{ id: 'ITEM-001', title: 'Add a chore', criteria: ['type and add'], source: 'said', status: 'queued' }] };
  const dir = H.mkrepo();
  fs.mkdirSync(ml.spoolDir(dir), { recursive: true });
  withLeader(LEADER, () => {
    const brief = bd.brief(dir, spec, 'ITEM-001', { verify: 'npm test' }, null, new Map([['ITEM-001', 'queued']]));
    assert.match(brief, /## How Cohdit decides\n[^\n]+\nValues:\n- Small steps win\./);
    assert.ok(brief.indexOf('## How Cohdit decides') < brief.indexOf('## Technology'));
    const advisor = fs.readFileSync(bd.writeRole(dir, 'advisor'), 'utf8');
    assert.match(advisor, /## The software leader\n\nValues:/);
    assert.ok(advisor.includes('Never log a secret.'));
    const checker = fs.readFileSync(bd.writeRole(dir, 'checker'), 'utf8');
    assert.ok(checker.includes('Test the path a person takes.') && !checker.includes('Watch the paid calls.'));
  });
  withLeader(null, () => {
    const brief = bd.brief(dir, spec, 'ITEM-001', { verify: 'npm test' }, null, new Map([['ITEM-001', 'queued']]));
    assert.doesNotMatch(brief, /How Cohdit decides/, 'no leader: the build goes on without the section');
    assert.doesNotMatch(fs.readFileSync(bd.writeRole(dir, 'advisor'), 'utf8'), /^## The software leader/m);
  });
});

test('hatch.js leader prints all of it, or one reader\'s part', () => {
  withLeader(LEADER, (file) => {
    const env = { COHDIT_LEADER: file };
    const all = H.run('hatch.js', ['leader'], { env });
    assert.equal(all.code, 0, all.err);
    assert.ok(all.out.includes('No tax advice.') && all.out.includes('### Security'));
    const cost = H.run('hatch.js', ['leader', '--for', 'lens-cost'], { env });
    assert.ok(cost.out.includes('Watch the paid calls.') && !cost.out.includes('Never log a secret.'));
  });
  withLeader(null, (file) => {
    const r = H.run('hatch.js', ['leader'], { env: { COHDIT_LEADER: file } });
    assert.equal(r.code, 64);
  });
});
