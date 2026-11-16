/**
 * A small, language-agnostic tokenizer for finished code lines.
 *
 * The composer cannot run a real grammar: it is a plain-text editor whose lines
 * are single text nodes. What it *can* do is classify runs of characters —
 * comments, strings, numbers, keywords, calls, punctuation — split the line at
 * those boundaries and colour the pieces with the host's own
 * `--shiki-token-*` palette, which is the same one the rendered messages use.
 *
 * The result is deliberately conservative: anything unrecognised stays plain,
 * and the tokenizer never reorders or removes a character.
 */

/** Keywords common enough to colour across the languages people paste in. */
const KEYWORDS = new Set([
  'and', 'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
  'def', 'default', 'defer', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally',
  'fn', 'for', 'from', 'func', 'function', 'go', 'if', 'implements', 'import', 'in',
  'instanceof', 'interface', 'is', 'lambda', 'let', 'match', 'mod', 'mut', 'new', 'nil',
  'none', 'not', 'null', 'of', 'or', 'package', 'pass', 'print', 'private', 'protected',
  'pub', 'public', 'raise', 'return', 'self', 'static', 'struct', 'super', 'switch',
  'this', 'throw', 'trait', 'true', 'try', 'type', 'typeof', 'undefined', 'use', 'using',
  'var', 'void', 'while', 'with', 'yield',
]);

/** Quote characters that open a string literal. */
const QUOTES = new Set(['"', "'", '`']);

/**
 * Whether a character can start an identifier.
 * @param {string} char - one character.
 * @returns {boolean} true for letters, underscore and dollar.
 */
const isIdentStart = char => /[A-Za-z_$]/.test(char);

/**
 * Whether a character can continue an identifier.
 * @param {string} char - one character.
 * @returns {boolean} true for identifier characters and digits.
 */
const isIdentPart = char => /[A-Za-z0-9_$]/.test(char);

/**
 * Tokenize one line of code.
 *
 * @param {string} code - the line's text.
 * @returns {{start: number, end: number, kind: 'comment'|'string'|'number'|'keyword'|'function'|'value'|'punctuation'}[]}
 *   non-overlapping spans; whitespace is not covered.
 */
function tokenize(code) {
  const spans = [];
  let index = 0;
  /**
   * Append a span, merging it into an immediately adjacent one of the same kind.
   * @param {number} start - inclusive start.
   * @param {number} end - exclusive end.
   * @param {string} kind - token kind.
   * @returns {void}
   */
  const push = (start, end, kind) => {
    if (end <= start) return;
    const last = spans[spans.length - 1];
    if (last !== undefined && last.end === start && last.kind === kind) {
      last.end = end;
      return;
    }
    spans.push({ start, end, kind });
  };

  while (index < code.length) {
    const char = code[index];
    const next = code[index + 1] ?? '';

    // Comments: //, # (script languages), /* … */ to the line's end.
    if ((char === '/' && next === '/')) {
      push(index, code.length, 'comment');
      break;
    }
    if (char === '#' && (index === 0 || /\s/.test(code[index - 1]))) {
      push(index, code.length, 'comment');
      break;
    }
    if (char === '/' && next === '*') {
      const close = code.indexOf('*/', index + 2);
      push(index, close < 0 ? code.length : close + 2, 'comment');
      index = close < 0 ? code.length : close + 2;
      continue;
    }

    // Strings, including escapes and unterminated tails.
    if (QUOTES.has(char)) {
      let cursor = index + 1;
      while (cursor < code.length) {
        if (code[cursor] === '\\') {
          cursor += 2;
          continue;
        }
        if (code[cursor] === char) {
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      push(index, Math.min(cursor, code.length), 'string');
      index = Math.min(cursor, code.length);
      continue;
    }

    // Numbers, including hex and decimals.
    if (/[0-9]/.test(char)) {
      let cursor = index;
      while (cursor < code.length && /[0-9a-fA-FxX._]/.test(code[cursor])) cursor += 1;
      push(index, cursor, 'number');
      index = cursor;
      continue;
    }

    // Identifiers: keywords, calls, constants, or plain names.
    if (isIdentStart(char)) {
      let cursor = index + 1;
      while (cursor < code.length && isIdentPart(code[cursor])) cursor += 1;
      const word = code.slice(index, cursor);
      const lowered = word.toLowerCase();
      if (KEYWORDS.has(lowered)) push(index, cursor, 'keyword');
      else if (code.slice(cursor).trimStart().startsWith('(')) push(index, cursor, 'function');
      else if (word === word.toUpperCase() && /[A-Z]/.test(word)) push(index, cursor, 'value');
      index = cursor;
      continue;
    }

    // Anything else that is not whitespace is punctuation/operators.
    if (!/\s/.test(char)) {
      let cursor = index;
      while (cursor < code.length && !/[A-Za-z0-9_$\s]/.test(code[cursor]) && !QUOTES.has(code[cursor])) cursor += 1;
      if (cursor === index) cursor = index + 1;
      push(index, cursor, 'punctuation');
      index = cursor;
      continue;
    }

    index += 1;
  }

  return spans;
}

module.exports = { tokenize, KEYWORDS };
