/**
 * Zero-dependency test suite for dsh-markdown-live.
 *
 * Covers the pure Markdown grammar, the visual-line traversal over a stub node
 * tree, the generated bundle's shape, the manifest, and the locale/icon
 * resources — everything that can be verified without a browser. Visual
 * behaviour in the running composer is not asserted here; see README
 * "Verification".
 *
 * Run: node tests/run-tests.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { classify, headingLevelOf } = require('../src/client/grammar.cjs');
const { parseInline } = require('../src/client/inline.cjs');
const { HIGHLIGHT_NAMES, HIGHLIGHTS, SKIP_SUBTREE } = require('../src/client/constants.cjs');
const { collectLines, rangesOf } = require('../src/client/dom.cjs');
const { applyLineMarks, planLineMarks, HEADING_CLASSES } = require('../src/client/decorate.cjs');
const { applySyntax, syntaxPlan, CLASSES } = require('../src/client/syntax.cjs');
const { caretLineOf } = require('../src/client/render.cjs');
const { tokenize } = require('../src/client/tokens.cjs');
const { probeContract } = require('../src/client/compat.cjs');
const { continuationOf, exitMarkerOf, exitPlanOf, isEmptyListItem } = require('../src/client/list.cjs');
const { readLines, planForCaret, kindAt } = require('../src/client/continuation.cjs');
const { createRenumber, renumberPlan, SETTLE_MS } = require('../src/client/renumber.cjs');
const { CSS_TEXT } = require('../src/client/style-sheet.cjs');

let passed = 0;
const failures = [];

/**
 * Run one named assertion.
 * @param {string} name - test name.
 * @param {() => void} body - assertions to execute.
 * @returns {void}
 */
function test(name, body) {
  try {
    body();
    passed += 1;
  } catch (error) {
    failures.push({ name, error });
  }
}

/**
 * Project the spans of one kind from a line, sorted by start.
 * @param {string} text - the Markdown line.
 * @param {string} kind - span kind to keep.
 * @returns {[number, number][]} inclusive-exclusive ranges.
 */
function spansOf(text, kind) {
  return parseInline(text)
    .filter(span => span.kind === kind)
    .map(span => [span.start, span.end])
    .sort((a, b) => a[0] - b[0]);
}

/**
 * Classify one standalone line with a fresh fence state.
 * @param {string} text - the line.
 * @returns {ReturnType<typeof classify>} the classification.
 */
function one(text) {
  return classify(text, { open: false, char: '`' });
}

// ---------------------------------------------------------------- line grammar

test('heading: hashes plus space, markers expose the prefix', () => {
  const info = one('## 标题');
  assert.equal(info.kind, 'heading');
  assert.equal(info.contentStart, 3);
  assert.deepEqual(info.markers, [{ start: 0, end: 3 }]);
});

test('heading: a CJK run may follow the hashes without a space', () => {
  assert.equal(one('##二级标题').kind, 'heading');
  assert.equal(one('##二级标题').contentStart, 2);
  assert.equal(one('# 标题').contentStart, 2);
});

test('heading: latin hashtags stay plain text', () => {
  assert.equal(one('#not-a-heading').kind, 'text');
  assert.equal(one('#hashtag').kind, 'text');
  assert.equal(one('####### seven').kind, 'text');
});

test('heading: levels 1-5 render, six or more is ordinary text', () => {
  for (const [prefix, level] of [['#', 1], ['##', 2], ['###', 3], ['####', 4], ['#####', 5]]) {
    assert.equal(one(`${prefix} 标题`).kind, 'heading');
    assert.equal(headingLevelOf(`${prefix} 标题`), level);
  }
  // Unsupported markers must stay normal text: no dimming, no collapsing.
  assert.equal(one('###### 六级').kind, 'text');
  assert.equal(one('####### 七级').kind, 'text');
  assert.equal(headingLevelOf('###### 六级'), 0);
});

test('heading: a bare hash run is an empty heading', () => {
  assert.equal(one('#').kind, 'heading');
  assert.equal(one('###').kind, 'heading');
});

test('heading level: reported for block-level styling', () => {
  assert.equal(headingLevelOf('# 标题'), 1);
  assert.equal(headingLevelOf('### 三级'), 3);
  assert.equal(headingLevelOf('##二级'), 2);
  assert.equal(headingLevelOf('#hashtag'), 0);
  assert.equal(headingLevelOf('- item'), 0);
  assert.equal(headingLevelOf('plain'), 0);
});

test('list: bullets and ordered markers', () => {
  assert.equal(one('- item').kind, 'list');
  assert.equal(one('- item').contentStart, 2);
  assert.equal(one('1. step').kind, 'list');
  assert.equal(one('1. step').contentStart, 3);
  assert.equal(one('   - nested').kind, 'list');
  assert.equal(one('12) item').contentStart, 4);
});

test('list: a bare bullet keeps its marker range', () => {
  const info = one('- ');
  assert.equal(info.kind, 'list');
  assert.deepEqual(info.markers, [{ start: 0, end: 2 }]);
});

test('quote: leading angle bracket', () => {
  const info = one('> quoted');
  assert.equal(info.kind, 'quote');
  assert.equal(info.contentStart, 2);
  assert.deepEqual(info.markers, [{ start: 0, end: 2 }]);
});

