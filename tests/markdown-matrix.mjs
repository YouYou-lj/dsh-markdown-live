/**
 * Markdown rendering matrix: one row per construct the plugin claims to render,
 * asserting what a finished line and the line being edited produce.
 *
 * This is a coverage check over the *plan* layer (which classes land where and
 * which boundaries get split) plus the pure grammar/tokenizer. The model-side
 * split and insert behaviour is covered against the real Lexical 0.49 in
 * ../dsh-md-harness/tests/lexical-harness.mjs.
 *
 * Run: node tests/markdown-matrix.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { classify, headingLevelOf } = require('../src/client/grammar.cjs');
const { parseInline } = require('../src/client/inline.cjs');
const { collectLines } = require('../src/client/dom.cjs');
const { planLineMarks } = require('../src/client/decorate.cjs');
const { syntaxPlan, CLASSES } = require('../src/client/syntax.cjs');
const { CSS_TEXT } = require('../src/client/style-sheet.cjs');
const { HIGHLIGHTS, HIGHLIGHT_NAMES } = require('../src/client/constants.cjs');

let passed = 0;
const failures = [];
const rows = [];

/**
 * Build a minimal stub element (enough for the readers under test).
 * @param {string} tagName - tag.
 * @param {object[]} children - child nodes.
 * @returns {object} the stub element.
 */
function element(tagName, children = []) {
  const node = { nodeType: 1, tagName, parentElement: null, nextSibling: null, firstChild: null };
  children.forEach((child, index) => {
    child.parentElement = node;
    child.nextSibling = children[index + 1] ?? null;
    if (index === 0) node.firstChild = child;
  });
  node.children = children.filter(child => child.nodeType === 1);
  node.contains = target => {
    for (let cursor = target; cursor !== null && cursor !== undefined; cursor = cursor.parentElement) {
      if (cursor === node) return true;
    }
    return false;
  };
  node.textContent = children.map(child => (child.nodeType === 3 ? child.nodeValue : child.textContent ?? '')).join('');
  node.classes = new Set();
  node.classList = { add: name => node.classes.add(name), remove: name => node.classes.delete(name), contains: name => node.classes.has(name) };
  node.getAttribute = () => null;
  node.setAttribute = () => {};
  node.hasAttribute = () => false;
  node.removeAttribute = () => {};
  node.matches = () => false;
  return node;
}

/**
 * Build one stub text node.
 * @param {string} value - text.
 * @returns {object} the stub node.
 */
const text = value => ({ nodeType: 3, nodeValue: value, parentElement: null, nextSibling: null });

/**
 * Read the draft's line-shaped plan for one fixture.
 * @param {string[]} lines - one entry per visual line, joined by <br> like the composer.
 * @returns {{lines: object[], finished: object[], editing: object[]}} plan data.
 */
function analyse(lines, column = 0) {
  const children = [];
  lines.forEach((line, index) => {
    if (index > 0) children.push(element('BR'));
    children.push(text(line));
  });
  const paragraph = element('P', children);
  const root = element('DIV', [paragraph]);
  const collected = collectLines(root);
  return {
    lines: collected,
    finished: syntaxPlan(collected, null),
    editing: syntaxPlan(collected, { block: paragraph, line: 0, column }),
  };
}

/**
 * Register and check one matrix row.
 * @param {string} construct - what is being verified.
 * @param {string[]} fixture - the draft's lines.
 * @param {object} expected - expectations.
 * @param {() => void} expected.check - assertions.
 * @returns {void}
 */
function row(construct, fixture, check) {
  const label = `${construct}  (${JSON.stringify(fixture.join('\\n'))})`;
  try {
    check();
    passed += 1;
    rows.push(`✓ ${label}`);
  } catch (error) {
    failures.push({ label, error });
    rows.push(`✗ ${label}`);
  }
}

// ------------------------------------------------------------------ headings

for (const [hashes, level] of [['#', 1], ['##', 2], ['###', 3], ['####', 4], ['#####', 5]]) {
  row(`heading level ${level}`, [`${hashes} 标题`], () => {
    const info = classify(`${hashes} 标题`, { open: false, char: '`', length: 3 });
    assert.equal(info.kind, 'heading');
    assert.equal(headingLevelOf(`${hashes} 标题`), level);
    const { lines, finished } = analyse([`${hashes} 标题`]);
    assert.equal(finished.length, 1, 'the finished line is planned');
    assert.deepEqual(finished[0].ranges[0], { start: 0, end: hashes.length + 1, className: CLASSES.hidden });
    const marks = planLineMarks(lines, null);
    assert.deepEqual(marks.map(mark => mark.level), [level], 'the heading class is planned');
  });
}

row('heading level 6 is ordinary text', ['###### 六级'], () => {
  const info = classify('###### 六级', { open: false, char: '`', length: 3 });
  assert.equal(info.kind, 'text');
  assert.equal(headingLevelOf('###### 六级'), 0);
  const { lines, finished } = analyse(['###### 六级']);
  assert.deepEqual(finished, [], 'no marker is hidden and nothing is enlarged');
  assert.deepEqual(planLineMarks(lines, null), []);
});

