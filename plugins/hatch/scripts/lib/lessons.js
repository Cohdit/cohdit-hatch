'use strict';
/**
 * lessons.js — the lesson bank: what the owner has learned about building software, kept small
 * enough to ride in every brief. `hatch.js remember` is its only writer; `build next` reads it.
 *
 * A lesson is {id, gist, for, tags, detail, added}:
 *   gist    one line, <= 180 chars, the rule itself. This is all most readers ever see.
 *   for     who it binds: maker (builds), checker (reviews), dream (interviews), maintainer (works on
 *           Hatch itself). Default maker.
 *   tags    0-6 lowercase words. A tagged lesson rides in a brief only when a tag appears in the
 *           thing's own words (title, checks, rules, pitch), and then its detail rides with it.
 *           An untagged lesson is general: its gist rides in every brief for its readers.
 *   detail  <= 600 chars, optional: the why or the exact how, when the gist cannot carry it.
 *
 * Bounded: a brief carries at most CAP lessons per reader, tagged matches first, then general ones
 * by id. `hint=crowded` from `remember` means a reader's general lessons already exceed the cap,
 * so the newest will be left out until some are tagged or merged.
 *
 * COHDIT_LESSONS=<file> moves the bank (tests).
 */
const fs = require('fs');
const path = require('path');
const ml = require('./ledger');
const api = require('./api');

const READERS = ['maker', 'checker', 'dream', 'maintainer'];
const GIST_MAX = 180;
const DETAIL_MAX = 600;
const TAGS_MAX = 6;
const TAG_RE = /^[a-z0-9][a-z0-9-]{1,23}$/;
const ID_RE = /^L-\d{3,}$/;
const CAP = 24;

class Invalid extends Error {}

/** The bank file `remember` writes: COHDIT_LESSONS, else the content folder (HATCH_DEV_DIR), else none:
 *  the bank is read from Cohdit and written only where the content is kept. */
function bankPath() {
  if (process.env.COHDIT_LESSONS) return process.env.COHDIT_LESSONS;
  return process.env.HATCH_DEV_DIR ? path.join(process.env.HATCH_DEV_DIR, 'data', 'lessons.json') : null;
}

function load(file) {
  const f = file || bankPath();
  const b = (f ? ml.readJson(f, null) : api.dataJson('lessons')) || { v: 1, next: 1, lessons: [] };
  if (!Array.isArray(b.lessons)) b.lessons = [];
  if (!Number.isInteger(b.next) || b.next < 1) b.next = maxId(b.lessons) + 1;
  return b;
}

function save(bank, file) {
  const out = { v: 1 };
  if (bank._about) out._about = bank._about;
  out.next = bank.next;
  out.lessons = bank.lessons;
  const f = file || bankPath();
  if (!f) throw new Invalid('the lesson bank is written where the content is kept: set HATCH_DEV_DIR to that folder');
  fs.writeFileSync(f, JSON.stringify(out, null, 2) + '\n');
}

function maxId(lessons) { return lessons.reduce((m, l) => Math.max(m, num(l.id)), 0); }
function num(id) { return ID_RE.test(String(id)) ? parseInt(id.slice(2), 10) : 0; }
function fmtId(n) { return 'L-' + String(n).padStart(3, '0'); }

function norm(s) { return String(s).toLowerCase().replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim(); }

function str(v, what, max) {
  if (typeof v !== 'string' || !v.trim()) throw new Invalid(what + ' must be a non-empty string');
  const s = v.replace(/\s+/g, ' ').trim();
  if (s.length > max) throw new Invalid(what + ' is ' + s.length + ' chars (limit ' + max + ')');
  return s;
}

/** The validated shape of one lesson from loose input. */
function validate(input, base) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Invalid('a lesson is an object');
  const l = Object.assign({}, base || {});
  for (const k of Object.keys(input)) if (!['gist', 'for', 'tags', 'detail'].includes(k)) throw new Invalid('unknown field ' + k + ' (gist, for, tags, detail)');
  if ('gist' in input || !base) l.gist = str(input.gist, 'gist', GIST_MAX);
  if ('for' in input || !base) {
    let f = input.for === undefined ? ['maker'] : input.for;
    if (typeof f === 'string') f = f.split(',').map((x) => x.trim()).filter(Boolean);
    if (!Array.isArray(f) || !f.length) throw new Invalid('for must name at least one reader: ' + READERS.join(', '));
    for (const r of f) if (!READERS.includes(r)) throw new Invalid('for: ' + r + ' is not a reader (' + READERS.join(', ') + ')');
    l.for = READERS.filter((r) => f.includes(r));
  }
  if ('tags' in input || !base) {
    let t = input.tags === undefined ? [] : input.tags;
    if (typeof t === 'string') t = t.split(',').map((x) => x.trim()).filter(Boolean);
    if (!Array.isArray(t)) throw new Invalid('tags must be a list of words');
    t = [...new Set(t.map((x) => String(x).toLowerCase()))];
    if (t.length > TAGS_MAX) throw new Invalid('at most ' + TAGS_MAX + ' tags');
    for (const x of t) if (!TAG_RE.test(x)) throw new Invalid('tag "' + x + '" must be 2-24 chars of a-z, 0-9, -');
    l.tags = t.sort();
  }
  if ('detail' in input || !base) l.detail = input.detail === undefined || input.detail === null || input.detail === '' ? null : str(input.detail, 'detail', DETAIL_MAX);
  return l;
}