test('rule: three or more of one character with optional spaces', () => {
  assert.equal(one('---').kind, 'hr');
  assert.equal(one('- - -').kind, 'hr');
  assert.equal(one('***').kind, 'hr');
  assert.equal(one('___').kind, 'hr');
  assert.equal(one('--').kind, 'text');
});

test('fence: opens, bodies, and closes', () => {
  const state = { open: false, char: '`' };
  assert.equal(classify('```js', state).kind, 'fence-open');
  assert.equal(state.open, true);
  assert.equal(state.char, '`');
  assert.equal(classify('const a = 1', state).kind, 'fence-body');
  assert.equal(classify('```', state).kind, 'fence-close');
  assert.equal(state.open, false);
});

test('fence: a shorter closing run stays body text', () => {
  const state = { open: false, char: '`', length: 3 };
  assert.equal(classify('````', state).kind, 'fence-open');
  assert.equal(state.length, 4);
  assert.equal(classify('```', state).kind, 'fence-body');
  assert.equal(classify('````', state).kind, 'fence-close');
});

test('quote: nested markers advance the content start', () => {
  assert.equal(one('>> nested').contentStart, 3);
  assert.deepEqual(one('>> nested').markers, [{ start: 0, end: 3 }]);
});

test('fence: tilde fences and mismatched closers', () => {
  const state = { open: false, char: '`' };
  assert.equal(classify('~~~~', state).kind, 'fence-open');
  assert.equal(state.char, '~');
  assert.equal(classify('```', state).kind, 'fence-body', 'a backtick run never closes a tilde fence');
  assert.equal(classify('~~~', state).kind, 'fence-body', 'a run shorter than the opener stays body');
  assert.equal(classify('~~~~', state).kind, 'fence-close');
});

test('fence: content after the closing run keeps the line as body', () => {
  const state = { open: false, char: '`' };
  classify('```', state);
  assert.equal(classify('``` trailing', state).kind, 'fence-body');
});

test('blank lines are reported as blank', () => {
  assert.equal(one('').kind, 'blank');
  assert.equal(one('   ').kind, 'blank');
});

// ------------------------------------------------------------------ inline spans

test('plain text produces no spans', () => {
  assert.deepEqual(parseInline('just words here'), []);
});

test('bold: content plus dimmed delimiters', () => {
  assert.deepEqual(spansOf('**bold**', 'strong'), [[2, 6]]);
  assert.deepEqual(spansOf('**bold**', 'marker'), [[0, 2], [6, 8]]);
  assert.deepEqual(spansOf('__bold__', 'strong'), [[2, 6]]);
});

test('italic: single delimiters', () => {
  assert.deepEqual(spansOf('*it*', 'em'), [[1, 3]]);
  assert.deepEqual(spansOf('_it_', 'em'), [[1, 3]]);
});

test('strikethrough', () => {
  assert.deepEqual(spansOf('~~gone~~', 'strike'), [[2, 6]]);
});

test('inline code owns its backticks', () => {
  assert.deepEqual(spansOf('a `code` b', 'code'), [[3, 7]]);
  assert.deepEqual(spansOf('a `code` b', 'marker'), [[2, 3], [7, 8]]);
  assert.deepEqual(spansOf('``a`b``', 'code'), [[2, 5]]);
});

test('link: label is the link, brackets and target are markers', () => {
  assert.deepEqual(spansOf('[label](https://example.com)', 'link'), [[1, 6]]);
  assert.deepEqual(spansOf('[label](https://example.com)', 'marker'), [[0, 1], [6, 7], [7, 8], [8, 27], [27, 28]]);
});

test('emphasis guards keep prose literal', () => {
  assert.deepEqual(parseInline('2 * 3 * 4'), []);
  assert.deepEqual(parseInline('snake_case_name'), []);
  assert.deepEqual(parseInline('a * b'), []);
  assert.deepEqual(parseInline('https://x.dev/a_b_c'), []);
});

test('escaped delimiters stay literal', () => {
  assert.deepEqual(parseInline('\\*not em\\*'), []);
  assert.deepEqual(parseInline('\\`not code\\`'), []);
});

test('code wins over emphasis inside it', () => {
  const kinds = parseInline('`*not em*`').map(span => span.kind);
  assert.equal(kinds.includes('em'), false);
  assert.equal(kinds.includes('code'), true);
});

test('mixed constructs on one line', () => {
  const spans = parseInline('**a** `b` ~~c~~ and [d](e)');
  assert.deepEqual(spans.filter(s => s.kind === 'strong').map(s => [s.start, s.end]), [[2, 3]]);
  assert.deepEqual(spans.filter(s => s.kind === 'code').map(s => [s.start, s.end]), [[7, 8]]);
  assert.deepEqual(spans.filter(s => s.kind === 'strike').map(s => [s.start, s.end]), [[12, 13]]);
  assert.deepEqual(spans.filter(s => s.kind === 'link').map(s => [s.start, s.end]), [[21, 22]]);
});

test('escaped characters stay literal inside inline code', () => {
  assert.deepEqual(spansOf('`\\(x\\)`', 'code'), [[1, 6]]);
  assert.deepEqual(spansOf('`a\\*b`', 'code'), [[1, 5]]);
  assert.deepEqual(spansOf('`x\\.y`', 'code'), [[1, 5]]);
});

test('multi-character delimiters close against a following word', () => {
  assert.deepEqual(spansOf('**bold**text', 'strong'), [[2, 6]]);
  assert.deepEqual(spansOf('~~gone~~y', 'strike'), [[2, 6]]);
});

