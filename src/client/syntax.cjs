/**
 * Syntax collapsing and block styling for finished lines.
 *
 * A finished line shows the *rendered* form: its block marker is gone from
 * view, bullets become a dot, and code is monospaced. Clicking back into a line
 * restores the literal markdown while you edit it. Nothing is ever removed from
 * the draft — the characters still travel to the model and to the message.
 *
 * Two mechanisms make this possible without touching the editor's structure:
 *
 *   - a class can only hide a whole element, so the line is **split** at the
 *     boundaries it needs (marker / bullet / backticks) and each piece becomes
 *     a text element Lexical already owns; both halves are flagged unmergeable
 *     so Lexical's normalization keeps them apart;
 *   - the split never targets the line the caret is on, so no selection offset
 *     has to be recomputed.
 *
 * A plan is pure data (line index, split offsets, class ranges); applying it is
 * a handful of class toggles plus at most one model update.
 */
const { classify, closedFence } = require('./grammar.cjs');
const { tokenize } = require('./tokens.cjs');

/** @lexical/history merges an update carrying this tag into the previous undo entry. */
const HISTORY_MERGE_TAG = 'history-merge';

/** Ordered list marker: indent, digits, delimiter, spacing. */
const ORDERED_RE = /^([ \t]{0,12})(\d{1,9})([.)])([ \t\u00a0\u3000]+)/;
/** Unordered list marker, split so the bullet character can be isolated. */
const BULLET_RE = /^([ \t]{0,12})([-*+])([ \t\u00a0\u3000]+)/;
/** Inline code span: backticks plus content. */
const INLINE_CODE_RE = /(`+)([^`\n]+?)\1/g;

/**
 * Class assigned to each rendered piece.
 * @type {Readonly<Record<string, string>>}
 */
const CLASSES = Object.freeze({
  hidden: 'dsh-md-syntax-hidden',
  bullet: 'dsh-md-bullet',
  codeLine: 'dsh-md-code-line',
  codeFence: 'dsh-md-code-fence',
  inlineCode: 'dsh-md-inline-code',
  tokComment: 'dsh-md-tok-comment',
  tokString: 'dsh-md-tok-string',
  tokNumber: 'dsh-md-tok-number',
  tokKeyword: 'dsh-md-tok-keyword',
  tokFunction: 'dsh-md-tok-function',
  tokValue: 'dsh-md-tok-value',
  tokPunctuation: 'dsh-md-tok-punctuation',
});

/** Token kind to class. */
const TOKEN_CLASSES = Object.freeze({
  comment: CLASSES.tokComment,
  string: CLASSES.tokString,
  number: CLASSES.tokNumber,
  keyword: CLASSES.tokKeyword,
  function: CLASSES.tokFunction,
  value: CLASSES.tokValue,
  punctuation: CLASSES.tokPunctuation,
});

/** Lines longer than this are not tokenized: the split cost is not worth it. */
const TOKENIZE_LIMIT = 400;

/** Every class this module may add, so a pass can clear what it touched. */
const ALL_CLASSES = Object.freeze([
  CLASSES.hidden, CLASSES.bullet, CLASSES.codeLine, CLASSES.codeFence,
  CLASSES.inlineCode, CLASSES.tokComment, CLASSES.tokString, CLASSES.tokNumber,
  CLASSES.tokKeyword, CLASSES.tokFunction, CLASSES.tokValue, CLASSES.tokPunctuation,
]);

/**
 * Build the render plan for one draft.
 *
 * @param {{text: string, block: Element, lineInBlock: number}[]} lines - visual lines.
 * @param {{block: Element, line: number} | null} caret - the line being edited.
 * @returns {{
 *   lineIndex: number,
 *   splits: number[],
 *   ranges: {start: number, end: number, className: string}[],
 * }[]} one item per line that needs any treatment.
 */
