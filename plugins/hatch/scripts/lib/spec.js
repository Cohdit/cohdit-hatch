'use strict';
/**
 * lib/spec.js — the idea as a file: the running draft the interview writes, and the spec build reads.
 *
 * The draft lives at <project>/.cohdit/spec.json from the first minute of the interview, so every
 * reflection and the read-back are rendered from it (render.js spec), never from the model's memory.
 * `hatch.js idea` is its only writer. Shape (docs/CONTRACTS.md § Spec):
 *
 *   { v, name, slug, shape?, for?, anchor?, pitch?,
 *     items: [{ id, title, criteria[], source: said|inferred, device?, status }],
 *     out: [],                                  // not in the first version
 *     gates: { <rails.json rule>: { value, source } },
 *     decisions: [{ type, choice, who }], open_questions: [], memory?, people?: { region?, kinds?, field? },
 *     rails: [], terms_v?, agreed, refused? }
 *
 * Bounded by construction: at most 8 items, 3 criteria each. Everything the person said keeps their
 * words; `source` says whether Hatch heard it or inferred it, so build knows where the guesses are.
 */
const fs = require('fs');
const path = require('path');
const ml = require('./ledger');
const cz = require('./codes');
const api = require('./api');

const SOURCES = ['said', 'inferred'];
const SHAPES = ['use', 'read', 'runs'];
const WHO = ['you', 'hatch'];

class Invalid extends Error {}

function loadInterview() { return api.dataJson('interview'); }
function loadStack() { return api.dataJson('stack'); }
function loadHosting() { return api.dataJson('hosting'); }

/** The terms text and its version, from the heading `# Terms — version N`. */
function terms() {
  const text = api.dataText('TERMS');
  const m = /^# Terms — version (\d+)/m.exec(text);
  return { text, version: m ? Number(m[1]) : 0 };
}

