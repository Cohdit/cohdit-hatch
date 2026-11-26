'use strict';
/**
 * mock.js — the mock-up: what the person will see, drawn before anything is built, and signed off.
 *
 * A designer agent draws every screen of the agreed idea as plain HTML in `mock/` (no framework, no build, no
 * network script), one shared look in `mock/look.css`, the person's own words and examples. Each thing's screen
 * carries `data-item="ITEM-NNN"`, so the script can tell that every thing is drawn and point the builder, the
 * tester and the reviewers at the screens of the one thing they work on. Until it is signed off, nothing is built.
 */
const fs = require('fs');
const path = require('path');

const DIR = 'mock';
const INDEX = 'index.html';
const LOOK = 'look.css';
const REASON_MAX = 400;

class Invalid extends Error {}

function root(dir) { return path.join(dir, DIR); }
function exists(dir) { return fs.existsSync(path.join(root(dir), INDEX)); }

/** The screens on disk: every .html file under mock/, as project-relative paths, sorted. */
function screens(dir) {
  const out = [];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const n of fs.readdirSync(d).sort()) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/\.html?$/i.test(n)) out.push(path.relative(dir, p).split(path.sep).join('/'));
    }
  };
  walk(root(dir));
  return out;
}

/** Which screens show which thing, from the `data-item` marks in the files themselves. Map item -> [files]. */
function itemScreens(dir) {
  const map = new Map();
  for (const f of screens(dir)) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of text.matchAll(/data-item\s*=\s*["']\s*(ITEM-\d{3,})\s*["']/g)) {
      if (!map.has(m[1])) map.set(m[1], []);
      if (!map.get(m[1]).includes(f)) map.get(m[1]).push(f);
    }
  }
  return map;
}

/** The screens of one thing, or []. */
function screensFor(dir, item) {
  return (itemScreens(dir).get(item) || []);
}