test('triple delimiters render strong plus emphasis once', () => {
  const spans = parseInline('***both***');
  assert.deepEqual(spans.filter(s => s.kind === 'strong').map(s => [s.start, s.end]), [[3, 7]]);
  assert.deepEqual(spans.filter(s => s.kind === 'em').map(s => [s.start, s.end]), [[3, 7]]);
  assert.deepEqual(spans.filter(s => s.kind === 'marker').map(s => [s.start, s.end]), [[0, 3], [7, 10]]);
});

test('arithmetic with doubled operators stays prose', () => {
  assert.deepEqual(parseInline('2 ** 3'), []);
  assert.deepEqual(parseInline('a ** b ** c'), []);
});

test('unbalanced delimiters degrade to literal text', () => {
  assert.deepEqual(parseInline('**open only'), []);
  assert.deepEqual(parseInline('`tick only'), []);
  assert.deepEqual(parseInline('[label](no-close'), []);
});

// ------------------------------------------------------------- list continuation

test('continuation: ordered items increment and keep delimiter and spacing', () => {
  assert.deepEqual(continuationOf('1. '), { indent: '', marker: '2. ', kind: 'ordered' });
  assert.deepEqual(continuationOf('9. '), { indent: '', marker: '10. ', kind: 'ordered' });
  assert.deepEqual(continuationOf('10) '), { indent: '', marker: '11) ', kind: 'ordered' });
  assert.deepEqual(continuationOf('  3. item'), { indent: '  ', marker: '4. ', kind: 'ordered' });
  assert.deepEqual(continuationOf('1.  '), { indent: '', marker: '2.  ', kind: 'ordered' });
});

test('continuation: bullets repeat their own marker', () => {
  assert.deepEqual(continuationOf('- '), { indent: '', marker: '- ', kind: 'bullet' });
  assert.deepEqual(continuationOf('* item'), { indent: '', marker: '* ', kind: 'bullet' });
  assert.deepEqual(continuationOf('   + '), { indent: '   ', marker: '+ ', kind: 'bullet' });
});

test('continuation: prose and bare numbers stay untouched', () => {
  assert.equal(continuationOf('plain text'), null);
  assert.equal(continuationOf(''), null);
  assert.equal(continuationOf('1'), null);
  assert.equal(continuationOf('1 apple'), null);
  assert.equal(continuationOf('1.5 apples'), null);
  assert.equal(continuationOf('```'), null);
  assert.equal(continuationOf('   '), null);
  assert.equal(continuationOf('a. text'), null);
});

test('exit: an empty item reports the marker range to clear', () => {
  assert.deepEqual(exitMarkerOf('1. '), { indentEnd: 0, markerEnd: 3 });
  assert.deepEqual(exitMarkerOf('- '), { indentEnd: 0, markerEnd: 2 });
  assert.deepEqual(exitMarkerOf('  - '), { indentEnd: 2, markerEnd: 4 });
  assert.equal(exitMarkerOf('- item'), null, 'an item with content continues instead');
  assert.equal(exitMarkerOf('plain'), null);
});

test('exit: the gesture only fires from inside an empty item', () => {
  assert.deepEqual(exitPlanOf('1. ', 3), { from: 0, to: 3 });
  assert.deepEqual(exitPlanOf('- ', 2), { from: 0, to: 2 });
  assert.deepEqual(exitPlanOf('  - ', 4), { from: 2, to: 4 });
  assert.equal(exitPlanOf('  - ', 2), null, 'a caret at the indent asks for a line above');
  assert.equal(exitPlanOf('- item', 6), null, 'content continues the list');
  assert.equal(exitPlanOf('plain', 5), null);
});

test('renumber: repairs promptly and exposes an immediate entry point', () => {
  assert.equal(SETTLE_MS <= 200, true, 'the settle window must feel immediate');
  const controller = createRenumber();
  assert.equal(typeof controller.repairNow, 'function');
});

test('continuation: empty list items are recognised', () => {
  assert.equal(isEmptyListItem('1. '), true);
  assert.equal(isEmptyListItem('- '), true);
  assert.equal(isEmptyListItem('1. x'), false);
  assert.equal(isEmptyListItem('plain'), false);
});



// ------------------------------------------------------------ list renumbering

test('renumber: a canonical group costs nothing', () => {
  assert.deepEqual(renumberPlan(['1. a', '2. b', '3. c'], 0), []);
});

test('renumber: a duplicated number repairs the lines after it', () => {
  const plan = renumberPlan(['1. a', '2. x', '2. b', '3. c'], 1);
  assert.deepEqual(plan.map(change => [change.lineIndex, change.digits]), [[2, '3'], [3, '4']]);
});

test('renumber: a gap is closed', () => {
  const plan = renumberPlan(['1. a', '3. b'], 0);
  assert.deepEqual(plan.map(change => [change.lineIndex, change.digits]), [[1, '2']]);
});

test('renumber: the caret line is never edited', () => {
  const plan = renumberPlan(['1. a', '2. b', '2. c'], 1);
  assert.deepEqual(plan.map(change => change.lineIndex), [2]);
});

test('renumber: a lone item is repaired once the caret leaves it', () => {
  assert.deepEqual(renumberPlan(['3. only'], -1).map(change => change.digits), ['1']);
  assert.deepEqual(renumberPlan(['3. only'], 0), [], 'the caret line is never rewritten');
});

