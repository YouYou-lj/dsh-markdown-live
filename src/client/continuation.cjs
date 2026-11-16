/**
 * List auto-continuation: Shift+Enter on a list line starts the next item with
 * the incremented marker.
 *
 * This is the one place the plugin edits the draft instead of only painting it,
 * so the two halves use the cheapest safe channel each:
 *
 *   - **reading** the caret's line uses the rendered DOM only. The composer's
 *     own model is never touched, which keeps this path free of Lexical's
 *     "no active editor state" failure (#195) and of any dependency on its
 *     internal node API;
 *   - **writing** the marker goes through the editor's own update cycle and
 *     the selection's `insertText` — the same call the host uses internally —
 *     and is tagged `history-merge` so one undo removes both the line break and
 *     the marker.
 *
 * The key press itself is never prevented: the host performs its own line
 * break, and the marker follows one frame later. Every failure path degrades to
 * a plain line break and is reported instead of thrown.
 */
const { COMPOSER_INPUT, SKIP_SUBTREE } = require('./constants.cjs');
const { classify } = require('./grammar.cjs');
const { continuationOf, exitPlanOf } = require('./list.cjs');

/** A visible trigger menu owns Enter and Shift+Enter while it is open. */
const MENU_PROBE = '[data-composer-card] [role="listbox"]';
/** @lexical/history merges an update carrying this tag into the previous undo entry. */
const HISTORY_MERGE_TAG = 'history-merge';
/** Elements that start a new visual line without a <br>. */
const BLOCKS = new Set(['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE']);

/** Element test that also works with the stub trees the tests build. */
const isElement = node => node !== null && node !== undefined && node.nodeType === 1;

/** One-shot diagnostics, so a session reports a broken contract once. */
const reported = new Set();

/**
 * Report a diagnostic once per session.
 * @param {string} key - the report identity.
 * @param {string} message - text to emit.
 * @param {unknown} [error] - optional failure cause.
 * @returns {void}
 */
function reportOnce(key, message, error) {
  if (reported.has(key)) return;
  reported.add(key);
  // console.error is the level the desktop shell forwards into its log, so a
  // broken host contract leaves a diagnosable trace instead of silence.
  console.error(message, error === undefined ? '' : error);
}

/**
 * Read the composer's visual lines from the rendered DOM.
 *
 * A line is a run of text between two line breaks: a block boundary or a
 * `<br>` inside a block. Unlike the painter, this keeps empty lines — the
 * continuation needs to address the line the caret just created even before it
 * holds text. Decorative chips are skipped, exactly as the painter skips them.
 *
 * @param {HTMLElement} root - the composer's contenteditable.
 * @returns {{lines: string[], blocks: {element: Element, firstLine: number, count: number}[]}}
 *   the visual lines plus each block's slice of them.
 */
function readLines(root) {
  const lines = [];
  const blocks = [];
  for (const block of root.children) {
    if (!isElement(block)) continue;
    const blockLines = [];
    let text = '';
    const flush = () => {
      blockLines.push(text);
      text = '';
    };
    const visit = node => {
      for (let child = node.firstChild; child !== null; child = child.nextSibling) {
        if (child.nodeType === 3) {
          // A pasted payload can carry newlines inside one text node; they are
          // painted as line breaks, so they are read as line breaks.
          const pieces = (child.nodeValue ?? '').split('\n');
          pieces.forEach((piece, index) => {
            if (index > 0) flush();
            text += piece;
          });
          continue;
        }
        if (child.nodeType !== 1) continue;
        const element = /** @type {Element} */ (child);
        if (element.matches(SKIP_SUBTREE)) continue;
        if (element.tagName === 'BR') {
          // A lone trailing <br> is the browser's placeholder that gives an
          // empty line its height; it is not an extra line of its own.
          if (child.nextSibling === null && text === '') continue;
          flush();
          continue;
        }
        visit(element);
      }
    };
    visit(block);
    flush();
    blocks.push({ element: block, firstLine: lines.length, count: blockLines.length });
    for (const line of blockLines) lines.push(line);
  }
  return { lines, blocks };
}

/**
 * Locate a caret inside one block, in visual-line coordinates.
 *
 * @param {Element} block - the block containing the caret.
 * @param {Node} container - the caret's container node.
 * @param {number} offset - the caret's offset inside that container.
 * @returns {{line: number, column: number} | null} the position, or null.
 */