function slugify(name) {
  const s = String(name || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'idea';
}

function homeDir() {
  return process.env.COHDIT_HOME || require('os').homedir();
}

/** Where new projects go unless the person chose: ~/Hatch/<slug>. A taken folder gets -2, -3 … */
function freeDir(base, slug) {
  let dir = path.join(base, slug), n = 2;
  while (fs.existsSync(dir)) dir = path.join(base, slug + '-' + n++);
  return dir;
}

function cohditDir(dir) { return path.join(dir, ml.COHDIT_DIR); }
function specPath(dir) { return path.join(cohditDir(dir), 'spec.json'); }
function localPath(dir) { return path.join(cohditDir(dir), 'local.json'); }

function load(dir) {
  const s = ml.readJson(specPath(dir), null);
  if (!s) throw new Invalid('no idea in ' + dir);
  return s;
}

function save(dir, spec) {
  fs.writeFileSync(specPath(dir), JSON.stringify(ml.sortKeys(spec), null, 1) + '\n');
}

function readLocal(dir) { return ml.readJson(localPath(dir), {}); }
function writeLocal(dir, obj) { fs.writeFileSync(localPath(dir), JSON.stringify(obj, null, 1) + '\n'); }

/** The person's project registry in ~/.cohdit/settings.json. */
function registry() {
  const s = ml.readJson(ml.settingsPath(), { v: 1, level: 'plain', projects: [] });
  if (!Array.isArray(s.projects)) s.projects = [];
  return s;
}

function saveRegistry(s) {
  fs.mkdirSync(path.dirname(ml.settingsPath()), { recursive: true });
  fs.writeFileSync(ml.settingsPath(), JSON.stringify(s, null, 2) + '\n');
}

/** Create the project folder, its .cohdit, the draft, the registry entry. Returns {dir, slug}. */
function newProject(name, wantDir, gitRun) {
  const slug = slugify(name);
  const dir = wantDir ? path.resolve(wantDir) : freeDir(path.join(homeDir(), 'Hatch'), slug);
  if (fs.existsSync(specPath(dir))) throw new Invalid('there is already an idea in ' + dir);
  fs.mkdirSync(path.join(cohditDir(dir), 'ledger', 'runs'), { recursive: true });
  fs.mkdirSync(path.join(cohditDir(dir), 'ledger', 'blobs'), { recursive: true });
  if (!fs.existsSync(path.join(dir, '.git'))) gitRun(['init', '-q', '-b', 'main'], dir);
  const gi = path.join(dir, '.gitignore');
  if (!fs.existsSync(gi)) fs.writeFileSync(gi, 'node_modules/\n.env*\n.cohdit/local.json\n.cohdit/reports/\ncoverage/\n');
  const spec = { v: 1, name: String(name).trim(), slug, items: [], out: [], gates: {}, decisions: [], open_questions: [], agreed: false };
  save(dir, spec);
  fs.writeFileSync(path.join(cohditDir(dir), 'config.json'), JSON.stringify({ v: 1, name: spec.name, slug }, null, 2) + '\n');
  const reg = registry();
  reg.projects = reg.projects.filter((p) => p.path !== dir);
  reg.projects.push({ name: spec.name, slug, path: dir, created: ml.utcNow() });
  saveRegistry(reg);
  return { dir, slug };
}

/** The project a phrase means: --dir, else the current folder if it holds an idea, else the newest
 *  registered one whose folder still exists. */
function findProject(wantDir, cwd) {
  if (wantDir) return path.resolve(wantDir);
  if (fs.existsSync(specPath(cwd))) return cwd;
  const reg = registry();
  const alive = reg.projects.filter((p) => fs.existsSync(specPath(p.path)));
  if (!alive.length) throw new Invalid('no idea yet; say "I have an idea" first');
  return alive[alive.length - 1].path;
}

// --- the patch the interview applies -----------------------------------------------------------

function str(v, what) {
  if (typeof v !== 'string' || !v.trim()) throw new Invalid(what + ' must be a non-empty string');
  return v.trim();
}

function strList(v, what) {
  if (!Array.isArray(v)) throw new Invalid(what + ' must be a list');
  return v.map((x, i) => str(x, what + '[' + i + ']'));
}

/** Apply what the interview learned. Returns the goals it says were asked. Throws Invalid. */
function applyPatch(spec, patch, interview) {
  if (spec.agreed) throw new Invalid('the idea is agreed; say "add to my idea" to start a change');
  if (!patch || typeof patch !== 'object') throw new Invalid('patch must be an object');
  const rb = (interview && interview.readback) || {};
  const maxItems = rb.max_items || 8, maxCrit = rb.max_criteria_per_item || 3;
  const gateKeys = Object.keys(cz.loadRails().rule || {});
  const asked = [];
  for (const k of Object.keys(patch)) {
    const v = patch[k];
    switch (k) {
      case 'name': spec.name = str(v, k); break;
      case 'for': case 'anchor': case 'pitch': spec[k] = str(v, k); break;
      case 'shape':
        if (!SHAPES.includes(v)) throw new Invalid('shape must be one of ' + SHAPES.join(', '));
        spec.shape = v; break;
      case 'memory': spec.memory = !!v; break;
      case 'out': spec.out = strList(v, k); break;
      case 'open_questions': spec.open_questions = strList(v, k); break;
      case 'items': {
        if (!Array.isArray(v)) throw new Invalid('items must be a list');
        if (v.length > maxItems) throw new Invalid('two_ideas: ' + v.length + ' things is more than ' + maxItems + '; that is two ideas');
        spec.items = v.map((it, i) => {
          if (!it || typeof it !== 'object') throw new Invalid('items[' + i + '] must be an object');
          const crit = strList(it.criteria || [], 'items[' + i + '].criteria');
          if (crit.length > maxCrit) throw new Invalid('items[' + i + '] has more than ' + maxCrit + ' checks');
          const source = it.source || 'said';
          if (!SOURCES.includes(source)) throw new Invalid('items[' + i + '].source must be said or inferred');
          const out = { id: 'ITEM-' + String(i + 1).padStart(3, '0'), title: str(it.title, 'items[' + i + '].title'), criteria: crit, source, status: 'queued', lens: 'product' };
          if (it.device) out.device = true;
          return out;
        });
        break;
      }
      case 'gates': {
        if (!v || typeof v !== 'object') throw new Invalid('gates must be an object');
        for (const g of Object.keys(v)) {
          if (!gateKeys.includes(g)) throw new Invalid('unknown gate ' + g + ' (rails.json rules: ' + gateKeys.join(', ') + ')');
          const e = v[g];
          const value = typeof e === 'object' && e !== null ? !!e.value : !!e;
          const source = (typeof e === 'object' && e !== null && e.source) || 'said';
          if (!SOURCES.includes(source)) throw new Invalid('gates.' + g + '.source must be said or inferred');
          spec.gates[g] = { value, source };
        }
        break;
      }
      case 'decisions': {
        if (!Array.isArray(v)) throw new Invalid('decisions must be a list');
        const types = cz.load().codes.DECIDE.fields.type.enum;
        for (const d of v) {
          if (!d || !types.includes(d.type)) throw new Invalid('decision type must be one of ' + types.join(', '));
          if (!WHO.includes(d.who || 'hatch')) throw new Invalid('decision who must be you or hatch');
          spec.decisions = spec.decisions.filter((x) => x.type !== d.type || (d.type === 'stack' && x.choice !== d.choice));
          spec.decisions.push({ type: d.type, choice: str(d.choice, 'decision choice'), who: d.who || 'hatch' });
        }
        break;
      }
      case 'people': {
        if (!v || typeof v !== 'object') throw new Invalid('people must be an object');
        spec.people = {};
        if (v.region) spec.people.region = str(v.region, 'people.region');
        if (v.kinds) spec.people.kinds = strList(v.kinds, 'people.kinds');
        if (v.field) spec.people.field = str(v.field, 'people.field');
        break;
      }
      case 'asked': {
        const goals = cz.load().codes.ASK.fields.goal.enum;
        for (const g of strList(Array.isArray(v) ? v : [v], 'asked')) {
          if (!goals.includes(g)) throw new Invalid('asked must be one of ' + goals.join(', '));
          asked.push(g);
        }
        break;
      }
      default: throw new Invalid('unknown field ' + k);
    }
  }
  return asked;
}

const BUG_SOURCES = ['scan', 'report'];
const TITLE_MAX = 80;

/** A bug a lens found on a scan or a person reported, appended as a queued thing after the idea's own
 *  (never re-numbering them). A twin, by title, is returned with `twin: true` and nothing is written.
 *  `lens` says which role raised it: a person's report is the product owner's, a scan the architect's. */
function addBug(dir, bug) {
  const spec = load(dir);
  if (!BUG_SOURCES.includes(bug.source)) throw new Invalid('bug source must be scan or report');
  const title = str(bug.title, 'bug title').replace(/\s+/g, ' ').slice(0, TITLE_MAX).trim();
  const criteria = strList(bug.criteria || [], 'bug criteria').slice(0, 3);
  if (!criteria.length) throw new Invalid('a bug needs one check: what must be true once it is fixed');
  const twin = spec.items.find((i) => i.kind === 'bug' && i.title.toLowerCase() === title.toLowerCase());
  if (twin) return Object.assign({ twin: true }, twin);
  const it = { id: 'ITEM-' + String(spec.items.length + 1).padStart(3, '0'), title, criteria, source: bug.source, kind: 'bug', status: 'queued', lens: bug.source === 'report' ? 'product' : 'technical' };
  if (bug.by) it.by = str(bug.by, 'bug by');
  spec.items.push(it);
  save(dir, spec);
  return it;
}

/** Why the idea cannot be agreed yet; [] when it can. */
function agreeProblems(spec) {
  const out = [];
  if (!spec.items.length) out.push('nothing to build yet');
  for (const it of spec.items) if (!it.criteria.length) out.push('"' + it.title + '" has no check (where you go, what you do, what you see)');
  const gateKeys = Object.keys(cz.loadRails().rule || {});
  const missing = gateKeys.filter((g) => !spec.gates[g]);
  if (missing.length) out.push('not yet known: ' + missing.join(', '));
  if (spec.refused) out.push('refused: ' + spec.refused);
  return out;
}

/** A stack the person volunteered: every part must be an option in stack.json. Returns {ok, off[]}. */
function checkStack(parts) {
  const st = loadStack();
  const known = new Map();
  for (const cap of Object.keys(st.capabilities || {})) {
    for (const key of Object.keys(st.capabilities[cap].options || {})) known.set(key, cap);
  }
  const off = parts.filter((p) => !known.has(p));
  return { ok: off.length === 0, off, known };
}

/** Rules attached by the gates answered yes. */
function railsFor(spec) {
  return Object.keys(spec.gates).filter((g) => spec.gates[g].value).sort();
}

module.exports = {
  Invalid, SOURCES, SHAPES,
  loadInterview, loadStack, loadHosting, terms, slugify, homeDir, cohditDir, specPath, load, save, readLocal, writeLocal,
  registry, saveRegistry, newProject, findProject, applyPatch, addBug, agreeProblems, checkStack, railsFor,
};