test('renumber: nested groups are repaired independently', () => {
  const lines = ['1. a', '  1. x', '  3. y', '2. b'];
  const plan = renumberPlan(lines, 3);
  assert.deepEqual(plan.map(change => [change.lineIndex, change.digits]), [[2, '2']]);
});

test('renumber: fenced code is not a list', () => {
  assert.deepEqual(renumberPlan(['```', '1. a', '1. b', '```'], 0), []);
});

test('renumber: the rewrite covers exactly the digits', () => {
  const plan = renumberPlan(['1. a', '9. b'], 0);
  assert.deepEqual(plan[0], { lineIndex: 1, start: 0, end: 1, digits: '2' });
});

test('renumber: indented markers keep the indent out of the rewrite', () => {
  const plan = renumberPlan(['  1. a', '  4. b'], 0);
  assert.equal(plan[0].start, 2);
  assert.equal(plan[0].end, 3);
});




test('collapse: a rule keeps its normal colour (nothing to render)', () => {
  const root = stubElement('DIV', [stubElement('P', [stubText('---')]), stubElement('P', [stubText('****')])]);
  assert.deepEqual(syntaxPlan(collectLines(root), null), []);
});

test('collapse: an unsupported sixth level is left as ordinary text', () => {
  const root = stubElement('DIV', [stubElement('P', [stubText('###### 六级')])]);
  assert.deepEqual(syntaxPlan(collectLines(root), null), []);
});

test('collapse: a finished heading hides its hashes, the caret line keeps them', () => {
  const root = stubElement('DIV', [stubElement('P', [stubText('# 标题')])]);
  const lines = collectLines(root);
  const finished = syntaxPlan(lines, null);
  assert.deepEqual(finished.map(item => item.splits), [[2]]);
  assert.deepEqual(finished[0].ranges, [{ start: 0, end: 2, className: CLASSES.hidden }]);
  assert.deepEqual(syntaxPlan(lines, { block: lines[0].block, line: 0 }), []);
});

test('collapse: a bullet marker becomes a dot, ordered markers stay', () => {
  const root = stubElement('DIV', [
    stubElement('P', [stubText('- item')]),
    stubElement('P', [stubText('1. item')]),
    stubElement('P', [stubText('> quoted')]),
  ]);
  const plan = syntaxPlan(collectLines(root), null);
  assert.deepEqual(plan[0], {
    lineIndex: 0,
    splits: [1],
    ranges: [{ start: 0, end: 1, className: CLASSES.bullet }],
  });
  assert.equal(plan.length, 2, 'an ordered marker needs no treatment');
  assert.deepEqual(plan[1].ranges, [{ start: 0, end: 2, className: CLASSES.hidden }]);
});

test('collapse: code gets its face and its fences wait for the block to finish', () => {
  const root = stubElement('DIV', [
    stubElement('P', [stubText('```')]),
    stubElement('P', [stubText('const a = 1')]),
    stubElement('P', [stubText('```')]),
  ]);
  const lines = collectLines(root);
  const plan = syntaxPlan(lines, null);
  assert.deepEqual(plan.map(item => item.ranges[0].className), [CLASSES.codeFence, CLASSES.codeLine, CLASSES.codeFence]);
  // Inside the block the caret's line is still code; the fences are hidden
  // only once the block is finished.
  const editingInside = syntaxPlan(lines, { block: lines[1].block, line: 1 });
  assert.deepEqual(editingInside.map(item => item.ranges[0].className), [CLASSES.codeFence, CLASSES.codeLine, CLASSES.codeFence]);
});

test('collapse: inline code hides its backticks and wears a code face', () => {
  const root = stubElement('DIV', [stubElement('P', [stubText('use `npm i` now')])]);
  const plan = syntaxPlan(collectLines(root), null);
  assert.deepEqual(plan[0].splits, [5, 10]);
  assert.deepEqual(plan[0].ranges.map(range => range.className), [
    CLASSES.hidden, CLASSES.hidden, CLASSES.inlineCode,
  ]);
});

test('collapse: the marker hides again after a second visit', () => {
  const marker = stubElement('SPAN', [stubText('# ')]);
  const content = stubElement('SPAN', [stubText('标题')]);
  const block = stubElement('P', [marker, content]);
  const root = stubElement('DIV', [block]);
  const touched = new Set();
  const lines = collectLines(root);

  assert.deepEqual(applySyntax(lines, null, touched), []);
  assert.equal(marker.classList.contains(CLASSES.hidden), true, 'first finish hides');
  assert.equal(content.classList.contains(CLASSES.hidden), false);

  applySyntax(lines, { block, line: 0 }, touched);
  assert.equal(marker.classList.contains(CLASSES.hidden), false, 'editing reveals');

  applySyntax(lines, null, touched);
  assert.equal(marker.classList.contains(CLASSES.hidden), true, 'leaving hides again');
});

test('collapse: an unsplit marker is reported instead of hiding content', () => {
  const block = stubElement('P', [stubElement('SPAN', [stubText('#')]), stubElement('SPAN', [stubText(' 标题')])]);
  const root = stubElement('DIV', [block]);
  const touched = new Set();
  const requests = applySyntax(collectLines(root), null, touched);
  assert.deepEqual(requests, [{ lineIndex: 0, boundaries: [2] }]);
  assert.equal(touched.size, 0, 'nothing is hidden when the marker is not isolated');
});


// --------------------------------------------------------------- host contract

