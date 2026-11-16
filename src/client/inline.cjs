/**
 * Inline Markdown tokenizer for one visual line.
 *
 * Produces flat, half-open [start, end) spans in the line's own text
 * coordinates. Kinds split into two roles:
 *
 * - content spans (code, link, strong, em, strike) get the visible treatment;
 * - `marker` spans are the syntax characters themselves (backticks, emphasis
 *   delimiters, brackets, list bullets, …), painted de-emphasised so the draft
 *   still reads as the literal Markdown that will be sent.
 *
 * Nothing is ever removed or reordered: offsets index the exact string the
 * user typed, so a range here maps straight onto the editor's text nodes
 * without touching the draft.
 *
 * Precedence follows CommonMark's practical order — code, then links, then
 * strong, then strikethrough, then emphasis — with these rules kept on
 * purpose:
 *
 * - a backslash escapes the next marker character, and an escaped backtick
 *   never opens a code span, but escapes *inside* a code span are ordinary
 *   text (a shell or regex fragment must not lose its chip);
 * - multi-character delimiters (`**`, `__`, `~~`, `***`) may close against a
 *   following word (`**bold**text` is bold), while single `*`/`_` may not
 *   (`2 * 3` and `snake_case` stay prose);
 * - a delimiter that belongs to a longer run of the same character is left to
 *   the longer token, so `***both***` is strong + emphasis instead of two
 *   overlapping half-spans.
 */

