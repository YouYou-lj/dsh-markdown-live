/**
 * DOM reading and Range projection: the only module that touches the page.
 *
 * It walks the composer's rendered text once per pass and turns the pure
 * offset spans from `grammar`/`inline` into Ranges. It writes nothing: no
 * nodes are created, moved, or restyled, and the editor's model is never
 * consulted — so an unrecognised DOM shape degrades to "no paint" rather than
 * to a broken composer.
 *
 * A line here is one *visual* line: the composer keeps the whole draft in one
 * paragraph and separates lines with `<br>` (Lexical's soft line break), so
 * block boundaries and `<br>`s are equally line boundaries. Every line records
 * its block and its index inside that block, which is what lets the renderer
 * treat the caret's own line differently from finished ones.
 */
const { BLOCK_TAGS, SKIP_SUBTREE } = require('./constants.cjs');

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/**
 * Whether an element ends the surrounding visual line.
 * @param {Element} element - candidate element.
 * @returns {boolean} true for block-level containers.
 */
function isBlock(element) {
  return BLOCK_TAGS.includes(element.tagName);
}

/**
 * Read one block's visual lines, keeping the boundary information.
 *
 * @param {Element} block - the block element.
 * @returns {{text: string, runs: {node: Text, start: number, end: number}[], block: Element, lineInBlock: number}[]}
 *   the block's lines.
 */
function blockLines(block) {
  /** @type {{text: string, runs: {node: Text, start: number, end: number}[], block: Element, lineInBlock: number}[]} */
  const lines = [];
  let current = { text: '', runs: [] };

  const flush = () => {
    lines.push({ text: current.text, runs: current.runs, block, lineInBlock: lines.length });
    current = { text: '', runs: [] };
  };

  /**
   * Add one text node's value, splitting embedded newlines into lines.
   *
   * A paste inserts its whole payload into a single text node, newlines
   * included; the browser still paints those as line breaks, so the reader has
   * to treat them that way too. Each run records where it starts inside its
   * node, because a run can now cover only part of one.
   *
   * @param {Text} textNode - the node.
   * @param {string} value - its text.
   * @returns {void}
   */
  const pushText = (textNode, value) => {
    const pieces = value.split('\n');
    let nodeStart = 0;
    pieces.forEach((piece, index) => {
      if (index > 0) {
        flush();
        nodeStart += 1;
      }
      if (piece.length > 0) {
        const start = current.text.length;
        current.runs.push({ node: textNode, start, end: start + piece.length, nodeStart });
        current.text += piece;
      }
      nodeStart += piece.length;
    });
  };

  const visit = node => {
    for (let child = node.firstChild; child !== null; child = child.nextSibling) {
      if (child.nodeType === TEXT_NODE) {
        const value = /** @type {Text} */ (child).nodeValue ?? '';
        if (value === '') continue;
        pushText(/** @type {Text} */ (child), value);
        continue;
      }
      if (child.nodeType !== ELEMENT_NODE) continue;
      const element = /** @type {Element} */ (child);
      if (element.matches(SKIP_SUBTREE)) continue;
      if (element.tagName === 'BR') {
        // A lone trailing <br> is the placeholder that gives an empty line its
        // height; it is not an extra line of its own.
        if (child.nextSibling === null && current.text === '') continue;
        flush();
        continue;
      }
      if (isBlock(element)) {
        flush();
        for (const line of blockLines(element)) {
          lines.push({ ...line, block, lineInBlock: lines.length });
        }
        flush();
        continue;
      }
      visit(element);
    }
  };

  visit(block);
  // The end of a block always closes its last line, so a block holding `a<br>`
  // is two lines (`a`, and the empty one the break opened).
  flush();
  return lines;
}

/**
 * Split the composer's rendered content into visual lines.
 *
 * @param {HTMLElement} root - the composer's contenteditable element.
 * @returns {{text: string, runs: {node: Text, start: number, end: number}[], block: Element, lineInBlock: number}[]}
 *   visual lines in reading order, including empty ones, so line indices match
 *   the caret's own coordinates.
 */
function collectLines(root) {
  const lines = [];
  for (const block of root.children) {
    if (block === null || block === undefined || block.nodeType !== ELEMENT_NODE) continue;
    for (const line of blockLines(/** @type {Element} */ (block))) lines.push(line);
  }
  return lines;
}

/**
 * Project one line offset span onto concrete Ranges.
 *
 * A span crosses as many text nodes as the editor happens to have split the
 * line into; each covered node yields one Range so painting never depends on
 * node boundaries.
 *
 * @param {{runs: {node: Text, start: number, end: number}[]}} line - the line.
 * @param {number} start - inclusive line offset.
 * @param {number} end - exclusive line offset.
 * @returns {Range[]} ranges clipped to the line.
 */
function rangesOf(line, start, end) {
  /** @type {Range[]} */
  const ranges = [];
  for (const run of line.runs) {
    const from = Math.max(start, run.start);
    const to = Math.min(end, run.end);
    if (to <= from) continue;
    const range = document.createRange();
    // A run may begin part way inside its text node (after an embedded
    // newline), so its own offset is added to the run-relative position.
    const nodeStart = run.nodeStart ?? 0;
    range.setStart(run.node, nodeStart + (from - run.start));
    range.setEnd(run.node, nodeStart + (to - run.start));
    ranges.push(range);
  }
  return ranges;
}

module.exports = { collectLines, rangesOf };