/**
 * Build a stub composer whose contract pieces are selectable.
 * @param {{editor?: boolean, split?: boolean, text?: boolean}} options - pieces to include.
 * @returns {object} the stub root.
 */
function stubComposer(options = {}) {
  const withSplit = options.split !== false;
  const withText = options.text !== false;
  const textClass = withText
    ? { prototype: { splitText: withSplit ? () => {} : undefined, toggleUnmergeable: () => {} } }
    : undefined;
  return {
    nodeType: 1,
    children: [{ nodeType: 1, querySelectorAll: () => [{}] }],
    __lexicalEditor: options.editor === false ? null : {
      update: () => {},
      getEditorState: () => {},
      _nodes: {
        get: name => (name === 'linebreak' ? { klass: function LineBreak() {} } : { klass: textClass }),
      },
    },
  };
}

test('compat: a complete contract probes clean', () => {
  const previousCSS = globalThis.CSS;
  const previousHighlight = globalThis.Highlight;
  globalThis.CSS = { highlights: {} };
  globalThis.Highlight = function Highlight() {};
  try {
    assert.deepEqual(probeContract(stubComposer()), { ok: true, missing: [] });
  } finally {
    globalThis.CSS = previousCSS;
    globalThis.Highlight = previousHighlight;
  }
});

test('compat: a moved piece is named instead of thrown', () => {
  const previousCSS = globalThis.CSS;
  const previousHighlight = globalThis.Highlight;
  globalThis.CSS = { highlights: {} };
  globalThis.Highlight = function Highlight() {};
  try {
    assert.equal(probeContract(stubComposer({ editor: false })).missing.includes('editor.__lexicalEditor'), true);
    assert.equal(probeContract(stubComposer({ text: false })).missing.includes('linebreak node class'), false);
    assert.equal(probeContract(stubComposer({ split: false })).missing.includes('text.splitText'), true);
  } finally {
    globalThis.CSS = previousCSS;
    globalThis.Highlight = previousHighlight;
  }
});

test('compat: an absent composer reports the hook, not a crash', () => {
  const previousCSS = globalThis.CSS;
  const previousHighlight = globalThis.Highlight;
  globalThis.CSS = { highlights: {} };
  globalThis.Highlight = function Highlight() {};
  try {
    const result = probeContract(null);
    assert.equal(result.ok, false);
    assert.equal(result.missing.includes('[data-composer-input]'), true);
  } finally {
    globalThis.CSS = previousCSS;
    globalThis.Highlight = previousHighlight;
  }
});

// ------------------------------------------------------- list continuation read
//
// The continuation reads the caret from the rendered DOM (never from Lexical's
// model), so these run against stub trees; the write side is covered by the
// real-Lexical harness in ../dsh-md-harness.

test('line marks: a finished heading line grows, the caret line does not', () => {
  const first = stubElement('P', [stubText('# 标题')]);
  const second = stubElement('P', [stubText('## 二级')]);
  const root = stubElement('DIV', [first, second]);
  const lines = collectLines(root);
  const onSecond = planLineMarks(lines, { block: second, line: 0 });
  assert.deepEqual(onSecond.map(mark => mark.level), [1], 'only the finished line is marked');
  assert.deepEqual(planLineMarks(lines, { block: first, line: 0 }).map(mark => mark.level), [2]);
  assert.deepEqual(planLineMarks(lines, null).map(mark => mark.level), [1, 2]);
});

test('line marks: the level class lands on the text element, not the block', () => {
  const text = stubText('# 标题');
  const block = stubElement('P', [text]);
  const root = stubElement('DIV', [block]);
  const marked = new Set();
  applyLineMarks(collectLines(root), null, marked);
  assert.equal(text.parentElement, block, 'stub text sits directly in the paragraph');
  // With no Lexical span between text and block, nothing is marked: styling the
  // block would reach every line in it.
  assert.equal(marked.size, 0);
});

test('line marks: inside one soft-wrapped paragraph only finished lines grow', () => {
  const firstSpan = stubElement('SPAN', [stubText('# 标题')]);
  const secondSpan = stubElement('SPAN', [stubText('body')]);
  const paragraph = stubElement('P', [firstSpan, stubElement('BR', []), secondSpan]);
  const root = stubElement('DIV', [paragraph]);
  const marked = new Set();
  applyLineMarks(collectLines(root), { block: paragraph, line: 1 }, marked);
  assert.equal(firstSpan.classList.contains(HEADING_CLASSES[0]), true, 'the finished heading grows');
  assert.equal(secondSpan.classList.contains(HEADING_CLASSES[0]), false, 'the caret line stays plain');
  applyLineMarks(collectLines(root), { block: paragraph, line: 0 }, marked);
  assert.equal(firstSpan.classList.contains(HEADING_CLASSES[0]), false, 'editing the heading line returns it to plain');
});

test('line marks: clearing restores the element', () => {
  const span = stubElement('SPAN', [stubText('# 标题')]);
  const block = stubElement('P', [span]);
  const root = stubElement('DIV', [block]);
  const marked = new Set();
  applyLineMarks(collectLines(root), null, marked);
  assert.equal(marked.size, 1);
  assert.equal(span.classList.contains(HEADING_CLASSES[0]), true);
  applyLineMarks(collectLines(root), { block, line: 0 }, marked);
  assert.equal(span.classList.contains(HEADING_CLASSES[0]), false);
});