/** Characters a backslash may escape into literal text. */
const ESCAPABLE = /\\([\\`*_{}[\]()#+\-.!~>|])/g;

/** Backtick runs with their literal content: `code` or ``a`b``. */
const CODE_RE = /(`+)([\s\S]*?)\1/g;

/** Inline links: [label](target). Nested brackets and parentheses are not supported. */
const LINK_RE = /\[([^[\]\n]*)\]\(([^()\n]*)\)/g;

/** Characters that end a word for emphasis flanking purposes. */
const WORD = /[A-Za-z0-9]/;

/**
 * Whether a delimiter may open a run: a non-space character must follow it and
 * it must not continue a word.
 *
 * @param {string} before - character immediately before the delimiter ('' at line start).
 * @param {string} next - character immediately after the delimiter.
 * @returns {boolean} whether the run may open.
 */
function canOpen(before, next) {
  if (next === '' || /\s/.test(next)) return false;
  if (before !== '' && WORD.test(before)) return false;
  return true;
}

/**
 * Whether a delimiter may close a run: the run must not end on whitespace.
 * Single-character emphasis also refuses to close against a word character
 * (`*a*b` stays literal), while multi-character delimiters accept it.
 *
 * @param {string} prev - character immediately before the closing delimiter.
 * @param {string} next - character immediately after it.
 * @param {boolean} lenient - true for two- and three-character delimiters.
 * @returns {boolean} whether the run may close.
 */
function canClose(prev, next, lenient) {
  if (prev === '' || /\s/.test(prev)) return false;
  if (!lenient && next !== '' && WORD.test(next)) return false;
  return true;
}

/**
 * Tokenize one line of Markdown.
 *
 * @param {string} text - the line's text.
 * @returns {{start: number, end: number, kind: 'marker'|'code'|'link'|'strong'|'em'|'strike'}[]}
 *   spans in line coordinates, unsorted.
 */
function parseInline(text) {
  /** @type {{start: number, end: number, kind: string}[]} */
  const spans = [];
  const blocked = new Uint8Array(text.length);

  /**
   * Reserve a range so later constructs cannot reuse its characters.
   * @param {number} start - inclusive start.
   * @param {number} end - exclusive end.
   * @returns {void}
   */
  const reserve = (start, end) => {
    if (end > start) blocked.fill(1, start, Math.min(end, text.length));
  };

  /**
   * Whether one position is still free for a delimiter.
   * @param {number} index - character index.
   * @returns {boolean} true when unescaped and unclaimed.
   */
  const usable = index => index >= 0 && index < text.length && blocked[index] === 0;

  /**
   * Whether every character of a range is still free.
   * @param {number} start - inclusive start.
   * @param {number} end - exclusive end.
   * @returns {boolean} true when the whole range is free.
   */
  const isFree = (start, end) => {
    for (let i = start; i < end; i += 1) if (blocked[i] === 1) return false;
    return true;
  };

  /**
   * Record one span, dropping empty ranges.
   * @param {number} start - inclusive start.
   * @param {number} end - exclusive end.
   * @param {string} kind - span role.
   * @returns {void}
   */
  const push = (start, end, kind) => {
    if (end > start) spans.push({ start, end, kind });
  };

  // 1. Backslash escapes claim their character for literal text.
  ESCAPABLE.lastIndex = 0;
  for (let match = ESCAPABLE.exec(text); match !== null; match = ESCAPABLE.exec(text)) {
    reserve(match.index, match.index + match[0].length);
  }

  // 2. Code spans own their backticks and everything between them. Only the
  //    delimiters must be unescaped: `\(x\)` is still a code span.
  CODE_RE.lastIndex = 0;
  for (let match = CODE_RE.exec(text); match !== null; match = CODE_RE.exec(text)) {
    const start = match.index;
    const ticks = match[1].length;
    const contentStart = start + ticks;
    const contentEnd = contentStart + match[2].length;
    const end = contentEnd + ticks;
    if (!usable(start) || !usable(contentEnd)) continue;
    push(contentStart, contentEnd, 'code');
    push(start, contentStart, 'marker');
    push(contentEnd, end, 'marker');
    reserve(start, end);
  }

  // 3. Links: the label becomes a link; brackets, parentheses and target are markers.
  LINK_RE.lastIndex = 0;
  for (let match = LINK_RE.exec(text); match !== null; match = LINK_RE.exec(text)) {
    const start = match.index;
    const end = start + match[0].length;
    if (!isFree(start, end)) continue;
    const labelStart = start + 1;
    const labelEnd = labelStart + match[1].length;
    const targetStart = labelEnd + 2;
    const targetEnd = end - 1;
    push(labelStart, labelEnd, 'link');
    push(start, labelStart, 'marker');
    push(labelEnd, labelEnd + 1, 'marker');
    push(labelEnd + 1, labelEnd + 2, 'marker');
    push(targetStart, targetEnd, 'marker');
    push(targetEnd, end, 'marker');
    reserve(start, end);
  }

  /**
   * Find delimited runs for one token and reserve their delimiters so shorter
   * tokens cannot reuse them.
   *
   * @param {string} token - the delimiter, repeated for multi-character tokens.
   * @param {('strong'|'em'|'strike')[]} kinds - content roles for the same range.
   * @returns {void}
   */
  const scanDelimited = (token, kinds) => {
    const size = token.length;
    const lenient = size > 1;
    let index = 0;
    while (index < text.length) {
      if (!text.startsWith(token, index) || !usable(index)) {
        index += 1;
        continue;
      }
      // A delimiter inside a longer run of the same character belongs to that
      // longer run's token (`***` before `**` before `*`).
      if (index > 0 && text[index - 1] === token[0]) {
        index += 1;
        continue;
      }
      if (text[index + size] === token[0]) {
        index += 1;
        continue;
      }
      if (!canOpen(index === 0 ? '' : text[index - 1], text[index + size] ?? '')) {
        index += 1;
        continue;
      }
      let cursor = index + size;
      let close = -1;
      while (cursor < text.length) {
        if (text.startsWith(token, cursor) && usable(cursor) && canClose(text[cursor - 1] ?? '', text[cursor + size] ?? '', lenient)) {
          close = cursor;
          break;
        }
        cursor += 1;
      }
      if (close < 0) {
        index += 1;
        continue;
      }
      const contentStart = index + size;
      for (const kind of kinds) push(contentStart, close, kind);
      push(index, contentStart, 'marker');
      push(close, close + size, 'marker');
      reserve(index, contentStart);
      reserve(close, close + size);
      index = close + size;
    }
  };

  // Longest token first; each pass reserves its delimiters.
  scanDelimited('***', ['strong', 'em']);
  scanDelimited('___', ['strong', 'em']);
  scanDelimited('**', ['strong']);
  scanDelimited('__', ['strong']);
  scanDelimited('~~', ['strike']);
  scanDelimited('*', ['em']);
  scanDelimited('_', ['em']);

  return spans;
}

module.exports = { parseInline };
