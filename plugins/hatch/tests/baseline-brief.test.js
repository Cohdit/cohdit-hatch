'use strict';
// baseline-brief.test.js — the maker is told the baseline rules its reviewers will check, up front: the ones that always apply,
// plus those whose gate the person answered yes; none of another gate's; and nothing breaks when the baseline cannot be read.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./harness');
const bd = require('../scripts/lib/build');

test.before(() => H.ready());

const spec = (rails) => ({ name: 'ABC Friends', pitch: 'letters for a toddler', rails, items: [
  { id: 'ITEM-001', title: 'Letter grid', criteria: ['open it; you see all 26 letters, big'], source: 'said', status: 'queued' },
] });
const brief = (rails) => bd.brief(H.mkrepo(), spec(rails), 'ITEM-001', { verify: 'npm test' }, null, new Map([['ITEM-001', 'queued']]));
const ids = (text) => (text.split('## Built in from the start')[1] || '').split('\n## ')[0].match(/^- [A-Z]+-[A-Z]+/gm) || [];

test('the brief names the rules that always apply, with how to build them, before the lessons and the technology', () => {
  const b = brief([]);
  assert.match(b, /## Built in from the start\nYour reviewers check these, by these ids\./);
  const got = ids(b).map((l) => l.slice(2));
  for (const id of ['SEC-INPUT', 'SEC-SECRETS', 'COST-UNBOUNDED', 'COST-PAID', 'COST-SCALE']) assert.ok(got.includes(id), id + ' is told to the maker');
  assert.match(b, /- COST-PAID: Call a paid service/);
  assert.ok(b.indexOf('## Built in from the start') < b.indexOf('## Technology'));
});

test('a rule behind a gate rides only when the person said yes to that gate', () => {
  const without = ids(brief([])).map((l) => l.slice(2));
  const withDetails = ids(brief(['personal_details'])).map((l) => l.slice(2));
  assert.ok(!without.includes('PRI-MINIMISE'), 'no personal details, no privacy rule');
  assert.ok(withDetails.includes('PRI-MINIMISE'), 'personal details attach the privacy rules');
  assert.ok(!without.includes('COST-STORAGE') && !ids(brief(['personal_details'])).some((l) => l.includes('COST-STORAGE')), 'uploads rules need the uploads gate');
  assert.ok(ids(brief(['uploads'])).some((l) => l.includes('COST-STORAGE')));
});

test('an unreadable baseline leaves the section out and the brief still builds', () => {
  const api = require('../scripts/lib/api');
  const was = api.dataJson;
  api.dataJson = (n) => { if (n === 'baseline') throw new Error('down'); return was(n); };
  try {
    assert.deepEqual(bd.baselineFor(spec([])), []);
    assert.doesNotMatch(brief([]), /## Built in from the start/);
  } finally { api.dataJson = was; }
});