/** What the script will not take in a mock: a network script, a framework build, a page that cannot open on its own. */
function lint(dir) {
  const problems = [];
  if (!exists(dir)) problems.push('there is no ' + DIR + '/' + INDEX + ': the screen the person opens first, linking to every other');
  if (!fs.existsSync(path.join(root(dir), LOOK))) problems.push('there is no ' + DIR + '/' + LOOK + ': the one look every screen shares');
  for (const f of screens(dir)) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    if (/<script[^>]+src\s*=\s*["']\s*(?:https?:)?\/\//i.test(text)) problems.push(f + ' loads a script from the network; the mock is plain HTML and opens with no connection');
    if (!/look\.css/.test(text)) problems.push(f + ' does not use ' + LOOK + ', so it would not share the one look');
  }
  return problems;
}

/** The designer's report. Throws Invalid. */
function designerReturn(text) {
  let t = String(text || '').trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
  if (fence) t = fence[1].trim();
  let r;
  try { r = JSON.parse(t); } catch (e) { throw new Invalid('the report is not one JSON block: ' + e.message); }
  if (!r || typeof r !== 'object' || r.verdict !== 'drawn') throw new Invalid('verdict must be drawn');
  const look = typeof r.look === 'string' ? r.look.trim().slice(0, REASON_MAX) : '';
  if (!look) throw new Invalid('look needs one sentence: the look you chose and why it suits this idea');
  return { verdict: 'drawn', look };
}

/** The things this drawing is for: on a first mock-up every thing; once one is signed off, only the things a later
 *  change sent to be drawn (`mock: 'needed'`). */
function pending(spec) {
  const items = (spec.items || []).filter((i) => !i.device);
  return spec.mock && spec.mock.agreed ? items.filter((i) => i.mock === 'needed') : items;
}

/** Everything wrong with the mock as drawn, against the things it is for: [] when it can be shown. */
function problems(dir, spec) {
  const out = lint(dir);
  const map = itemScreens(dir);
  const missing = pending(spec).filter((i) => !map.has(i.id)).map((i) => i.id + ' ' + i.title);
  if (missing.length) out.push('no screen is marked data-item for: ' + missing.join('; '));
  return out;
}

/** The designer's brief: the whole agreed idea, what to draw, the rules the script holds it to, and the person's
 *  changes when this is a redraw. */
function brief(dir, spec, notes, earlier) {
  const out = ['# Draw the mock-up of "' + spec.name + '"', '', 'Folder: ' + dir, '',
    'The idea is agreed. Before anything is built, the person sees it: every screen, as it will look and read, drawn by you as plain HTML they click through in their own browser. Nothing is built until they sign it off, and then every builder builds to it. So this is the first time they see their idea, and the picture everyone works from.', ''];
  out.push('## The idea', spec.name + (spec.for ? ' — for ' + spec.for : '') + (spec.anchor ? '. Worked: ' + spec.anchor : '') + '.');
  if (spec.pitch) out.push(spec.pitch);
  out.push(spec.memory ? 'It remembers things between visits.' : 'It remembers nothing between visits.');
  out.push('', '## The things it is made of, and how the person will check each');
  for (const i of spec.items || []) {
    out.push('- ' + i.id + ' ' + i.title + (i.device ? ' (checked on a device; draw nothing for it)' : ''));
    for (const c of i.criteria || []) out.push('  - ' + c);
  }
  if ((spec.out || []).length) {
    out.push('', '## Not in the first version (draw none of it)');
    for (const o of spec.out) out.push('- ' + o);
  }
  if (notes && notes.length) {
    out.push('', '## What the person asked you to change', 'They have seen the mock-up. Change what they asked, in their words below, and leave the rest as it was.');
    for (const n of notes) out.push('- ' + n);
  }
  const later = spec.mock && spec.mock.agreed;
  const fresh = pending(spec);
  if (later) {
    out.push('', '## What to draw this time', 'The person signed off the mock-up before, and has since asked for something big enough to see first. Draw only these new things into it:');
    for (const i of fresh) out.push('- ' + i.id + ' ' + i.title);
    out.push(exists(dir)
      ? 'Keep every signed-off screen as it is, except where a new thing joins it (a link, a new section). Use the same look.css; add to it only what the new things need.'
      : 'This app was built before mock-ups existed, so there is no mock-up yet: take the look from the app\'s own styles and pages, and draw the new things as they will sit in it, with `' + DIR + '/' + INDEX + '` leading to them.');
  }
  if (earlier) out.push('', 'Your earlier look: ' + earlier);
  out.push('', '## What you draw', 'Everything under `' + DIR + '/`, and nothing anywhere else.',
    '- `' + DIR + '/' + INDEX + '`: the screen the person sees first, with a way to every other screen.',
    '- `' + DIR + '/' + LOOK + '`: the one look. Colours, type, spacing and the shared pieces (buttons, fields, lists, messages) as CSS custom properties and classes. Every screen links it and adds no look of its own.',
    '- One `.html` file per screen. A thing\'s screen marks the part that shows it with `data-item="ITEM-NNN"`; a screen may show several things, and every thing above that is not a device check is marked somewhere.',
    '- High fidelity: what it will really look like, not a sketch. Real content taken from the checks\' own examples (their names, numbers and dates), each thing shown as the person will see it once it has done its job, and where it matters the first-time screen (nothing yet) and the something-wrong one.',
    '- Words: a button, field, heading or message the person named in a check reads exactly as they wrote it ("press Add part" is a button that says Add part). Those words become the app\'s and the browser tests\'.',
    '- It works at phone width and at desktop width.',
    '- Plain HTML and CSS. A small script inside the page only to show what happens on a click (a dialog opening, a row appearing). No framework, no build step, no script from the network; a font from Google Fonts is fine.',
    '- Draw only what the checks above describe, plus what joins them (navigation, a header). Nothing the person did not ask for.',
    '', 'The script reads the folder and refuses a mock that misses a thing, loads a script from the network, or has a screen without the shared look.');
  out.push('', '## Return', 'Your final message is exactly one fenced JSON block, nothing else:', '```json',
    '{"verdict":"drawn","look":"one sentence the person will read: the look you chose and why it suits this idea"}', '```');
  return out.join('\n') + '\n';
}

/** The section a builder's brief carries for one thing. '' when the project has no mock. */
function makerSection(dir, item) {
  if (!exists(dir)) return '';
  const mine = screensFor(dir, item);
  const out = ['## The signed-off mock-up',
    'The person signed off `' + DIR + '/` as what they will see. It is plain HTML, not the app: never link, import or copy its files into the app.'];
  if (mine.length) {
    out.push('This thing is drawn in ' + mine.map((f) => '`' + f + '`').join(', ') + ' (the part marked `data-item="' + item + '"`). Build it to look and read like that: the same layout, the same words on buttons, fields and headings, the same messages.');
  } else {
    out.push('No screen of the mock-up shows this thing: follow the look and the words of the screens around it.');
  }
  out.push('Take colours, type and spacing from `' + DIR + '/' + LOOK + '` into the app\'s own styles, so every page shares the look. Where the mock-up and a check disagree, the check wins: say so in `findings`.');
  return out.join('\n');
}

/** For the tester: where the words for names come from. '' when there is no screen for the thing. */
function testerSection(dir, item) {
  const mine = exists(dir) ? screensFor(dir, item) : [];
  if (!mine.length) return '';
  return ['## The signed-off mock-up', 'The person signed off a mock-up of this thing: ' + mine.map((f) => '`' + f + '`').join(', ') + ' (the part marked `data-item="' + item + '"`). The builder builds to it, so find buttons, fields and headings by the words it shows. Test the checks, not the picture: never assert a colour, a size or a layout.'].join('\n');
}

/** For the reviewers, after the diff. */
function reviewSection(dir, item) {
  const mine = exists(dir) ? screensFor(dir, item) : [];
  if (!mine.length) return '';
  return '\n\n# The signed-off mock-up of this thing: ' + mine.join(', ') + ' (the part marked data-item="' + item + '"), with the shared look in ' + DIR + '/' + LOOK + '.\n# The person agreed to it before the build. A page that departs from it in look or words, where no check asked for that, is a must-fix.\n';
}

module.exports = { DIR, INDEX, LOOK, Invalid, root, exists, screens, itemScreens, screensFor, lint, pending, problems, designerReturn, brief, makerSection, testerSection, reviewSection };
