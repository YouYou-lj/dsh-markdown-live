/**
 * Line-level Markdown grammar: what a visual line *is* (heading, fence,
 * list item, quote, rule, plain text) and which leading characters are its
 * syntax markers.
 *
 * Pure functions over strings only — no DOM, no editor knowledge — so the
 * whole classifier is unit-tested in tests/run-tests.mjs without a browser.
 *
 * The classifier is deliberately conservative: a line whose marker shape is
 * ambiguous stays plain text, because every wrong classification would paint
 * syntax colour onto content the user meant literally.
 */
const FENCE_RE = /^(\s{0,3})(`{3,}|~{3,})([^`]*)$/;
// Levels 1-5 only: six or more hashes is ordinary text, left at the
// composer's normal colour instead of being treated as a marker.
const HEADING_RE = /^(\s{0,3})(#{1,5})(?!#)([ \t\u00a0\u3000]*)([\s\S]*)$/;
/** A CJK character may start a heading without a space, as Chinese users type. */
const CJK_START = /^[\u3400-\u9fff\uf900-\ufaff\u3000-\u303f]/;
const HR_RE = /^(\s{0,3})([-*_])(?:[ \t\u00a0\u3000]*\2){2,}[ \t\u00a0\u3000]*$/;
const QUOTE_RE = /^(\s{0,3})((?:>[ \t\u00a0\u3000]?)+)/;
const LIST_RE = /^(\s{0,12})([-*+]|\d{1,9}[.)])([ \t\u00a0\u3000]+)/;

/** A fresh, closed fence state. */
function closedFence() {
  return { open: false, char: '`', length: 3 };
}

/**
 * A blank line carries no text and settles nothing except fence state.
 * @param {string} text - the visual line's text.
 * @returns {boolean} whether the line holds nothing but spaces/tabs.
 */
function isBlank(text) {
  return text.trim() === '';
}

/**
 * Classify one visual line and advance the fence state.
 *
 * @param {string} text - the line's text with no trailing newline.
 * @param {{open: boolean, char: string, length?: number}} state - fence state, advanced in place.
 * @returns {{
 *   kind: 'blank'|'text'|'heading'|'hr'|'list'|'quote'|'fence-open'|'fence-close'|'fence-body',
 *   contentStart: number,
 *   markers: {start: number, end: number}[],
 * }} the classification plus the syntax-marker ranges it exposes.
 */
function classify(text, state) {
  if (isBlank(text)) return { kind: 'blank', contentStart: 0, markers: [] };

  if (state.open) {
    const close = FENCE_RE.exec(text);
    // A closing fence repeats the opening character at least as many times as
    // the opening run and carries nothing else; a shorter run stays body,
    // matching how people actually nest fence-looking text.
    const opening = state.length ?? 3;
    if (close !== null && close[2][0] === state.char && close[3].trim() === '' && close[2].length >= opening) {
      state.open = false;
      return { kind: 'fence-close', contentStart: 0, markers: [{ start: 0, end: text.length }] };
    }
    return { kind: 'fence-body', contentStart: 0, markers: [] };
  }

  const fence = FENCE_RE.exec(text);
  if (fence !== null) {
    state.open = true;
    state.char = fence[2][0];
    state.length = fence[2].length;
    return { kind: 'fence-open', contentStart: 0, markers: [{ start: 0, end: text.length }] };
  }

  if (HR_RE.test(text)) {
    return { kind: 'hr', contentStart: 0, markers: [{ start: 0, end: text.length }] };
  }

  const heading = HEADING_RE.exec(text);
  if (heading !== null) {
    const spacing = heading[3];
    const content = heading[4];
    // CommonMark needs a space after the hashes; Chinese writing often omits
    // it before CJK text, so that form counts too — but "#hashtag" stays prose.
    const spaced = spacing.length > 0;
    const cjk = spacing.length === 0 && CJK_START.test(content);
    if (spaced || cjk || content === '') {
      const end = heading[1].length + heading[2].length + spacing.length;
      return { kind: 'heading', contentStart: end, markers: [{ start: 0, end }] };
    }
  }

  const quote = QUOTE_RE.exec(text);
  if (quote !== null) {
    const end = quote[1].length + quote[2].length;
    return { kind: 'quote', contentStart: end, markers: [{ start: 0, end }] };
  }

  const list = LIST_RE.exec(text);
  if (list !== null) {
    const end = list[1].length + list[2].length + list[3].length;
    return { kind: 'list', contentStart: end, markers: [{ start: 0, end }] };
  }

  return { kind: 'text', contentStart: 0, markers: [] };
}

/**
 * The heading level of a line, for block-level styling.
 *
 * @param {string} text - one line of the draft.
 * @returns {number} 1-6 for a heading, 0 for anything else.
 */
function headingLevelOf(text) {
  const match = HEADING_RE.exec(text);
  if (match === null) return 0;
  const spacing = match[3];
  const content = match[4];
  if (spacing.length > 0 || CJK_START.test(content) || content === '') return match[2].length;
  return 0;
}

/**
 * Walk every visual line of a draft, resetting fence state at the start.
 *
 * @param {string[]} lines - the draft's visual lines in reading order.
 * @returns {ReturnType<typeof classify>[]} one classification per line.
 */
function classifyAll(lines) {
  const state = closedFence();
  return lines.map(line => classify(line, state));
}

module.exports = { classify, classifyAll, closedFence, headingLevelOf, isBlank, FENCE_RE };
