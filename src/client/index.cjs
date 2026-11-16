/**
 * Domesticated client entry.
 *
 * A paint-only enhancement for the resident composer: Markdown typed into the
 * message box is rendered in place (bold, italic, strikethrough, inline code,
 * headings, lists, quotes, links, code fences) while the composer itself —
 * size, auto-grow, `@` mentions, `/` commands, the draft text that gets sent —
 * stays exactly the host's own.
 *
 * Why paint rather than decorate: the host composer is a Lexical plain-text
 * contenteditable that renders Markdown literally. Taking it over (a second
 * editor) would change its appearance and re-implement the tool row;
 * inserting spans into it would fight Lexical's reconciler on every keystroke.
 * The CSS Custom Highlight API has neither problem.
 */
const { createContinuation } = require('./continuation.cjs');
const { createRenderer, highlightApiAvailable } = require('./render.cjs');
const { createRenumber } = require('./renumber.cjs');
const { registerSettingsPage, registerVersionChip } = require('./chip.cjs');

/** Version info compiled into the bundle by scripts/build.mjs. */
let runtime = { version: '0.0.0', repository: 'https://github.com/YouYou-lj/dsh-markdown-live' };
try {
  runtime = require('./version.cjs');
} catch {
  // Source runs (tests) have no generated version module.
}
const { injectStyle, removeStyle } = require('./style-sheet.cjs');

/** Plugin id; matches the cordis.patch.yml row. */
const name = 'markdown-live';

/** Live instance marker, so a repeated apply (HMR without disposal) stays a no-op. */
let active = false;

/**
 * Client plugin body.
 * @param {object} ctx - the Cordis client context.
 * @returns {void}
 */
function apply(ctx) {
  if (active) return;
  active = true;

  injectStyle();
  console.info(`[markdown-live] active; CSS Custom Highlight API: ${highlightApiAvailable()}`);
  const renderer = createRenderer();
  const renumber = createRenumber();
  let chip = null;
  let page = null;
  try {
    chip = registerVersionChip(ctx, runtime);
    page = registerSettingsPage(ctx, runtime);
  } catch (error) {
    // A missing slot service must never cost the rendering layer.
    console.warn('[markdown-live] version surfaces skipped', error);
  }
  // A marker the continuation inserts changes the numbering below it; repair
  // immediately instead of waiting for the settle timer.
  const continuation = createContinuation({ onDraftChanged: () => renumber.repairNow() });

  const dispose = () => {
    if (chip !== null) chip.dispose();
    if (page !== null) page.dispose();
    renumber.dispose();
    continuation.dispose();
    renderer.dispose();
    removeStyle();
    active = false;
  };

  if (ctx !== undefined && ctx !== null && typeof ctx.effect === 'function') {
    ctx.effect(() => dispose, 'dsh-markdown-live: composer markdown rendering');
  } else {
    // Defensive fallback for a context without effects (should not happen on a
    // profile-installed client bundle): never leak the style element.
    window.addEventListener('pagehide', dispose, { once: true });
  }

  try {
    renderer.start();
    continuation.start();
    renumber.start();
  } catch (error) {
    // A hostile DOM must not leave a half-installed plugin behind.
    console.warn('[markdown-live] could not start', error);
    dispose();
  }
}

module.exports = { name, apply };