function find(bank, id) {
  const l = bank.lessons.find((x) => x.id === id);
  if (!l) throw new Invalid('no lesson ' + id);
  return l;
}

function duplicateOf(bank, gist, exceptId) {
  const n = norm(gist);
  return bank.lessons.find((x) => x.id !== exceptId && norm(x.gist) === n) || null;
}

function add(bank, input, today) {
  const l = validate(input);
  const dup = duplicateOf(bank, l.gist);
  if (dup) throw new Invalid('already ' + dup.id + ': ' + dup.gist);
  l.id = fmtId(bank.next++);
  l.added = String(today || ml.utcNow()).slice(0, 10);
  bank.lessons.push(l);
  return l;
}

function set(bank, id, input) {
  const cur = find(bank, id);
  const l = validate(input, cur);
  const dup = duplicateOf(bank, l.gist, id);
  if (dup) throw new Invalid('already ' + dup.id + ': ' + dup.gist);
  Object.assign(cur, l);
  return cur;
}

function drop(bank, id) {
  const l = find(bank, id);
  bank.lessons = bank.lessons.filter((x) => x !== l);
  return l;
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** A tag is found when it starts a word in the text (so "form" finds "forms", not "platform"). */
function tagIn(tag, text) { return new RegExp('(^|[^a-z0-9])' + escapeRe(tag)).test(text); }

/** The lessons one reader gets for a thing described by `text`: tagged matches (with detail) first,
 *  then general ones (gist only), at most `cap`. `dropped` counts what did not fit. */
function select(bank, reader, text, cap) {
  const t = String(text || '').toLowerCase();
  const mine = bank.lessons.filter((l) => l.for.includes(reader)).sort((a, b) => num(a.id) - num(b.id));
  const matched = mine.filter((l) => l.tags.length && l.tags.some((g) => tagIn(g, t)));
  const general = mine.filter((l) => !l.tags.length);
  const all = matched.concat(general);
  const max = cap || CAP;
  return { matched: matched.slice(0, max), general: general.slice(0, Math.max(0, max - matched.length)), dropped: Math.max(0, all.length - max) };
}

/** The brief's lines for one selection. */
function lines(sel) {
  const out = [];
  for (const l of sel.matched) out.push('- ' + l.id + ' ' + l.gist + (l.detail ? ' — ' + l.detail : ''));
  for (const l of sel.general) out.push('- ' + l.id + ' ' + l.gist);
  return out;
}

/** One line per lesson, what the owner reads back; the list adds the detail beneath, indented. */
function line(l) {
  return l.id + ' [' + l.for.join(',') + '] ' + l.gist + (l.tags.length ? ' #' + l.tags.join(' #') : '');
}

function index(bank, reader) {
  return bank.lessons.filter((l) => !reader || l.for.includes(reader)).sort((a, b) => num(a.id) - num(b.id))
    .map((l) => line(l) + (l.detail ? '\n    ' + l.detail : ''));
}

/** Readers whose general lessons exceed the cap. */
function crowded(bank) {
  return READERS.filter((r) => bank.lessons.filter((l) => l.for.includes(r) && !l.tags.length).length > CAP);
}

/** Every way the bank can be wrong, as messages; [] when clean. */
function lint(bank) {
  const out = [];
  const seen = new Set();
  for (const l of bank.lessons) {
    if (!ID_RE.test(String(l.id))) { out.push('bad id ' + l.id); continue; }
    if (seen.has(l.id)) out.push('duplicate id ' + l.id);
    seen.add(l.id);
    try { validate({ gist: l.gist, for: l.for, tags: l.tags, detail: l.detail }); } catch (e) { out.push(l.id + ': ' + e.message); }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(l.added))) out.push(l.id + ': added must be a date');
    const dup = duplicateOf(bank, l.gist, l.id);
    if (dup && num(dup.id) < num(l.id)) out.push(l.id + ' repeats ' + dup.id);
  }
  if (bank.next <= maxId(bank.lessons)) out.push('next must be above the highest id');
  return out;
}

module.exports = { READERS, GIST_MAX, DETAIL_MAX, TAGS_MAX, CAP, Invalid, bankPath, load, save, validate, add, set, drop, find, select, lines, line, index, crowded, lint };