function syntaxPlan(lines, caret) {
  const plan = [];
  const state = closedFence();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const info = classify(line.text, state);
    const editing = caret !== null && caret !== undefined && line.block === caret.block && line.lineInBlock === caret.line;
    /** Caret column on the line being edited, or -1 when it is elsewhere. */
    const caretColumn = editing && typeof caret.column === 'number' ? caret.column : -1;
    const item = { lineIndex: index, splits: [], ranges: [] };

    if (info.kind === 'fence-open' || info.kind === 'fence-close' || info.kind === 'fence-body') {
      // Code is styled while you type in it; only the fence markers wait for
      // the block to be finished.
      if (info.kind === 'fence-body') {
        if (line.text.length === 0) continue;
        if (editing || line.text.length > TOKENIZE_LIMIT) {
          // While typing, the line keeps the plain code face: splitting under
          // the caret would churn the model on every keystroke.
          item.ranges.push({ start: 0, end: line.text.length, className: CLASSES.codeLine });
          plan.push(item);
          continue;
        }
        const tokens = tokenize(line.text);
        if (tokens.length === 0) {
          item.ranges.push({ start: 0, end: line.text.length, className: CLASSES.codeLine });
          plan.push(item);
          continue;
        }
        for (const token of tokens) {
          item.splits.push(token.start, token.end);
          item.ranges.push({ start: token.start, end: token.end, className: CLASSES.codeLine });
          const tokenClass = TOKEN_CLASSES[token.kind];
          if (tokenClass !== undefined) item.ranges.push({ start: token.start, end: token.end, className: tokenClass });
        }
        plan.push(item);
        continue;
      }
      if (editing) continue;
      item.ranges.push({ start: 0, end: line.text.length, className: CLASSES.codeFence });
      if (line.text.length > 0) plan.push(item);
      continue;
    }

    // Ordered markers stay exactly as typed: no column, no indent, so the text
    // simply continues after "1. " and never jumps when the first character of
    // an item arrives.
    let bulletPlanned = false;
    if (info.kind === 'list') {
      const bullet = BULLET_RE.exec(line.text);
      if (bullet !== null) {
        const indentEnd = bullet[1].length;
        const bulletEnd = indentEnd + bullet[2].length;
        // The dot replaces the glyph as soon as the caret is past it. Editing
        // *inside* the glyph keeps the raw character: a transparent character
        // under the caret would swallow whatever is typed next.
        const reachable = !editing || caretColumn >= bulletEnd;
        if (reachable && bulletEnd < line.text.length) {
          if (indentEnd > 0) item.splits.push(indentEnd);
          item.splits.push(bulletEnd);
          item.ranges.push({ start: indentEnd, end: bulletEnd, className: CLASSES.bullet });
          bulletPlanned = true;
        }
      }
    }

    if (editing) {
      // Bullets are the one block shape rendered while typing.
      if (bulletPlanned) plan.push(item);
      continue;
    }

    if (info.kind === 'heading' || info.kind === 'quote') {
      const end = Math.min(info.contentStart, line.text.length);
      // A marker-only line stays visible, otherwise the line would look empty.
      if (end > 0 && end < line.text.length) {
        item.splits.push(end);
        item.ranges.push({ start: 0, end, className: CLASSES.hidden });
      }
    }

    // Inline code: hide the backticks and put the content in a code face.
    INLINE_CODE_RE.lastIndex = 0;
    for (let match = INLINE_CODE_RE.exec(line.text); match !== null; match = INLINE_CODE_RE.exec(line.text)) {
      const start = match.index;
      const ticks = match[1].length;
      const contentStart = start + ticks;
      const contentEnd = contentStart + match[2].length;
      const end = contentEnd + ticks;
      item.splits.push(contentStart, contentEnd);
      item.ranges.push({ start, end: contentStart, className: CLASSES.hidden });
      item.ranges.push({ start: contentEnd, end, className: CLASSES.hidden });
      item.ranges.push({ start: contentStart, end: contentEnd, className: CLASSES.inlineCode });
    }

    if (item.splits.length > 0 || item.ranges.length > 0) plan.push(item);
  }
  return plan;
}

/**
 * Whether the line's text nodes already break exactly where the plan needs.
 *
 * @param {{start: number, end: number}[]} runs - run offsets of the line.
 * @param {number[]} boundaries - required split positions.
 * @param {{start: number, end: number, className: string}[]} ranges - class ranges.
 * @returns {boolean} true when every boundary and range edge is a run edge.
 */
