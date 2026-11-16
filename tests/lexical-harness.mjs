/**
 * Headless verification harness for dsh-markdown-live.
 *
 * Runs the plugin's editor-facing code against the *real* Lexical 0.49 — the
 * same version the running DSH bundles — with no browser and no DOM.
 * It exists because the live composer cannot be driven from this environment,
 * and because the bug it was written for (Lexical #195, "no active editor
 * state") only reproduces against a real editor.
 *
 * Findings encoded here, learned from the real library:
 *   - node methods throw outside an active editor state, so reads must run in
 *     a read callback;
 *   - `editor.update()` commits asynchronously, so a test must yield a tick
 *     before reading the committed state;
 *   - `editor.read()` force-commits a pending update and sees the newest text;
 *   - back-to-back updates queue, and the later callback already sees the
 *     earlier update's selection.
 *
 * Run: node tests/lexical-harness.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  $createLineBreakNode, $createParagraphNode, $createRangeSelection, $createTextNode,
  $getRoot, $setSelection, createEditor,
} from 'lexical';

const require = createRequire(import.meta.url);
const HERE = new URL('.', import.meta.url).pathname;
const PLUGIN = `${HERE}../src/client`;
const { clearMarker, insertAtCaret, kindAt } = require(`${PLUGIN}/continuation.cjs`);
const { applyRenumber, renumberPlan } = require(`${PLUGIN}/renumber.cjs`);
const { splitSyntax } = require(`${PLUGIN}/syntax.cjs`);
const { normalizeNewlines } = require(`${PLUGIN}/newlines.cjs`);
const { continuationOf } = require(`${PLUGIN}/list.cjs`);

let passed = 0;
const failures = [];

/**
 * Run one named async assertion.
 * @param {string} name - test name.
 * @param {() => Promise<void>} body - the assertions.
 * @returns {Promise<void>} resolves when the test finishes.
 */
async function test(name, body) {
  try {
    await body();
    passed += 1;
  } catch (error) {
    failures.push({ name, error });
  }
}

/** Wait for Lexical's queued commits to land. */
const tick = () => new Promise(resolve => setTimeout(resolve, 5));

/**
 * Build an editor whose draft is the given visual lines.
 * @param {string[]} lines - one entry per visual line.
 * @param {{line: number, column: number}} caret - caret position.
 * @returns {object} the editor.
 */
function editorWith(lines, caret) {
  const editor = createEditor({ namespace: 'harness', onError: error => { throw error; } });
  editor.update(() => {
    const root = $getRoot();
    for (const line of lines) {
      const paragraph = $createParagraphNode();
      line.split('\n').forEach((part, index) => {
        if (index > 0) paragraph.append($createLineBreakNode());
        if (part.length > 0) paragraph.append($createTextNode(part));
      });
      root.append(paragraph);
    }
    const paragraph = root.getChildAtIndex(caret.line);
    const selection = $createRangeSelection();
    let remaining = caret.column;
    let target = null;
    for (const child of paragraph.getChildren()) {
      if (child.getType() === 'linebreak') continue;
      const text = child.getTextContent();
      if (remaining <= text.length) {
        target = { node: child, offset: remaining };
        break;
      }
      remaining -= text.length;
    }
    if (target === null) {
      const last = paragraph.getLastChild();
      if (last === null) {
        selection.anchor.set(paragraph.getKey(), 0, 'element');
        selection.focus.set(paragraph.getKey(), 0, 'element');
        $setSelection(selection);
        return;
      }
      target = { node: last, offset: last.getTextContent().length };
    }
    selection.anchor.set(target.node.getKey(), target.offset, 'text');
    selection.focus.set(target.node.getKey(), target.offset, 'text');
    $setSelection(selection);
  });
  return editor;
}

/**
 * Append one line break at the caret, as the host does for Shift+Enter.
 * @param {object} editor - the editor.
 * @returns {void}
 */
