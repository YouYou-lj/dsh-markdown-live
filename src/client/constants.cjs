/**
 * Frozen names shared by the renderer, the style sheet, and the tests.
 *
 * The plugin is a pure paint layer: it never creates or moves DOM inside the
 * composer, so every name here identifies either a host DOM hook (read-only)
 * or one CSS Custom Highlight registration.
 */
const COMPOSER_INPUT = '[data-composer-input]';
/** Ancestor card that owns the composer; used only to notice the composer appearing. */
const COMPOSER_CARD = '[data-composer-card]';
/**
 * Subtree the renderer must not read as draft text: reference/command/quote
 * chips render as Lexical decorators with `contenteditable="false"` and their
 * labels are not typed Markdown.
 */
const SKIP_SUBTREE = '[contenteditable="false"], [data-lexical-decorator="true"]';
/** Attribute identifying this plugin's single injected style element. */
const STYLE_ATTR = 'data-dsh-markdown-live';
/** Hard ceiling on created Ranges per pass; a guard against pathological drafts. */
const MAX_RANGES = 6000;

/**
 * CSS Custom Highlight registration names. Namespaced so the browser's own
 * `spelling-error` / `grammar-error` highlights and other plugins stay apart.
 */
const HIGHLIGHTS = Object.freeze({
  strong: 'dsh-md-strong',
  em: 'dsh-md-em',
  strike: 'dsh-md-strike',
  link: 'dsh-md-link',
  quote: 'dsh-md-quote',
  marker: 'dsh-md-marker',
});

/**
 * Highlight names in paint order (later entries paint over earlier ones for
 * the properties they share). Links come last so a link inside emphasis keeps
 * its own colour and underline.
 */
const HIGHLIGHT_NAMES = Object.freeze([
  HIGHLIGHTS.marker,
  HIGHLIGHTS.quote,
  HIGHLIGHTS.em,
  HIGHLIGHTS.strike,
  HIGHLIGHTS.strong,
  HIGHLIGHTS.link,
]);

/** Blocks whose boundaries end a visual line even when a <br> is absent. */
const BLOCK_TAGS = Object.freeze([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT',
  'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3',
  'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE',
  'SECTION', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
]);

module.exports = {
  COMPOSER_INPUT,
  COMPOSER_CARD,
  SKIP_SUBTREE,
  STYLE_ATTR,
  MAX_RANGES,
  HIGHLIGHTS,
  HIGHLIGHT_NAMES,
  BLOCK_TAGS,
};