/**
 * Position of a caret whose container is an element, counting its children.
 * @param {Element} element - the element holding the caret.
 * @param {number} offset - the caret offset among its children.
 * @returns {{line: number, column: number}} the position.
 */
function elementPosition(element, offset) {
  let line = 0;
  let column = 0;
  let index = 0;
  /**
   * Advance the position over one string, counting embedded newlines.
   * @param {string} value - text to consume.
   * @returns {void}
   */
  const advance = value => {
    const pieces = value.split('\n');
    if (pieces.length > 1) {
      line += pieces.length - 1;
      column = pieces[pieces.length - 1].length;
      return;
    }
    column += value.length;
  };
  for (let child = element.firstChild; child !== null && index < offset; child = child.nextSibling, index += 1) {
    if (child.nodeType === 3) {
      advance(child.nodeValue ?? '');
      continue;
    }
    if (child.nodeType !== 1) continue;
    const inner = /** @type {Element} */ (child);
    if (inner.tagName === 'BR') {
      line += 1;
      column = 0;
    } else if (!inner.matches(SKIP_SUBTREE)) {
      advance(inner.textContent === null ? '' : inner.textContent);
    }
  }
  return { line, column };
}

function locateWithin(block, container, offset) {
  if (container === block) return elementPosition(block, offset);
  let line = 0;
  let column = 0;
  let found = false;
  /**
   * Advance the position over one string, counting embedded newlines.
   * @param {string} value - text to consume.
   * @returns {void}
   */
  const advance = value => {
    const pieces = value.split('\n');
    if (pieces.length > 1) {
      line += pieces.length - 1;
      column = pieces[pieces.length - 1].length;
      return;
    }
    column += value.length;
  };
  const visit = node => {
    for (let child = node.firstChild; child !== null; child = child.nextSibling) {
      if (found) return;
      if (child === container) {
        if (child.nodeType === 3) {
          advance((child.nodeValue ?? '').slice(0, offset));
        } else if (child.nodeType === 1) {
          const position = elementPosition(/** @type {Element} */ (child), offset);
          line += position.line;
          column = position.line === 0 ? column + position.column : position.column;
        }
        found = true;
        return;
      }
      if (child.nodeType === 3) {
        advance(child.nodeValue ?? '');
        continue;
      }
      if (child.nodeType !== 1) continue;
      const element = /** @type {Element} */ (child);
      if (element.matches(SKIP_SUBTREE)) continue;
      if (element.tagName === 'BR') {
        line += 1;
        column = 0;
        continue;
      }
      if (element.contains(container)) {
        visit(element);
        return;
      }
      advance(element.textContent === null ? '' : element.textContent);
    }
  };
  visit(block);
  return found ? { line, column } : null;
}

/**
 * Locate an arbitrary caret position in the composer's line coordinates.
 *
 * @param {{lines: string[], blocks: {element: Element, firstLine: number, count: number}[]}} draft - readLines output.
 * @param {Node} container - the caret's container node.
 * @param {number} offset - the caret's offset inside it.
 * @returns {{lineIndex: number, column: number} | null} the caret, or null.
 */
function planForCaret(draft, container, offset) {
  if (container === null || container === undefined) return null;
  for (const block of draft.blocks) {
    if (block.element !== container && !block.element.contains(container)) continue;
    const within = locateWithin(block.element, container, offset);
    if (within === null) return null;
    return { lineIndex: block.firstLine + within.line, column: within.column };
  }
  return null;
}

/**
 * Locate the current selection in the composer's line coordinates.
 * @param {HTMLElement} root - the composer's contenteditable.
 * @param {{lines: string[], blocks: {element: Element, firstLine: number, count: number}[]}} draft - readLines output.
 * @returns {{lineIndex: number, column: number} | null} the caret, or null.
 */
function locateCaret(root, draft) {
  const selection = typeof document.getSelection === 'function' ? document.getSelection() : null;
  if (selection === null || selection.rangeCount === 0 || selection.isCollapsed === false) return null;
  const range = selection.getRangeAt(0);
  if (range.collapsed === false) return null;
  const container = range.startContainer;
  if (container === null || !root.contains(container)) return null;
  return planForCaret(draft, container, range.startOffset);
}