function isIsolated(runs, boundaries, ranges) {
  const edges = new Set();
  for (const run of runs) {
    edges.add(run.start);
    edges.add(run.end);
  }
  for (const boundary of boundaries) {
    if (!edges.has(boundary)) return false;
  }
  for (const range of ranges) {
    if (!edges.has(range.start) || !edges.has(range.end)) return false;
  }
  return true;
}

/**
 * Apply the plan to the rendered DOM, reporting the lines that still need a
 * model-side split.
 *
 * @param {{text: string, runs: {node: Text, start: number, end: number}[], block: Element, lineInBlock: number}[]} lines - visual lines.
 * @param {{block: Element, line: number} | null} caret - the line being edited.
 * @param {Set<Element>} touched - elements this module marked last pass.
 * @returns {{lineIndex: number, boundaries: number[]}[]} lines to split.
 */
function applySyntax(lines, caret, touched) {
  for (const element of touched) {
    if (typeof element.classList === 'undefined') continue;
    for (const className of ALL_CLASSES) element.classList.remove(className);
  }
  touched.clear();

  const requests = [];
  for (const item of syntaxPlan(lines, caret)) {
    const line = lines[item.lineIndex];
    if (line === undefined || line.runs.length === 0) continue;
    if (!isIsolated(line.runs, item.splits, item.ranges)) {
      const boundaries = [...new Set([
        ...item.splits,
        ...item.ranges.flatMap(range => [range.start, range.end]),
      ])].filter(boundary => boundary > 0 && boundary < line.text.length);
      if (boundaries.length > 0) requests.push({ lineIndex: item.lineIndex, boundaries });
      continue;
    }
    for (const range of item.ranges) {
      for (const run of line.runs) {
        if (run.start < range.start || run.end > range.end) continue;
        const element = run.node.parentElement;
        if (element === null || element === undefined || element === line.block) continue;
        if (typeof element.classList === 'undefined') continue;
        element.classList.add(range.className);
        touched.add(element);
      }
    }
  }
  return requests;
}

/**
 * Split each planned line at the requested boundaries.
 *
 * @param {object} editor - the live Lexical editor.
 * @param {{lineIndex: number, boundaries: number[]}[]} plan - lines to split.
 * @returns {boolean} whether an update was attempted.
 */
function splitSyntax(editor, plan) {
  if (editor === null || editor === undefined || typeof editor.update !== 'function') return false;
  if (!Array.isArray(plan) || plan.length === 0) return false;
  try {
    editor.update(() => {
      const state = editor._pendingEditorState ?? editor.getEditorState();
      if (state === null || state === undefined) return;
      const root = state._nodeMap.get('root');
      if (root === null || root === undefined || typeof root.getChildren !== 'function') return;

      /**
       * Read the draft's visual lines as their text nodes, mirroring the DOM
       * reader's model (blocks are lines, a line break starts a new one, and a
       * trailing break with no text is an empty line's placeholder).
       * @returns {object[][]} text nodes per visual line.
       */
      const readModelLines = () => {
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
      };

      for (const change of plan) {
        for (const boundary of [...change.boundaries].sort((left, right) => left - right)) {
          // Re-read after every split: the previous one replaced the node this
          // boundary was computed against.
          const nodes = readModelLines()[change.lineIndex] ?? [];
          let offset = 0;
          let target = null;
          for (const node of nodes) {
            const text = typeof node.getTextContent === 'function' ? node.getTextContent() : '';
            if (boundary > offset && boundary < offset + text.length) {
              target = { node, local: boundary - offset };
              break;
            }
            offset += text.length;
          }
          if (target === null) continue;
          if (typeof target.node.splitText !== 'function') continue;
          const parts = target.node.splitText(target.local);
          for (const part of parts) {
            if (part === null || part === undefined) continue;
            if (typeof part.isUnmergeable !== 'function' || typeof part.toggleUnmergeable !== 'function') continue;
            if (!part.isUnmergeable()) part.toggleUnmergeable();
          }
        }
      }
    }, { tag: HISTORY_MERGE_TAG });
    return true;
  } catch (error) {
    console.warn('[markdown-live] syntax collapsing skipped', error);
    return false;
  }
}

module.exports = { applySyntax, syntaxPlan, splitSyntax, ALL_CLASSES, CLASSES, HISTORY_MERGE_TAG };