function lineBreakAtCaret(editor) {
  editor.update(() => {
    const state = editor._pendingEditorState ?? editor.getEditorState();
    const selection = state._selection;
    assert.notEqual(selection, null, 'selection must exist');
    selection.insertParagraph();
  });
}

/**
 * Flatten the draft into visual lines.
 * @param {object} editor - the editor.
 * @returns {string[]} one entry per visual line.
 */
const linesOf = editor => editor.read(() => $getRoot().getChildren().map(block => block.getTextContent().replace(/\n$/, '')));

// ---------------------------------------------------------------- continuation

await test('continuation: the marker comes from the current line', () => {
  assert.deepEqual(continuationOf('1. first'), { indent: '', marker: '2. ', kind: 'ordered' });
  assert.deepEqual(continuationOf('  - nested'), { indent: '  ', marker: '- ', kind: 'bullet' });
});

await test('continuation: fenced code is not a list', () => {
  assert.notEqual(kindAt(['```', '1. not a list', '```'], 1), 'list');
  assert.equal(kindAt(['1. a'], 0), 'list');
});

// ------------------------------------------------------------------ insertion

await test('insert: the marker lands at the caret', async () => {
  const editor = editorWith(['1. first', ''], { line: 1, column: 0 });
  assert.equal(insertAtCaret(editor, '2. '), true);
  await tick();
  assert.deepEqual(linesOf(editor), ['1. first', '2. ']);
});

await test('insert: the caret ends after the inserted marker', async () => {
  const editor = editorWith(['1. first', ''], { line: 1, column: 0 });
  insertAtCaret(editor, '2. ');
  await tick();
  const where = editor.read(() => {
    const selection = editor.getEditorState()._selection;
    const anchor = selection === null ? null : selection.anchor;
    const node = anchor === null ? null : anchor.getNode();
    return {
      text: node === null ? null : node.getTextContent(),
      offset: anchor === null ? null : anchor.offset,
    };
  });
  assert.equal(where.text, '2. ');
  assert.equal(where.offset, 3);
});

await test('insert: existing content keeps its place', async () => {
  const editor = editorWith(['- bullet', 'tail'], { line: 1, column: 0 });
  insertAtCaret(editor, '- ');
  await tick();
  assert.deepEqual(linesOf(editor), ['- bullet', '- tail']);
});

// ------------------------------------------------------------- the real gesture

await test('gesture: the host break, then the marker, end to end', async () => {
  const editor = editorWith(['1. first'], { line: 0, column: 8 });
  const plan = continuationOf('1. first');
  assert.notEqual(plan, null);

  // The host inserts the line break itself; the marker follows in a later update.
  lineBreakAtCaret(editor);
  await tick();
  assert.deepEqual(linesOf(editor), ['1. first', '']);

  insertAtCaret(editor, `${plan.indent}${plan.marker}`);
  await tick();
  assert.deepEqual(linesOf(editor), ['1. first', '2. ']);
});

await test('gesture: the caret stays on the new line after the marker', async () => {
  const editor = editorWith(['1. first'], { line: 0, column: 8 });
  lineBreakAtCaret(editor);
  await tick();
  insertAtCaret(editor, '2. ');
  await tick();
  const text = editor.read(() => {
    const root = $getRoot();
    const paragraph = root.getLastChild();
    const selection = editor.getEditorState()._selection;
    return { paragraph: paragraph.getTextContent(), collapsed: selection !== null && selection.isCollapsed() };
  });
  assert.equal(text.paragraph, '2. ');
  assert.equal(text.collapsed, true);
});

await test('gesture: a code fence line is not a list line', () => {
  assert.notEqual(kindAt(['```', '1. code', '```'], 1), 'list');
});

// ------------------------------------------------------------------- renumber