/**
 * Classify one line, carrying fence state from the draft's first line.
 * @param {string[]} lines - every visual line.
 * @param {number} index - the line to classify.
 * @returns {string} the grammar kind of that line.
 */
function kindAt(lines, index) {
  const state = { open: false, char: '`', length: 3 };
  let kind = 'text';
  for (let i = 0; i <= index && i < lines.length; i += 1) kind = classify(lines[i], state).kind;
  return kind;
}

/**
 * Insert text at the caret inside the editor's own update cycle.
 *
 * @param {object} editor - the live Lexical editor.
 * @param {string} text - text to insert.
 * @returns {boolean} whether an insertion was attempted.
 */
function insertAtCaret(editor, text) {
  if (editor === null || editor === undefined || typeof editor.update !== 'function') return false;
  try {
    editor.update(() => {
      const state = editor._pendingEditorState ?? editor.getEditorState();
      const selection = state === null || state === undefined ? null : state._selection;
      if (selection === null || selection === undefined || typeof selection.insertText !== 'function') return;
      selection.insertText(text);
    }, { tag: HISTORY_MERGE_TAG });
    return true;
  } catch (error) {
    reportOnce('insert', '[markdown-live] list continuation could not insert the marker', error);
    return false;
  }
}

/**
 * Read the draft's visual lines as their text nodes, mirroring the DOM reader.
 * @param {object} state - the editor state.
 * @returns {object[][]} text nodes per visual line.
 */
function modelLines(state) {
  const root = state._nodeMap.get('root');
  if (root === null || root === undefined || typeof root.getChildren !== 'function') return [];
  const lines = [];
  for (const block of root.getChildren()) {
    if (typeof block.getChildren !== 'function') continue;
    const children = block.getChildren();
    let parts = [];
    children.forEach((child, index) => {
      const type = typeof child.getType === 'function' ? child.getType() : '';
      if (type === 'linebreak') {
        const isLast = index === children.length - 1;
        if (isLast && parts.length === 0) return;
        lines.push(parts);
        parts = [];
        return;
      }
      if (type === 'text') parts.push(child);
    });
    lines.push(parts);
  }
  return lines;
}

/**
 * Remove one range from the draft by selecting it and deleting, which keeps
 * Lexical in charge of undo and of the caret.
 *
 * @param {object} editor - the live Lexical editor.
 * @param {{lineIndex: number, from: number, to: number}} plan - range to clear.
 * @returns {boolean} whether an update was attempted.
 */
function clearMarker(editor, plan) {
  if (editor === null || editor === undefined || typeof editor.update !== 'function') return false;
  try {
    editor.update(() => {
      const state = editor._pendingEditorState ?? editor.getEditorState();
      if (state === null || state === undefined) return;
      const selection = state._selection;
      if (selection === null || selection === undefined || typeof selection.removeText !== 'function') return;
      const nodes = modelLines(state)[plan.lineIndex];
      if (nodes === undefined) return;
      let offset = 0;
      let anchor = null;
      let focus = null;
      for (const node of nodes) {
        const length = typeof node.getTextContent === 'function' ? node.getTextContent().length : 0;
        const start = offset;
        const end = offset + length;
        offset = end;
        if (anchor === null && plan.from >= start && plan.from < end) anchor = { node, local: plan.from - start };
        if (focus === null && plan.to > start && plan.to <= end) focus = { node, local: plan.to - start };
      }
      if (anchor === null || focus === null) return;
      selection.anchor.set(anchor.node.getKey(), anchor.local, 'text');
      selection.focus.set(focus.node.getKey(), focus.local, 'text');
      selection.removeText();
    }, { tag: HISTORY_MERGE_TAG });
    return true;
  } catch (error) {
    reportOnce('clear', '[markdown-live] could not clear the empty list marker', error);
    return false;
  }
}

/**
 * Build the continuation controller.
 * @returns {{start: () => void, dispose: () => void}} the lifecycle handle.
 */
