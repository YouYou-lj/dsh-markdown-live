/**
 * Domesticated paint stylesheet, injected once.
 *
 * Every rule is a `::highlight()` rule, which is why the composer's geometry
 * is safe by construction: highlight pseudo-elements paint over existing text
 * and cannot add width, height, padding, margin, border, or a new box. Only
 * paint-only properties are used, because Chromium restricts `::highlight()`
 * to colour, background, text-decoration, text-shadow, and text-stroke —
 * `font-weight`, `font-style`, and `font-size` are ignored there (measured
 * against the running Chromium), so emphasis reads as a double underline
 * instead of a slant.
 *
 * Colour choices follow two rules learned from the host palette:
 *   - marker/syntax colour must stay clear of the *placeholder* colour, which
 *     the composer already uses for its hint line, so `**` cannot be mistaken
 *     for ghost text;
 *   - tinted backgrounds use a mid-grey alpha or `color-mix` against a label
 *     token, because the host's dedicated inline-code token resolves to
 *     near-white in the light theme and would vanish on the composer surface.
 */
const { STYLE_ATTR } = require('./constants.cjs');

const CSS_TEXT = `
/* Markdown rendered inside the composer — paint-only layer. */
::highlight(dsh-md-marker) {
  color: var(--dsw-alias-label-tertiary, rgb(110 116 124 / 92%));
}

::highlight(dsh-md-quote) {
  color: var(--dsw-alias-label-secondary, rgb(96 102 110));
}

::highlight(dsh-md-link) {
  color: var(--dsw-alias-link, rgb(47 124 224));
  text-decoration-line: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 0.18em;
}

/* A double underline: it cannot be confused with the solid link underline or
   with the browser's dotted spell-check / wavy grammar underlines. The
   thickness is explicit because Blink collapses a double style below ~3px
   into a single stroke, which would collide with the link underline. */
::highlight(dsh-md-em) {
  text-decoration-line: underline;
  text-decoration-style: double;
  text-decoration-thickness: 3px;
  text-underline-offset: 0.16em;
}

::highlight(dsh-md-strike) {
  text-decoration-line: line-through;
  text-decoration-thickness: 1px;
}

/* A finished heading line grows; it is never made bold. The class sits on the
   text element Lexical owns, and only font-size is set: the host fixes the
   line height at a length, so the larger glyph grows inside the existing line
   box and the composer's height, width and auto-grow stay untouched. */
/* A finished line's marker is removed from view (the characters stay in the
   draft). Clicking back into the line reveals it. */
[data-composer-input] .dsh-md-syntax-hidden {
  display: none;
}

/* A finished bullet shows a dot in place of its marker. The character stays in
   the draft (transparent), so the line keeps its indentation. */
[data-composer-input] .dsh-md-bullet {
  color: transparent;
  position: relative;
}

[data-composer-input] .dsh-md-bullet::before {
  content: '\\2022';
  position: absolute;
  left: 0;
  color: var(--dsw-alias-label-secondary, rgb(96 102 110));
}

/* Code uses the host's own code surface and the shiki token palette, so a
   fence in the composer matches the same block once it is sent. */
[data-composer-input] .dsh-md-code-line {
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
  background-color: var(--shiki-background, var(--dsw-alias-markdown-code-block, rgb(127 127 127 / 10%)));
  color: var(--shiki-foreground, inherit);
}

[data-composer-input] .dsh-md-code-fence {
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
  color: var(--dsw-alias-label-caption, rgb(136 142 150 / 92%));
}

[data-composer-input] .dsh-md-inline-code {
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
  background-color: var(--dsw-alias-markdown-inline-code, rgb(127 127 127 / 16%));
  border-radius: var(--dsw-radius-sm, 3px);
  padding: 0.05em 0.25em;
}

[data-composer-input] .dsh-md-tok-comment {
  color: var(--shiki-token-comment, rgb(134 142 150));
}

[data-composer-input] .dsh-md-tok-string {
  color: var(--shiki-token-string, rgb(47 158 68));
}

[data-composer-input] .dsh-md-tok-number {
  color: var(--shiki-token-constant, rgb(28 126 214));
}

[data-composer-input] .dsh-md-tok-keyword {
  color: var(--shiki-token-keyword, rgb(214 51 108));
}

[data-composer-input] .dsh-md-tok-function {
  color: var(--shiki-token-function, rgb(103 65 217));
}

[data-composer-input] .dsh-md-tok-value {
  color: var(--shiki-token-parameter, rgb(232 89 12));
}

[data-composer-input] .dsh-md-tok-punctuation {
  color: var(--shiki-token-punctuation, rgb(73 80 87));
}

[data-composer-input] .dsh-md-h1 {
  font-size: 1.34em;
}

[data-composer-input] .dsh-md-h2 {
  font-size: 1.25em;
}

[data-composer-input] .dsh-md-h3 {
  font-size: 1.17em;
}

[data-composer-input] .dsh-md-h4 {
  font-size: 1.11em;
}

[data-composer-input] .dsh-md-h5 {
  font-size: 1.07em;
}

::highlight(dsh-md-strong) {
  /* Chromium ignores -webkit-text-stroke inside ::highlight() (measured: zero
     painted pixels), while text-shadow is honoured — so weight is built from
     three zero-blur copies of the glyph. Paint-only: no metrics change. */
  text-shadow:
    -0.05em 0 0 currentColor,
    0.05em 0 0 currentColor,
    0 0.03em 0 currentColor;
}
`;

/**
 * Install the stylesheet once, reusing an existing one after an HMR reload.
 * @returns {HTMLStyleElement | null} the element, or null outside a document.
 */
function injectStyle() {
  if (typeof document === 'undefined' || document.head === null) return null;
  const existing = document.querySelector(`style[${STYLE_ATTR}]`);
  if (existing instanceof HTMLStyleElement) return existing;
  const element = document.createElement('style');
  element.setAttribute(STYLE_ATTR, '');
  element.textContent = CSS_TEXT;
  document.head.appendChild(element);
  return element;
}

/**
 * Remove every stylesheet this plugin installed.
 * @returns {void}
 */
function removeStyle() {
  if (typeof document === 'undefined') return;
  for (const element of document.querySelectorAll(`style[${STYLE_ATTR}]`)) element.remove();
}

module.exports = { injectStyle, removeStyle, CSS_TEXT };
