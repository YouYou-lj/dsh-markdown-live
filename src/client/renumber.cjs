/**
 * Ordered-list renumbering: keep every contiguous ordered group numbered 1..n.
 *
 * Continuation numbers the line the user just created; renumbering repairs the
 * lines around an insertion or a deletion. Together they are the two halves of
 * "the numbers just work", and both stay inside the draft: the message the
 * model receives carries the same digits the composer shows.
 *
 * Two rules keep the edits unsurprising:
 *
 *   - **the caret's own line is never edited.** Rewriting digits under a caret
 *     would move it, so that line keeps whatever number it has and the lines
 *     after it are numbered from there;
 *   - **a group in canonical order costs nothing.** A group already numbered
 *     1..n produces an empty plan, so ordinary typing never rewrites text;
 *   - **a lone item is left alone.** Only groups of two or more are repaired,
 *     so starting a list at "3." does not get rewritten under the author.
 *
 * The plan is computed from the rendered DOM (the same reader the continuation
 * uses); the edit is applied through the editor's update cycle so Lexical owns
 * the model, undo, and reconciliation.
 */
const { COMPOSER_INPUT } = require('./constants.cjs');
const { classify } = require('./grammar.cjs');
const { readLines, locateCaret } = require('./continuation.cjs');

/** @lexical/history merges an update carrying this tag into the previous undo entry. */
const HISTORY_MERGE_TAG = 'history-merge';
/** Ordered marker: indent, digits, delimiter, spacing. */
const ORDERED_RE = /^([ \t]{0,12})(\d{1,9})([.)])([ \t\u00a0\u3000]+)/;
/** How long the draft must stay quiet before numbers are repaired. */
const SETTLE_MS = 150;
/** Mutations this soon after our own edit are the edit itself, not the user. */
const SELF_WINDOW_MS = 250;

/**
 * Compute the digit rewrites that make every ordered group 1..n.
 *
 * @param {string[]} lines - the draft's visual lines.
 * @param {number} caretLine - index of the line to leave untouched, or -1.
 * @returns {{lineIndex: number, start: number, end: number, digits: string}[]}
 *   rewrites in line coordinates; empty when nothing needs repairing.
 */
function renumberPlan(lines, caretLine) {
  const plan = [];
  const state = { open: false, char: '`', length: 3 };
  let group = [];
  let groupIndent = '';

  /**
   * Close the current group, emitting rewrites when its numbers are not 1..n.
   * @returns {void}
   */
  const flush = () => {
    if (group.length === 0) return;
    group.forEach((item, position) => {
      if (item.index === caretLine) return;
      const digits = String(position + 1);
      if (digits === item.digits) return;
      plan.push({ lineIndex: item.index, start: item.start, end: item.start + item.digits.length, digits });
    });
    group = [];
    groupIndent = '';
  };

  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index];
    const kind = classify(text, state).kind;
    const match = kind === 'list' ? ORDERED_RE.exec(text) : null;
    if (match === null) {
      flush();
      continue;
    }
    const indent = match[1];
    if (group.length > 0 && indent !== groupIndent) flush();
    groupIndent = indent;
    group.push({
      index,
      digits: match[2],
      start: indent.length,
    });
  }
  flush();
  return plan;
}

/**
 * Apply a renumber plan inside one editor update, restoring the caret.
 *
 * The caret is restored by key and offset: every rewrite targets a line other
 * than the caret's, so its node is untouched and survives the edit.
 *
 * @param {object} editor - the live Lexical editor.
 * @param {{lineIndex: number, start: number, end: number, digits: string}[]} plan - rewrites to apply.
 * @returns {boolean} whether an update was attempted.
 */