test('continuation read: blocks and <br> become visual lines, empties kept', () => {
  const root = stubElement('DIV', [
    stubElement('P', [stubText('1. a')]),
    stubElement('P', [stubElement('BR', [])]),
    stubElement('P', [stubText('tail')]),
  ]);
  const draft = readLines(root);
  assert.deepEqual(draft.lines, ['1. a', '', 'tail']);
  assert.deepEqual(draft.blocks.map(block => block.firstLine), [0, 1, 2]);
});

test('continuation read: a <br> inside one paragraph splits its lines', () => {
  const root = stubElement('DIV', [stubElement('P', [stubText('a'), stubElement('BR', []), stubText('b')])]);
  assert.deepEqual(readLines(root).lines, ['a', 'b']);
});

test('continuation read: chip text is not part of the line', () => {
  const root = stubElement('DIV', [
    stubElement('P', [
      stubText('1. '),
      stubElement('SPAN', [stubText('@file')], { skipped: true }),
      stubText(' tail'),
    ]),
  ]);
  assert.deepEqual(readLines(root).lines, ['1.  tail']);
});

test('continuation read: a text caret maps to its line and column', () => {
  const text = stubText('1. first');
  const root = stubElement('DIV', [stubElement('P', [text])]);
  const draft = readLines(root);
  assert.deepEqual(planForCaret(draft, text, 4), { lineIndex: 0, column: 4 });
});

test('continuation read: a caret on a soft-wrapped line maps to that line', () => {
  const second = stubText('bcd');
  const root = stubElement('DIV', [stubElement('P', [stubText('abc'), stubElement('BR', []), second])]);
  const draft = readLines(root);
  assert.deepEqual(planForCaret(draft, second, 2), { lineIndex: 1, column: 2 });
});

test('continuation read: an element caret in an empty paragraph maps to its line', () => {
  const empty = stubElement('P', []);
  const root = stubElement('DIV', [stubElement('P', [stubText('1. a')]), empty]);
  const draft = readLines(root);
  assert.deepEqual(planForCaret(draft, empty, 0), { lineIndex: 1, column: 0 });
});

test('continuation read: the line kind follows fence state', () => {
  assert.equal(kindAt(['1. a'], 0), 'list');
  assert.notEqual(kindAt(['```', '1. a', '```'], 1), 'list');
});

// ------------------------------------------------------- visual-line traversal
//
// Structural unit tests over a stub node tree: they pin the traversal rules
// (block boundaries, <br>, chip skipping, run offsets) without claiming to
// verify how the host's real composer renders. Input is a plain object graph
// with the same shape collectLines consumes.

/**
 * Build one stub text node.
 * @param {string} value - its text.
 * @returns {object} the stub node.
 */
function stubText(value) {
  return { nodeType: 3, nodeValue: value, nextSibling: null, parentElement: null };
}

/**
 * Build one stub element and link its children.
 * @param {string} tagName - element tag.
 * @param {object[]} children - child nodes.
 * @param {{skipped?: boolean}} [options] - whether it matches the chip selector.
 * @returns {object} the stub element.
 */
function stubElement(tagName, children, options = {}) {
  const node = {
    nodeType: 1,
    tagName,
    firstChild: null,
    nextSibling: null,
    parentElement: null,
    skipped: options.skipped === true,
  };
  node.matches = selector => node.skipped === true && selector === SKIP_SUBTREE;
  children.forEach((child, index) => {
    child.parentElement = node;
    child.nextSibling = children[index + 1] ?? null;
    if (index === 0) node.firstChild = child;
  });
  node.classes = new Set();
  node.classList = {
    add: name => node.classes.add(name),
    remove: name => node.classes.delete(name),
    contains: name => node.classes.has(name),
  };
  node.attributes = new Map();
  node.getAttribute = name => (node.attributes.has(name) ? node.attributes.get(name) : null);
  node.setAttribute = (name, value) => { node.attributes.set(name, String(value)); };
  node.hasAttribute = name => node.attributes.has(name);
  node.removeAttribute = name => { node.attributes.delete(name); };
  node.children = children.filter(child => child.nodeType === 1);
  node.contains = target => {
    for (let cursor = target; cursor !== null && cursor !== undefined; cursor = cursor.parentElement) {
      if (cursor === node) return true;
    }
    return false;
  };
  node.textContent = children.map(child => (child.nodeType === 3 ? child.nodeValue : child.textContent ?? '')).join('');
  return node;
}

test('traversal: blocks and <br> each start a new visual line', () => {
  const root = stubElement('DIV', [
    stubElement('P', [stubText('first')]),
    stubElement('P', [stubText('a'), stubElement('BR', []), stubText('b')]),
  ]);
  assert.deepEqual(collectLines(root).map(line => line.text), ['first', 'a', 'b']);
});

test('traversal: chip subtrees are skipped without shifting run offsets', () => {
  const root = stubElement('DIV', [
    stubElement('P', [
      stubText('see '),
      stubElement('SPAN', [stubText('@file')], { skipped: true }),
      stubText(' end'),
    ]),
  ]);
  const [line] = collectLines(root);
  assert.equal(line.text, 'see  end');
  assert.deepEqual(line.runs.map(run => [run.start, run.end]), [[0, 4], [4, 8]]);
});