row('heading keeps its text verbatim', ['# 标题'], () => {
  const { lines } = analyse(['# 标题']);
  assert.equal(lines[0].text, '# 标题');
});

// ----------------------------------------------------------------- quotes/lists

row('quote hides its marker', ['> 引用'], () => {
  const { finished } = analyse(['> 引用']);
  assert.deepEqual(finished[0].ranges[0], { start: 0, end: 2, className: CLASSES.hidden });
});

row('bullet becomes a dot', ['- 项'], () => {
  const { finished } = analyse(['- 项']);
  assert.deepEqual(finished[0].splits, [1]);
  assert.deepEqual(finished[0].ranges, [{ start: 0, end: 1, className: CLASSES.bullet }]);
});

row('nested bullet keeps its indent', ['  - 缩进项'], () => {
  const { finished } = analyse(['  - 缩进项']);
  assert.deepEqual(finished[0].splits, [2, 3]);
  assert.deepEqual(finished[0].ranges, [{ start: 2, end: 3, className: CLASSES.bullet }]);
});

row('ordered marker is left exactly as typed', ['1. 项'], () => {
  const { finished } = analyse(['1. 项']);
  assert.deepEqual(finished, [], 'no split, no class, no column: the text just follows');
});

row('code tokens are coloured on a finished line', ['```', 'const x = "s" // c', '```'], () => {
  const { finished } = analyse(['```', 'const x = "s" // c', '```']);
  const body = finished.find(item => item.ranges.some(range => range.className === CLASSES.codeLine));
  const classes = new Set(body.ranges.map(range => range.className));
  for (const expected of [CLASSES.codeLine, CLASSES.tokKeyword, CLASSES.tokString, CLASSES.tokComment]) {
    assert.equal(classes.has(expected), true, expected);
  }
});

row('bullet renders while typing once the caret is past the glyph', ['- 项'], () => {
  const { editing } = analyse(['- 项'], 2);
  assert.deepEqual(editing.map(item => item.ranges[0].className), [CLASSES.bullet]);
});

row('bullet stays raw while the caret is inside the glyph', ['- 项'], () => {
  const { editing } = analyse(['- 项'], 0);
  assert.deepEqual(editing, [], 'a transparent glyph under the caret would eat typing');
});

row('a lone bullet is left as source', ['-'], () => {
  const { finished } = analyse(['-']);
  assert.deepEqual(finished, []);
});

// --------------------------------------------------------------------- code

row('fenced block: fences dim, body wears the code face', ['```js', 'const a = 1', '```'], () => {
  const { finished } = analyse(['```js', 'const a = 1', '```']);
  assert.deepEqual(finished.map(item => item.ranges[0].className), [
    CLASSES.codeFence, CLASSES.codeLine, CLASSES.codeFence,
  ]);
});

row('fenced block: the line being edited keeps the code face', ['```', 'code', '```'], () => {
  const { editing } = analyse(['```', 'code', '```']);
  // The opening fence is the line under edit, so it keeps its source form;
  // the body is code while typing and the closing fence is already finished.
  assert.deepEqual(editing.map(item => item.ranges[0].className), [CLASSES.codeLine, CLASSES.codeFence]);
});

row('inline code hides backticks and wears the code face', ['用 `npm i` 安装'], () => {
  const { finished } = analyse(['用 `npm i` 安装']);
  assert.deepEqual(finished[0].splits, [3, 8]);
  assert.deepEqual(finished[0].ranges.map(range => range.className), [
    CLASSES.hidden, CLASSES.hidden, CLASSES.inlineCode,
  ]);
});

row('inline code inside a fence stays plain code', ['```', 'a `b` c', '```'], () => {
  const { finished } = analyse(['```', 'a `b` c', '```']);
  const body = finished.find(item => item.ranges.some(range => range.className === CLASSES.codeLine));
  const classes = new Set(body.ranges.map(range => range.className));
  assert.equal(classes.has(CLASSES.inlineCode), false, 'no inline-code chip inside a block');
  assert.equal(classes.has(CLASSES.hidden), false, 'no backtick hiding inside a block');
});

row('a rule is left at normal colour', ['---'], () => {
  const { finished } = analyse(['---']);
  assert.deepEqual(finished, []);
});

// ------------------------------------------------------------ editing state

row('the caret line keeps its literal markdown', ['# 标题', '- 项', '> 引用'], () => {
  const { editing } = analyse(['# 标题', '- 项', '> 引用']);
  // Only line 0 is under edit; the two finished lines still render.
  assert.deepEqual(editing.map(item => item.lineIndex), [1, 2]);
});

// ---------------------------------------------------------------- inline spans

row('bold, italic, strike and links still paint', ['**粗** *斜* ~~删~~ [链](https://x.dev)'], () => {
  const spans = parseInline('**粗** *斜* ~~删~~ [链](https://x.dev)');
  const kinds = new Set(spans.map(span => span.kind));
  for (const kind of ['strong', 'em', 'strike', 'link', 'marker']) assert.equal(kinds.has(kind), true, kind);
  for (const name of ['strong', 'em', 'strike', 'link', 'marker']) {
    assert.equal(HIGHLIGHT_NAMES.includes(HIGHLIGHTS[name]), true, `${name} has a highlight`);
    assert.match(CSS_TEXT, new RegExp(`::highlight\\(${HIGHLIGHTS[name]}\\)`), `${name} has a rule`);
  }
});