await test('renumber: a duplicated number is rewritten in place', async () => {
  const editor = editorWith(['1. a', '2. b', '2. c'], { line: 0, column: 4 });
  const plan = renumberPlan(['1. a', '2. b', '2. c'], 0);
  assert.deepEqual(plan.map(change => change.digits), ['3']);
  assert.equal(applyRenumber(editor, plan), true);
  await tick();
  assert.deepEqual(linesOf(editor), ['1. a', '2. b', '3. c']);
});

await test('renumber: the caret keeps its node and offset', async () => {
  const editor = editorWith(['1. a', '2. b', '2. c'], { line: 0, column: 4 });
  applyRenumber(editor, renumberPlan(['1. a', '2. b', '2. c'], 0));
  await tick();
  const where = editor.read(() => {
    const selection = editor.getEditorState()._selection;
    const anchor = selection.anchor;
    return { text: anchor.getNode().getTextContent(), offset: anchor.offset };
  });
  assert.equal(where.text, '1. a');
  assert.equal(where.offset, 4);
});

await test('renumber: a canonical group is not edited', () => {
  const editor = editorWith(['1. a', '2. b'], { line: 1, column: 4 });
  assert.equal(applyRenumber(editor, renumberPlan(['1. a', '2. b'], 1)), false);
});

await test('renumber: a wider number shifts the digits, not the text', async () => {
  const editor = editorWith(['1. a', '9. b'], { line: 0, column: 4 });
  const plan = renumberPlan(['1. a', '9. b'], 0);
  assert.equal(plan[0].digits, '2');
  applyRenumber(editor, plan);
  await tick();
  assert.deepEqual(linesOf(editor), ['1. a', '2. b']);
});

// ------------------------------------------------------------- syntax collapse

await test('collapse: the heading prefix becomes its own text node', async () => {
  const editor = editorWith(['# 标题'], { line: 0, column: 4 });
  assert.equal(splitSyntax(editor, [{ lineIndex: 0, boundaries: [2] }]), true);
  await tick();
  const shape = editor.read(() => {
    const paragraph = $getRoot().getFirstChild();
    return {
      children: paragraph.getChildren().map(child => child.getTextContent()),
      text: paragraph.getTextContent().replace(/\n$/, ''),
    };
  });
  assert.deepEqual(shape.children, ['# ', '标题']);
  assert.equal(shape.text, '# 标题', 'hiding a marker never changes the text');
});

await test('collapse: each soft-wrapped line is split on its own', async () => {
  const editor = editorWith(['# one\n> two'], { line: 0, column: 0 });
  assert.equal(splitSyntax(editor, [{ lineIndex: 0, boundaries: [2] }, { lineIndex: 1, boundaries: [2] }]), true);
  await tick();
  const shape = editor.read(() => {
    const paragraph = $getRoot().getFirstChild();
    return paragraph.getChildren().map(child => (child.getType() === 'linebreak' ? '\n' : child.getTextContent()));
  });
  assert.deepEqual(shape, ['# ', 'one', '\n', '> ', 'two']);
});

await test('collapse: an already isolated prefix is left untouched', async () => {
  const editor = editorWith(['# one'], { line: 0, column: 5 });
  splitSyntax(editor, [{ lineIndex: 0, boundaries: [2] }]);
  await tick();
  splitSyntax(editor, [{ lineIndex: 0, boundaries: [2] }]);
  await tick();
  const children = editor.read(() => $getRoot().getFirstChild().getChildren().map(child => child.getTextContent()));
  assert.deepEqual(children, ['# ', 'one'], 'no third node appears');
});

await test('collapse: the caret keeps its node and offset', async () => {
  const editor = editorWith(['# one\ntwo'], { line: 0, column: 8 });
  splitSyntax(editor, [{ lineIndex: 0, boundaries: [2] }]);
  await tick();
  const where = editor.read(() => {
    const selection = editor.getEditorState()._selection;
    return { text: selection.anchor.getNode().getTextContent(), offset: selection.anchor.offset };
  });
  assert.equal(where.text, 'two');
  assert.equal(where.offset, 3);
});