test('traversal: a pasted newline splits one text node into lines', () => {
  const node = stubText('# 标题\n- 项');
  const root = stubElement('DIV', [stubElement('P', [node])]);
  const lines = collectLines(root);
  assert.deepEqual(lines.map(line => line.text), ['# 标题', '- 项']);
  assert.deepEqual(lines[0].runs.map(run => [run.start, run.end, run.nodeStart]), [[0, 4, 0]]);
  assert.deepEqual(lines[1].runs.map(run => [run.start, run.end, run.nodeStart]), [[0, 3, 5]]);
});

test('projection: a run that starts mid-node maps its true offsets', () => {
  const previous = globalThis.document;
  globalThis.document = {
    createRange() {
      return {
        start: null,
        end: null,
        setStart(node, offset) { this.start = [node, offset]; },
        setEnd(node, offset) { this.end = [node, offset]; },
      };
    },
  };
  try {
    const node = stubText('ab\ncd');
    const root = stubElement('DIV', [stubElement('P', [node])]);
    const [, second] = collectLines(root);
    const ranges = rangesOf(second, 0, 2);
    assert.equal(ranges.length, 1);
    assert.equal(ranges[0].start[1], 3, 'the second line starts after the newline');
    assert.equal(ranges[0].end[1], 5);
  } finally {
    globalThis.document = previous;
  }
});

test('projection: one span across two text nodes yields one range each', () => {
  const previous = globalThis.document;
  globalThis.document = {
    createRange() {
      return {
        start: null,
        end: null,
        setStart(node, offset) { this.start = [node, offset]; },
        setEnd(node, offset) { this.end = [node, offset]; },
      };
    },
  };
  try {
    const root = stubElement('DIV', [stubElement('P', [stubText('ab'), stubText('cd')])]);
    const [line] = collectLines(root);
    const ranges = rangesOf(line, 1, 3);
    assert.equal(ranges.length, 2);
    assert.equal(ranges[0].start[0], line.runs[0].node);
    assert.equal(ranges[0].start[1], 1);
    assert.equal(ranges[0].end[0], line.runs[0].node);
    assert.equal(ranges[0].end[1], 2);
    assert.equal(ranges[1].start[0], line.runs[1].node);
    assert.equal(ranges[1].start[1], 0);
    assert.equal(ranges[1].end[0], line.runs[1].node);
    assert.equal(ranges[1].end[1], 1);
    assert.deepEqual(rangesOf(line, 2, 2), []);
  } finally {
    globalThis.document = previous;
  }
});

test('traversal: an empty paragraph still owns one line', () => {
  const root = stubElement('DIV', [
    stubElement('P', [stubElement('BR', [])]),
    stubElement('P', [stubText('kept')]),
  ]);
  const lines = collectLines(root);
  assert.deepEqual(lines.map(line => line.text), ['', 'kept']);
  assert.deepEqual(lines.map(line => line.lineInBlock), [0, 0]);
});

// --------------------------------------------------------------- generated bundle

const clientSource = readFileSync(join(root, 'client.js'), 'utf8');

test('bundle: compiles as a classic script', () => {
  assert.doesNotThrow(() => new vm.Script(clientSource, { filename: 'client.js' }));
});

test('bundle: registers under the package name and defines every module', () => {
  assert.match(clientSource, /id: 'dsh-markdown-live'/);
  for (const id of ['constants', 'grammar', 'list', 'inline', 'dom', 'render', 'continuation', 'style-sheet', 'index']) {
    assert.match(clientSource, new RegExp(`__define\\('\\./${id}\\.cjs'`), `missing module ${id}`);
  }
  assert.match(clientSource, /return \{ name: entry\.name, apply: entry\.apply \}/);
});

