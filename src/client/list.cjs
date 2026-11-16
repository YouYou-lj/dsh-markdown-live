/**
 * Ordered- and bullet-list continuation, as pure text logic.
 *
 * Given the text of the current visual line *up to the caret*, decide what
 * marker the next line should start with. This module is deliberately pure and
 * DOM-free so the whole rule set is unit-tested; the browser module only feeds
 * it model text and performs the insertion.
 */
/** Leading list marker: indent, bullet or digits, optional delimiter, spacing. */
const MARKER_RE = /^([ \t]{0,12})([-*+]|\d{1,9})([.)]?)([ \t\u00a0\u3000]+)/;

/**
 * Compute the next line's list prefix.
 *
 * Ordered items increment and keep their delimiter and spacing (`1. ` → `2. `,
 * `9) ` → `10) `); bullets repeat their own character; indentation is
 * preserved so nested lists stay nested. A line without a leading list marker,
 * or a bare number with no delimiter (`1 `), yields no continuation — a wrong
 * guess would edit the draft where the user meant plain text.
 *
 * @param {string} lineBeforeCaret - the line's text from its start to the caret.
 * @returns {{indent: string, marker: string, kind: 'ordered'|'bullet'} | null}
 *   the prefix for the next line, or null when this line is not a list item.
 */
function continuationOf(lineBeforeCaret) {
  const match = MARKER_RE.exec(lineBeforeCaret);
  if (match === null) return null;
  const indent = match[1];
  const token = match[2];
  const delimiter = match[3];
  const spacing = match[4];
  if (/^\d/.test(token)) {
    // A bare number is prose ("1 apple"), not a list item.
    if (delimiter === '') return null;
    const next = Number.parseInt(token, 10) + 1;
    return { indent, marker: `${next}${delimiter}${spacing}`, kind: 'ordered' };
  }
  return { indent, marker: `${token}${spacing}`, kind: 'bullet' };
}

/**
 * The marker range of an *empty* list item, for the exit gesture.
 *
 * Obsidian's rule: pressing newline inside an item that holds nothing but its
 * marker removes the marker instead of starting another item. The indent is
 * kept, so an empty nested item stays where it is.
 *
 * @param {string} line - the whole visual line.
 * @returns {{indentEnd: number, markerEnd: number} | null} the range to clear,
 *   or null when the line is not an empty list item.
 */
function exitMarkerOf(line) {
  const match = MARKER_RE.exec(line);
  if (match === null) return null;
  if (line.slice(match[0].length).trim() !== '') return null;
  return { indentEnd: match[1].length, markerEnd: match[0].length };
}

/**
 * The gesture rule: newline inside an empty item exits it.
 *
 * @param {string} line - the whole visual line.
 * @param {number} column - the caret's column in that line.
 * @returns {{from: number, to: number} | null} the range to clear, or null when
 *   the press should behave normally.
 */
function exitPlanOf(line, column) {
  const exit = exitMarkerOf(line);
  if (exit === null) return null;
  // The caret must be at or after the marker glyph; at the very start of the
  // line the author is asking for a line above, not for an exit.
  if (column < exit.indentEnd + 1) return null;
  return { from: exit.indentEnd, to: exit.markerEnd };
}

/**
 * Whether the line has content after its list marker.
 * @param {string} line - the whole visual line.
 * @returns {boolean} true when only the marker (and spacing) is present.
 */
function isEmptyListItem(line) {
  const match = MARKER_RE.exec(line);
  if (match === null) return false;
  return line.slice(match[0].length).trim() === '';
}

module.exports = { continuationOf, exitMarkerOf, exitPlanOf, isEmptyListItem, MARKER_RE };