await test('collapse: a marker that grew is merged back and split again', async () => {
  const editor = createEditor({ namespace: 'grow', onError: error => { throw error; } });
  editor.update(() => {
    const paragraph = $createParagraphNode();
    const marker = $createTextNode('#');
    marker.toggleUnmergeable();
    const rest = $createTextNode(' 标题');
    rest.toggleUnmergeable();
    paragraph.append(marker, rest);
    $getRoot().append(paragraph);
  });
  await tick();
  assert.equal(splitSyntax(editor, [{ lineIndex: 0, boundaries: [2] }]), true);
  await tick();
  const children = editor.read(() => $getRoot().getFirstChild().getChildren().map(child => child.getTextContent()));
  assert.deepEqual(children, ['#', ' ', '标题']);
  assert.equal(editor.read(() => $getRoot().getFirstChild().getTextContent().replace(/\n$/, '')), '# 标题');
});

await test('collapse: a bullet isolates indent, glyph and content', async () => {
  const editor = editorWith(['  - item'], { line: 0, column: 0 });
  splitSyntax(editor, [{ lineIndex: 0, boundaries: [2, 3] }]);
  await tick();
  const children = editor.read(() => $getRoot().getFirstChild().getChildren().map(child => child.getTextContent()));
  assert.deepEqual(children, ['  ', '-', ' item']);
});

await test('collapse: inline code hides its backticks around a code span', async () => {
  const editor = editorWith(['a `b` c'], { line: 0, column: 0 });
  splitSyntax(editor, [{ lineIndex: 0, boundaries: [2, 3, 4, 5] }]);
  await tick();
  const children = editor.read(() => $getRoot().getFirstChild().getChildren().map(child => child.getTextContent()));
  assert.deepEqual(children, ['a ', '`', 'b', '`', ' c']);
});

await test('collapse: multi-line code keeps its fences and body apart', async () => {
  const editor = editorWith(['```\nconst a = 1\n```'], { line: 0, column: 0 });
  splitSyntax(editor, [{ lineIndex: 1, boundaries: [2] }]);
  await tick();
  const texts = editor.read(() => $getRoot().getChildren().map(block => block.getTextContent().replace(/\n$/, '')));
  assert.deepEqual(texts, ['```\nconst a = 1\n```']);
});

// --------------------------------------------------------------- exit an item

await test('exit: an empty item loses its marker and keeps the indent', async () => {
  const editor = editorWith(['  - '], { line: 0, column: 4 });
  assert.equal(clearMarker(editor, { lineIndex: 0, from: 2, to: 4 }), true);
  await tick();
  const text = editor.read(() => $getRoot().getFirstChild().getTextContent().replace(/\n$/, ''));
  assert.equal(text, '  ', 'the indentation survives, the marker does not');
});

await test('exit: the caret ends where the marker was removed', async () => {
  const editor = editorWith(['1. ', 'next'], { line: 0, column: 3 });
  clearMarker(editor, { lineIndex: 0, from: 0, to: 3 });
  await tick();
  const where = editor.read(() => {
    const selection = editor.getEditorState()._selection;
    const anchor = selection.anchor;
    return { offset: anchor.offset, type: anchor.type, text: $getRoot().getFirstChild().getTextContent().replace(/\n$/, '') };
  });
  assert.equal(where.text, '');
  assert.equal(where.offset, 0);
});

await test('exit: a later line is untouched', async () => {
  const editor = editorWith(['- ', 'body'], { line: 0, column: 2 });
  clearMarker(editor, { lineIndex: 0, from: 0, to: 2 });
  await tick();
  const lines = editor.read(() => $getRoot().getChildren().map(block => block.getTextContent().replace(/\n$/, '')));
  assert.deepEqual(lines, ['', 'body']);
});

// --------------------------------------------------------------- pasted draft