test('bundle: every required module id is defined', () => {
  const defined = new Set([...clientSource.matchAll(/__define\('([^']+)'/g)].map(match => match[1]));
  const required = new Set([...clientSource.matchAll(/require\('(\.\/[^']+)'\)/g)].map(match => match[1]));
  for (const id of required) assert.equal(defined.has(id), true, `required but not defined: ${id}`);
  assert.equal(required.size >= 6, true, 'expected the bundle to require its own modules');
});

test('bundle: is not stale', () => {
  execFileSync(process.execPath, [join(root, 'scripts/build.mjs'), '--check'], { stdio: 'pipe' });
});

test('stylesheet: heading classes change size only, never weight or layout', () => {
  const rules = CSS_TEXT.match(/\[data-composer-input\] \.dsh-md-h[^{]*\{[^}]*\}/g) ?? [];
  assert.equal(rules.length, 5, 'one rule per supported heading level');
  for (const rule of rules) {
    assert.match(rule, /font-size:/);
    for (const banned of ['font-weight', 'line-height', 'margin', 'padding', 'border', 'width', 'height', 'display', 'position', 'transform', 'letter-spacing']) {
      assert.equal(rule.includes(`${banned}:`), false, `unexpected property ${banned} in ${rule}`);
    }
  }
});

test('stylesheet: code classes wear the host code palette', () => {
  const rule = selector => (CSS_TEXT.match(new RegExp(`\\[data-composer-input\\] \\.${selector}[^{]*\\{[^}]*\\}`)) ?? [''])[0];
  for (const selector of ['dsh-md-code-line', 'dsh-md-code-fence', 'dsh-md-inline-code']) {
    assert.match(rule(selector), /font-family:/, `${selector} wears the code face`);
    for (const banned of ['width', 'height', 'display', 'position', 'line-height']) {
      assert.equal(rule(selector).includes(`${banned}:`), false, `${selector} must not set ${banned}`);
    }
  }
  assert.match(rule('dsh-md-code-line'), /--shiki-background/, 'the block uses the host code surface');
  for (const token of ['string', 'number', 'keyword', 'function', 'comment', 'punctuation']) {
    assert.match(rule(`dsh-md-tok-${token}`), /--shiki-token/, `${token} uses the host token palette`);
  }
  assert.match(CSS_TEXT, /\.dsh-md-bullet::before\s*\{/);
  assert.equal(CSS_TEXT.includes(String.raw`content: '\2022'`), true, 'the bullet is drawn as a dot');
});

test('stylesheet: ordered markers carry no column or indent', () => {
  assert.equal(/dsh-md-ordered/.test(CSS_TEXT), false, 'nothing is applied to a numbered marker');
});

test('tokens: keywords, strings, numbers, calls and comments are classified', () => {
  const kinds = text => tokenize(text).map(span => span.kind);
  assert.deepEqual(kinds('const x = 1'), ['keyword', 'punctuation', 'number']);
  assert.deepEqual(kinds('"hello"'), ['string']);
  assert.equal(kinds('// note').includes('comment'), true);
  assert.equal(kinds('foo(1)').includes('function'), true);
  assert.equal(kinds('const MAX = 1').includes('value'), true);
});

test('stylesheet: one paint-only rule per highlight name', () => {
  for (const name of HIGHLIGHT_NAMES) {
    assert.match(CSS_TEXT, new RegExp(`::highlight\\(${name}\\)\\s*\\{`), `missing rule ${name}`);
  }
  const declarations = CSS_TEXT.match(/::highlight\([^)]+\)\s*\{[^}]*\}/g) ?? [];
  for (const rule of declarations) {
    for (const banned of ['font-weight', 'font-style', 'font-size', 'font-family', 'line-height', 'letter-spacing', 'padding', 'margin', 'border', 'width', 'height', 'display', 'position', 'transform', 'inset', 'top', 'left']) {
      assert.equal(rule.includes(`${banned}:`), false, `layout-affecting property ${banned} in ${rule}`);
    }
  }
  assert.equal(CSS_TEXT.includes('spelling-error'), false);
  const emRule = (CSS_TEXT.match(/::highlight\(dsh-md-em\)\s*\{[^}]*\}/) ?? [''])[0];
  assert.match(emRule, /text-decoration-style:\s*double/);
  assert.match(emRule, /text-decoration-thickness:\s*3px/, 'double degrades below 3px');
  // Chromium ignores -webkit-text-stroke inside ::highlight(), so weight must
  // come from text-shadow; assert the working mechanism is the one shipped.
  const strongRule = (CSS_TEXT.match(/::highlight\(dsh-md-strong\)\s*\{[^}]*\}/) ?? [''])[0];
  assert.match(strongRule, /text-shadow:/, 'bold uses text-shadow weight');
  assert.equal(/-webkit-text-stroke\s*:/.test(CSS_TEXT), false, 'text-stroke is a no-op in ::highlight()');
  assert.equal(CSS_TEXT.includes('dsh-md-heading'), false, 'headings are not a highlight');
});

// -------------------------------------------------------------------- manifest

const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

test('manifest: bundle and client declarations', () => {
  assert.equal(manifest.name, 'dsh-markdown-live');
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(manifest.dsh.client.platform, 'web');
  assert.equal(manifest.exports['./client'], './client.js');
  assert.equal(manifest.exports['./icon'], './icon.svg');
  assert.equal(manifest.exports['./locale/*.json'], './locale/*.json');
});

test('manifest: files covers every runtime and display resource', () => {
  for (const entry of ['index.js', 'client.js', 'cordis.patch.yml', 'locale', 'icon.svg', 'README.md', 'src']) {
    assert.equal(manifest.files.includes(entry), true, `files missing ${entry}`);
  }
});

test('patch: inserts the plugin row under the package name', () => {
  const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8');
  assert.match(patch, /- insert:/);
  assert.match(patch, /- id: markdown-live/);
  assert.match(patch, /name: dsh-markdown-live/);
});

test('locales: title and description in English and Chinese', () => {
  for (const locale of ['en', 'zh']) {
    const data = JSON.parse(readFileSync(join(root, `locale/${locale}.json`), 'utf8'));
    assert.equal(typeof data.meta.title, 'string');
    assert.equal(data.meta.title.length > 0, true);
    assert.equal(typeof data.meta.description, 'string');
    assert.equal(data.meta.description.length > 40, true);
  }
});

test('icon: self-contained SVG within the size limit', () => {
  const icon = readFileSync(join(root, 'icon.svg'), 'utf8');
  assert.equal(statSync(join(root, 'icon.svg')).size < 256 * 1024, true);
  assert.match(icon, /viewBox="0 0 36 36"/);
  for (const banned of ['<text', '<style', '<script', '<image', 'foreignObject', '<animate']) {
    assert.equal(icon.includes(banned), false, `icon must not contain ${banned}`);
  }
});

test('highlight names are namespaced and distinct', () => {
  const names = Object.values(HIGHLIGHTS);
  assert.equal(new Set(names).size, names.length);
  for (const name of names) assert.match(name, /^dsh-md-/);
});

// ----------------------------------------------------------------------- report

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`✗ ${failure.name}`);
    console.error(String(failure.error && failure.error.message ? failure.error.message : failure.error));
  }
  console.error(`\n${passed} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`✓ ${passed} assertions passed`);