function createContinuation(options = {}) {
  /** The line a pending marker belongs to; cleared once fulfilled or stale. */
  let pending = null;

  /**
   * Whether the trigger menu is currently visible in the composer card.
   * @returns {boolean} true when a listbox is shown.
   */
  const menuOpen = () => {
    const menu = document.querySelector(MENU_PROBE);
    return menu instanceof HTMLElement && menu.offsetParent !== null;
  };

  /**
   * The composer element owning the current selection.
   * @returns {HTMLElement | null} the active composer, or null.
   */
  const activeComposer = () => {
    const selection = typeof document.getSelection === 'function' ? document.getSelection() : null;
    const node = selection === null ? null : selection.anchorNode;
    if (node === null) return null;
    const element = node.nodeType === 3 ? node.parentElement : node;
    if (!(element instanceof Element)) return null;
    const root = element.closest(COMPOSER_INPUT);
    return root instanceof HTMLElement ? root : null;
  };

  /**
   * The live Lexical editor bound to a composer root.
   * @param {HTMLElement} root - the contenteditable.
   * @returns {object | null} the editor, or null when the host shape changed.
   */
  const editorOf = root => {
    const editor = root.__lexicalEditor;
    if (editor === null || editor === undefined || typeof editor.update !== 'function') {
      reportOnce('editor', '[markdown-live] composer editor contract missing; list continuation is off');
      return null;
    }
    return editor;
  };

  /**
   * Insert the pending marker once the host's line break has landed.
   * @returns {void}
   */
  const fulfil = () => {
    const plan = pending;
    pending = null;
    if (plan === null || plan.root.isConnected !== true) return;
    try {
      const editor = editorOf(plan.root);
      if (editor === null) return;
      const draft = readLines(plan.root);
      const caret = locateCaret(plan.root, draft);
      if (caret === null) {
        reportOnce('caret-lost', '[markdown-live] list continuation: caret not locatable after the line break');
        return;
      }
      // Only continue when the caret actually landed at the start of the very
      // next line; anything else means the user edited or moved in between.
      if (caret.lineIndex !== plan.lineIndex + 1 || caret.column !== 0) {
        reportOnce(
          'unexpected-caret',
          `[markdown-live] list continuation: caret landed at line ${caret.lineIndex} column ${caret.column} (expected line ${plan.lineIndex + 1} column 0)`,
        );
        return;
      }
      if (insertAtCaret(editor, plan.marker) && typeof options.onDraftChanged === 'function') options.onDraftChanged();
    } catch (error) {
      reportOnce('fulfil', '[markdown-live] list continuation skipped after the line break', error);
    }
  };

  /**
   * Capture-phase keydown: recognise a list continuation and schedule it,
   * without preventing the host's own line break.
   * @param {KeyboardEvent} event - the key press.
   * @returns {void}
   */
  const onKeyDown = event => {
    try {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key !== 'Enter' || event.shiftKey === false) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (menuOpen()) return;
      const root = activeComposer();
      if (root === null) return;
      const draft = readLines(root);
      const caret = locateCaret(root, draft);
      if (caret === null || caret.lineIndex >= draft.lines.length) return;
      if (kindAt(draft.lines, caret.lineIndex) !== 'list') return;
      const line = draft.lines[caret.lineIndex];

      // Newline inside an empty item exits the list: the marker is removed and
      // no new line is started, the gesture Obsidian uses.
      const exit = exitPlanOf(line, caret.column);
      if (exit !== null) {
        const editor = editorOf(root);
        if (editor !== null) {
          // Lexical dispatches its Enter command without consulting
          // defaultPrevented, so the event must not reach it at all; this
          // gesture replaces the line break with the marker removal.
          event.preventDefault();
          event.stopImmediatePropagation();
          if (clearMarker(editor, { lineIndex: caret.lineIndex, from: exit.from, to: exit.to })) {
            if (typeof options.onDraftChanged === 'function') options.onDraftChanged();
          }
          return;
        }
      }

      const plan = continuationOf(line.slice(0, caret.column));
      if (plan === null) return;
      pending = { root, lineIndex: caret.lineIndex, marker: `${plan.indent}${plan.marker}` };
      requestAnimationFrame(fulfil);
    } catch (error) {
      reportOnce('keydown', '[markdown-live] list continuation skipped this press', error);
    }
  };

  return {
    start() {
      document.addEventListener('keydown', onKeyDown, true);
    },
    dispose() {
      pending = null;
      document.removeEventListener('keydown', onKeyDown, true);
    },
  };
}

module.exports = {
  createContinuation, insertAtCaret, clearMarker, modelLines, readLines, locateCaret, locateWithin, planForCaret, kindAt, HISTORY_MERGE_TAG,
};