await test('paste: the whole payload lands in one text node', async () => {
  const editor = createEditor({ namespace: 'paste', onError: error => { throw error; } });
  editor.update(() => {
    const paragraph = $createParagraphNode();
    $getRoot().append(paragraph);
    const selection = $createRangeSelection();
    selection.anchor.set(paragraph.getKey(), 0, 'element');
    selection.focus.set(paragraph.getKey(), 0, 'element');
    $setSelection(selection);
    selection.insertText('# 标题\n- 项\n1. 编号');
  });
  await tick();
  const types = editor.read(() => $getRoot().getFirstChild().getChildren().map(child => child.getType()));
  assert.deepEqual(types, ['text'], 'Lexical keeps the newlines inside the node');
});

await test('paste: normalisation turns them into real line breaks', async () => {
  const editor = createEditor({ namespace: 'paste2', onError: error => { throw error; } });
  editor.update(() => {
    const paragraph = $createParagraphNode();
    $getRoot().append(paragraph);
    const selection = $createRangeSelection();
    selection.anchor.set(paragraph.getKey(), 0, 'element');
    selection.focus.set(paragraph.getKey(), 0, 'element');
    $setSelection(selection);
    selection.insertText('# 标题\n- 项\n```\ncode\n```');
  });
  await tick();
  assert.equal(normalizeNewlines(editor), true);
  await tick();
  const shape = editor.read(() => {
    const paragraph = $getRoot().getFirstChild();
    return {
      types: paragraph.getChildren().map(child => child.getType()),
      text: paragraph.getTextContent().replace(/\n$/, ''),
    };
  });
  assert.deepEqual(shape.types, ['text', 'linebreak', 'text', 'linebreak', 'text', 'linebreak', 'text', 'linebreak', 'text']);
  assert.equal(shape.text, '# 标题\n- 项\n```\ncode\n```', 'the draft text is unchanged');
});

await test('paste: the caret follows the normalised text', async () => {
  const editor = createEditor({ namespace: 'paste3', onError: error => { throw error; } });
  editor.update(() => {
    const paragraph = $createParagraphNode();
    $getRoot().append(paragraph);
    const selection = $createRangeSelection();
    selection.anchor.set(paragraph.getKey(), 0, 'element');
    selection.focus.set(paragraph.getKey(), 0, 'element');
    $setSelection(selection);
    selection.insertText('a\nbc');
  });
  await tick();
  normalizeNewlines(editor);
  await tick();
  const where = editor.read(() => {
    const selection = editor.getEditorState()._selection;
    return { text: selection.anchor.getNode().getTextContent(), offset: selection.anchor.offset };
  });
  assert.equal(where.text, 'bc');
  assert.equal(where.offset, 2);
});

await test('paste: a normalised block can then be split line by line', async () => {
  const editor = createEditor({ namespace: 'paste4', onError: error => { throw error; } });
  editor.update(() => {
    const paragraph = $createParagraphNode();
    $getRoot().append(paragraph);
    const selection = $createRangeSelection();
    selection.anchor.set(paragraph.getKey(), 0, 'element');
    selection.focus.set(paragraph.getKey(), 0, 'element');
    $setSelection(selection);
    selection.insertText('# 标题\n- 项');
  });
  await tick();
  normalizeNewlines(editor);
  await tick();
  assert.equal(splitSyntax(editor, [{ lineIndex: 0, boundaries: [2] }, { lineIndex: 1, boundaries: [1] }]), true);
  await tick();
  const children = editor.read(() => $getRoot().getFirstChild().getChildren().map(child => (child.getType() === 'linebreak' ? '\n' : child.getTextContent())));
  assert.deepEqual(children, ['# ', '标题', '\n', '-', ' 项']);
});

// --------------------------------------------------------------------- report

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`✗ ${failure.name}`);
    console.error(String(failure.error && failure.error.stack ? failure.error.stack : failure.error));
  }
  console.error(`\n${passed} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`✓ ${passed} lexical assertions passed`);