function applyRenumber(editor, plan) {
  if (editor === null || editor === undefined || typeof editor.update !== 'function') return false;
  if (!Array.isArray(plan) || plan.length === 0) return false;
  try {
    editor.update(() => {
      const state = editor._pendingEditorState ?? editor.getEditorState();
      if (state === null || state === undefined) return;
      const selection = state._selection;
      if (selection === null || selection === undefined) return;
      const saved = {
        anchorKey: selection.anchor.key,
        anchorOffset: selection.anchor.offset,
        anchorType: selection.anchor.type,
        focusKey: selection.focus.key,
        focusOffset: selection.focus.offset,
        focusType: selection.focus.type,
      };
      const root = state._nodeMap.get('root');
      if (root === null || root === undefined || typeof root.getChildren !== 'function') return;

      // Visual lines as their text leaves, matching the DOM reader's rules:
      // a trailing line break that follows no text is the empty line's
      // placeholder, not an extra line.
      const lines = [];
      for (const block of root.getChildren()) {
        if (typeof block.getChildren !== 'function') continue;
        const children = block.getChildren();
        let parts = [];
        children.forEach((child, childIndex) => {
          const type = typeof child.getType === 'function' ? child.getType() : '';
          if (type === 'linebreak') {
            const isLast = childIndex === children.length - 1;
            if (isLast && parts.length === 0) return;
            lines.push(parts);
            parts = [];
            return;
          }
          if (type !== 'text') return;
          parts.push({ node: child, text: typeof child.getTextContent === 'function' ? child.getTextContent() : '' });
        });
        lines.push(parts);
      }

      for (const change of plan) {
        const line = lines[change.lineIndex];
        if (line === undefined) continue;
        let offset = 0;
        for (const part of line) {
          const partStart = offset;
          const partEnd = offset + part.text.length;
          offset = partEnd;
          const from = Math.max(change.start, partStart);
          const to = Math.min(change.end, partEnd);
          if (to <= from) continue;
          selection.anchor.set(part.node.getKey(), from - partStart, 'text');
          selection.focus.set(part.node.getKey(), to - partStart, 'text');
          selection.insertText(change.digits);
          break;
        }
      }

      selection.anchor.set(saved.anchorKey, saved.anchorOffset, saved.anchorType);
      selection.focus.set(saved.focusKey, saved.focusOffset, saved.focusType);
    }, { tag: HISTORY_MERGE_TAG });
    return true;
  } catch (error) {
    console.warn('[markdown-live] renumbering skipped', error);
    return false;
  }
}

/**
 * Build the renumbering controller: watches the composer, and once the draft
 * settles, repairs ordered groups.
 *
 * @returns {{start: () => void, dispose: () => void}} the lifecycle handle.
 */
function createRenumber() {
  let observer = null;
  let timer = 0;
  let disposed = false;
  let lastSelfEdit = 0;

  /**
   * Whether the composer currently owns a text caret (so its line can be left
   * alone) and what that line is.
   * @param {HTMLElement} root - the composer.
   * @returns {number} the caret line, or -1.
   */
  const caretLineOf = root => {
    const draft = readLines(root);
    const caret = locateCaret(root, draft);
    return caret === null ? -1 : caret.lineIndex;
  };

  /**
   * Run one repair pass if the draft needs it.
   * @returns {void}
   */
  const repair = () => {
    if (disposed) return;
    const root = document.querySelector(COMPOSER_INPUT);
    if (!(root instanceof HTMLElement)) return;
    const editor = root.__lexicalEditor;
    if (editor === null || editor === undefined) return;
    const evidence = document.activeElement === root || root.contains(document.activeElement);
    if (!evidence) return;
    const draft = readLines(root);
    const plan = renumberPlan(draft.lines, caretLineOf(root));
    if (plan.length === 0) return;
    if (applyRenumber(editor, plan)) lastSelfEdit = Date.now();
  };

  /**
   * Coalesce draft changes into one repair.
   * @returns {void}
   */
  const schedule = () => {
    if (disposed) return;
    if (Date.now() - lastSelfEdit < SELF_WINDOW_MS) return;
    if (timer !== 0) clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = 0;
      repair();
    }, SETTLE_MS);
  };

  /**
   * Repair as soon as the current frame paints, skipping the settle delay.
   * Used right after the plugin itself inserts a list marker, where waiting
   * would make the numbers below visibly lag.
   * @returns {void}
   */
  const repairNow = () => {
    if (disposed) return;
    if (timer !== 0) {
      clearTimeout(timer);
      timer = 0;
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => repair());
    else repair();
  };

  return {
    repairNow,
    start() {
      if (disposed) return;
      observer = new MutationObserver(records => {
        for (const record of records) {
          const target = record.target;
          const element = target.nodeType === 3 ? target.parentElement : target;
          if (element instanceof Element && element.closest(COMPOSER_INPUT) !== null) {
            schedule();
            return;
          }
        }
      });
      observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    },
    dispose() {
      disposed = true;
      if (timer !== 0) clearTimeout(timer);
      timer = 0;
      if (observer !== null) observer.disconnect();
      observer = null;
    },
  };
}

module.exports = { createRenumber, renumberPlan, applyRenumber, SETTLE_MS };