row('code spans keep their text', ['`a` and `b`'], () => {
  const { lines } = analyse(['`a` and `b`']);
  assert.equal(lines[0].text, '`a` and `b`');
});

// ------------------------------------------------------------- integration

row('a full document renders every covered construct in place', [
  '# 标题',
  '## 二级',
  '- 项目',
  '  - 嵌套',
  '1. 有序',
  '> 引用',
  '行内 `code` 与 **粗体**',
  '```js',
  'const a = 1',
  '```',
  '###### 六级',
  '---',
], () => {
  const { finished } = analyse([
    '# 标题',
    '## 二级',
    '- 项目',
    '  - 嵌套',
    '1. 有序',
    '> 引用',
    '行内 `code` 与 **粗体**',
    '```js',
    'const a = 1',
    '```',
    '###### 六级',
    '---',
  ]);
  const byClass = new Map();
  for (const item of finished) {
    for (const range of item.ranges) byClass.set(range.className, (byClass.get(range.className) ?? 0) + 1);
  }
  // Two headings hide their prefixes, two bullets become dots, one quote
  // hides its marker, the inline code hides two backticks, and the fences and
  // the code line get their code classes.
  // two heading prefixes + one quote marker + the two inline-code backticks
  assert.equal(byClass.get(CLASSES.hidden), 5);
  assert.equal(byClass.get(CLASSES.bullet), 2);
  assert.equal(byClass.get(CLASSES.inlineCode), 1);
  assert.equal((byClass.get(CLASSES.codeLine) ?? 0) >= 1, true, 'the code line is coloured');
  assert.equal(byClass.get(CLASSES.codeFence), 2);
  assert.equal(byClass.get(CLASSES.tokKeyword) >= 1, true, 'code tokens are coloured');
  assert.equal(finished.some(item => item.lineIndex === 10), false, 'level six is untouched');
  assert.equal(finished.some(item => item.lineIndex === 11), false, 'a rule is untouched');
});

// -------------------------------------------------------------- pasted draft

row('a pasted block inside one text node renders line by line', [], () => {
  // The composer's paste path inserts the whole payload into one text node,
  // newlines included; the reader must still see separate lines.
  const single = element('P', [text('# 标题\n- 项\n1. 编号')]);
  const root = element('DIV', [single]);
  const lines = collectLines(root);
  assert.deepEqual(lines.map(line => line.text), ['# 标题', '- 项', '1. 编号']);
  const plan = syntaxPlan(lines, null);
  assert.deepEqual(plan.map(item => item.ranges[0].className), [CLASSES.hidden, CLASSES.bullet]);
});

row('a full-width space after a marker still counts', [], () => {
  const heading = classify('#\u3000标题', { open: false, char: '`', length: 3 });
  assert.equal(heading.kind, 'heading');
  const bullet = classify('-\u3000项', { open: false, char: '`', length: 3 });
  assert.equal(bullet.kind, 'list');
  const ordered = classify('1.\u3000项', { open: false, char: '`', length: 3 });
  assert.equal(ordered.kind, 'list');
  const quote = classify('>\u3000引用', { open: false, char: '`', length: 3 });
  assert.equal(quote.kind, 'quote');
});

// ------------------------------------------------------------- css coverage

row('every class the plan uses has a rule and no layout property', [], () => {
  for (const className of [CLASSES.hidden, CLASSES.bullet, CLASSES.codeLine, CLASSES.codeFence, CLASSES.inlineCode]) {
    assert.match(CSS_TEXT, new RegExp(`\\.${className}`), className);
  }
  assert.match(CSS_TEXT, /\.dsh-md-bullet::before/, 'the dot is drawn');
  for (let level = 1; level <= 5; level += 1) {
    assert.match(CSS_TEXT, new RegExp(`\\.dsh-md-h${level}\\b`), `h${level}`);
  }
  assert.equal(/\.dsh-md-h6\b/.test(CSS_TEXT), false, 'no sixth level');
  // Inline chips may carry padding/radius: it widens the chip, never a line
  // box. What must never appear anywhere is a line-height, margin, or an
  // explicit width/height on a text element.
  for (const rule of CSS_TEXT.match(/[^{}]*\{[^}]*\}/g) ?? []) {
    for (const banned of [/line-height:/, /(?:^|[;\s])margin:/, /(?:^|[;\s])width:/, /(?:^|[;\s])height:/]) {
      assert.equal(banned.test(rule), false, `${banned} in ${rule.trim().slice(0, 60)}`);
    }
  }
});

// --------------------------------------------------------------------- report

console.log(rows.join('\n'));
if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`\n✗ ${failure.label}`);
    console.error(String(failure.error && failure.error.stack ? failure.error.stack : failure.error));
  }
  console.error(`\n${passed} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`\n✓ ${passed}/${passed} matrix rows passed`);
