/**
 * Deferred line-level styling.
 *
 * Two behaviours live here, both aimed at the way people actually type:
 *
 *   1. **Headings only take their size once the line is finished.** While the
 *      caret is on a line, that line stays plain (the markers are merely
 *      dimmed); after Shift+Enter — or after the caret moves elsewhere — it
 *      grows. This mirrors live-preview editors and keeps the line you are
 *      typing at a stable size, so the composer never jumps mid-sentence.
 *   2. **Size, not weight.** A heading is larger, never bold: the host's own
 *      text weight is left alone.
 *
 * Mechanically this is the only place the plugin writes to the composer's
 * nodes, and it writes a **class on the text element Lexical already owns**
 * (`<span data-lexical-text>`), never a wrapper, attribute on text, or child.
 * Lexical reuses those elements, so the mark survives reconciliation, and the
 * renderer re-applies it after every change anyway.
 *
 * The mark changes `font-size` only. The host fixes the line height at a
 * length (`24px + delta`), so a bigger glyph grows inside the existing line
 * box: the composer still grows by whole lines, and its height, width and
 * auto-grow are unchanged.
 */
const { COMPOSER_INPUT } = require('./constants.cjs');
const { headingLevelOf } = require('./grammar.cjs');

/** One class per heading level, applied to the text elements of finished lines. */
const HEADING_CLASSES = Object.freeze([
  'dsh-md-h1', 'dsh-md-h2', 'dsh-md-h3', 'dsh-md-h4', 'dsh-md-h5',
]);

/**
 * Which finished lines render as headings.
 *
 * @param {{text: string, block: Element, lineInBlock: number}[]} lines - visual lines.
 * @param {{block: Element, line: number} | null} caret - the line being edited.
 * @returns {{line: object, level: number}[]} lines to mark, with their level.
 */
function planLineMarks(lines, caret) {
  const marks = [];
  for (const line of lines) {
    if (caret !== null && caret !== undefined && line.block === caret.block && line.lineInBlock === caret.line) continue;
    if (line.text.includes('\n')) continue;
    const level = headingLevelOf(line.text);
    if (level > 0) marks.push({ line, level });
  }
  return marks;
}

/**
 * Apply the heading marks, clearing whatever the previous pass marked.
 *
 * @param {{text: string, runs: {node: Text}[], block: Element, lineInBlock: number}[]} lines - visual lines.
 * @param {{block: Element, line: number} | null} caret - the line being edited.
 * @param {Set<Element>} marked - element set owned by the renderer.
 * @returns {void}
 */
function applyLineMarks(lines, caret, marked) {
  for (const element of marked) {
    for (const className of HEADING_CLASSES) element.classList.remove(className);
  }
  marked.clear();
  for (const { line, level } of planLineMarks(lines, caret)) {
    const className = HEADING_CLASSES[level - 1];
    for (const run of line.runs) {
      const element = run.node.parentElement;
      // Only style the text element Lexical owns; styling the block itself
      // would reach every line in it.
      if (element === null || element === undefined || element === line.block) continue;
      if (typeof element.classList === 'undefined') continue;
      element.classList.add(className);
      marked.add(element);
    }
  }
}

/**
 * Remove every mark this plugin added, restoring the host's DOM exactly.
 * @param {Set<Element>} marked - element set owned by the renderer.
 * @returns {void}
 */
function stripLineMarks(marked) {
  for (const element of marked) {
    for (const className of HEADING_CLASSES) element.classList.remove(className);
  }
  marked.clear();
  if (typeof document === 'undefined') return;
  for (const element of document.querySelectorAll(`${COMPOSER_INPUT} [class*='dsh-md-h']`)) {
    for (const className of HEADING_CLASSES) element.classList.remove(className);
  }
}

module.exports = { applyLineMarks, planLineMarks, stripLineMarks, HEADING_CLASSES };
