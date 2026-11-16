/**
 * The render loop: read the composer, classify its lines, and publish the
 * resulting ranges as CSS Custom Highlight registrations.
 *
 * Contract with the host editor:
 *   - reads the rendered DOM and emits ranges only;
 *   - the single write is a class on a text element Lexical already owns, used
 *     for finished heading lines (never for the line being edited);
 *   - never listens on key events, so Enter, IME, `@` mentions, and `/`
 *     commands keep their native handling.
 *
 * Two kinds of treatment coexist here:
 *
 *   - **immediate** — syntax markers are dimmed as soon as they are typed, and
 *     inline spans (bold, italic, code, strike, links) are painted as you
 *     type. List markers must be immediate: the list continuation reads them.
 *   - **deferred** — block-level shapes wait until the line is finished. The
 *     caret's own line keeps the plain look (markers dimmed only); once the
 *     caret leaves it, a heading line grows. This avoids a line jumping in size
 *     mid-sentence and matches how live-preview editors behave.
 *
 * Because every inline effect is a paint-only highlight property and the
 * deferred mark changes only `font-size` inside the host's fixed line box, the
 * composer's box, its auto-grow height, and the statistics row below it cannot
 * move.
 */
const { COMPOSER_CARD, COMPOSER_INPUT, HIGHLIGHTS, HIGHLIGHT_NAMES, MAX_RANGES } = require('./constants.cjs');
const { collectLines, rangesOf } = require('./dom.cjs');
const { applyLineMarks, stripLineMarks } = require('./decorate.cjs');
const { classify } = require('./grammar.cjs');
const { parseInline } = require('./inline.cjs');
const { locateWithin } = require('./continuation.cjs');
const { ALL_CLASSES, applySyntax, splitSyntax } = require('./syntax.cjs');
const { normalizeNewlines } = require('./newlines.cjs');
const { probeContract } = require('./compat.cjs');

/**
 * Whether this browser exposes the CSS Custom Highlight API. Without it the
 * plugin stays installed but paints nothing, and the composer is untouched.
 *
 * @returns {boolean} true when highlights can be registered.
 */
function highlightApiAvailable() {
  return typeof CSS !== 'undefined'
    && CSS !== null
    && CSS.highlights !== undefined
    && typeof Highlight === 'function';
}

/**
 * Locate the caret's visual line inside one composer.
 *
 * @param {HTMLElement} root - the composer.
 * @returns {{block: Element, line: number} | null} the caret's line, or null.
 */
function caretLineOf(root) {
  // A DOM selection can stay inside the editable after the user clicks away;
  // only a focused composer is "being edited", otherwise a finished line would
  // keep its markers forever after the first visit.
  const active = document.activeElement;
  const focused = active === root
    || (active !== null && active !== undefined && active.nodeType === 1 && typeof root.contains === 'function' && root.contains(active));
  if (!focused) return null;
  const selection = typeof document.getSelection === 'function' ? document.getSelection() : null;
  if (selection === null || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (range.collapsed === false) return null;
  const container = range.startContainer;
  if (container === null || container === root || root.contains(container) === false) return null;
  let block = container.nodeType === 3 ? container.parentElement : container;
  while (block !== null && block !== undefined && block.parentElement !== root) block = block.parentElement;
  if (block === null || block === undefined) return null;
  const within = locateWithin(block, container, range.startOffset);
  return within === null ? null : { block, line: within.line, column: within.column };
}

/**
 * Build the renderer.
 * @returns {{
 *   start: () => void,
 *   schedule: () => void,
 *   paint: () => void,
 *   dispose: () => void,
 * }} the lifecycle handle used by the client entry.
 */
function createRenderer() {
  let frame = 0;
  let disposed = false;
  let signature = '';
  let observer = null;
  /** Text elements currently carrying a deferred heading class. */
  const marked = new Set();
  /** Text elements carrying a syntax class from the previous pass. */
  const touched = new Set();
  /** Split attempts already made, so a refused split cannot loop. */
  const splitAttempts = new Set();
  /** Composers whose pasted newlines were already converted once. */
  const normalized = new WeakSet();
  /** Stable identity per node, so a rebuilt DOM with identical text still repaints. */
  const identities = new WeakMap();
  let identitySeq = 0;

  /**
   * Read (or assign) the stable identity of one node.
   * @param {Node} node - the node to identify.
   * @returns {number} its identity.
   */
  const identityOf = node => {
    let id = identities.get(node);
    if (id === undefined) {
      identitySeq += 1;
      id = identitySeq;
      identities.set(node, id);
    }
    return id;
  };

  /**
   * Delete every highlight this plugin owns and forget the cached fingerprint,
   * so the next pass paints even when the text is unchanged.
   * @returns {void}
   */
  const clear = () => {
    signature = '';
    if (!highlightApiAvailable()) return;
    for (const name of HIGHLIGHT_NAMES) CSS.highlights.delete(name);
  };

  /**
   * Publish one pass's ranges, keeping registration order stable so nested
   * treatments (for example emphasis inside a link) stack predictably.
   * @param {Map<string, Range[]>} buckets - ranges per highlight name.
   * @returns {void}
   */
  const publish = buckets => {
    for (const name of HIGHLIGHT_NAMES) {
      const ranges = buckets.get(name);
      if (ranges === undefined || ranges.length === 0) {
        CSS.highlights.delete(name);
        continue;
      }
      CSS.highlights.set(name, new Highlight(...ranges));
    }
  };

  /**
   * One full pass over every mounted composer.
   * @returns {void}
   */
  const paint = () => {
    if (disposed || !highlightApiAvailable()) return;
    const roots = document.querySelectorAll(COMPOSER_INPUT);
    /** @type {{text: string, runs: {node: Text, start: number, end: number}[], block: Element, lineInBlock: number}[][]} */
    const scans = [];
    /** @type {({block: Element, line: number} | null)[]} */
    const carets = [];
    const fingerprint = [];

    for (const root of roots) {
      if (!(root instanceof HTMLElement) || !root.isConnected) continue;
      // A paste lands in one text node with newlines inside; convert them into
      // real line breaks once, then render the normalised tree.
      const hasEmbeddedNewlines = typeof root.textContent === 'string' && root.textContent.includes('\n');
      if (!hasEmbeddedNewlines) {
        // A later paste into the same composer must be normalised too, so the
        // guard only lives while embedded newlines are still present.
        normalized.delete(root);
      } else if (!normalized.has(root)) {
        normalized.add(root);
        const editor = root.__lexicalEditor;
        if (editor !== null && editor !== undefined && normalizeNewlines(editor)) continue;
      }
      const caret = caretLineOf(root);
      const lines = collectLines(root);
      // The deferred mark is applied every pass: the caret line loses it, the
      // line it left gains it.
      applyLineMarks(lines, caret, marked);

      // Finished lines render: markers collapse, bullets become dots, code
      // gets its face. The caret's line keeps the literal markdown.
      const requests = [];
      for (const request of applySyntax(lines, caret, touched)) {
        const line = lines[request.lineIndex];
        const first = line === undefined ? undefined : line.runs[0];
        const key = `${first === undefined ? 0 : identityOf(first.node)}:${request.boundaries.join(',')}`;
        if (splitAttempts.has(key)) continue;
        splitAttempts.add(key);
        requests.push(request);
      }
      if (requests.length > 0) {
        const editor = root.__lexicalEditor;
        if (editor !== null && editor !== undefined) splitSyntax(editor, requests);
      }

      for (const line of lines) {
        fingerprint.push(`${line.runs.length === 0 ? 0 : identityOf(line.runs[0].node)}:${line.text}`);
      }
      fingerprint.push(`caret:${caret === null ? '-' : `${identityOf(caret.block)}:${caret.line}:${caret.column}`}`);
      scans.push(lines);
      carets.push(caret);
    }

    // Cheap check before any tokenizing: the draft, its node identities, and
    // the caret are unchanged, so the published ranges are still exact.
    const next = fingerprint.join('\u0001');
    if (next === signature) return;

    /** @type {Map<string, Range[]>} */
    const buckets = new Map();
    let total = 0;

    /**
     * Project one line span into ranges and file it under its highlight.
     * @param {string} name - highlight name.
     * @param {{runs: {node: Text, start: number, end: number}[]}} line - source line.
     * @param {number} start - inclusive line offset.
     * @param {number} end - exclusive line offset.
     * @returns {void}
     */
    const add = (name, line, start, end) => {
      if (total >= MAX_RANGES) return;
      const ranges = rangesOf(line, start, end);
      if (ranges.length === 0) return;
      let bucket = buckets.get(name);
      if (bucket === undefined) {
        bucket = [];
        buckets.set(name, bucket);
      }
      for (const range of ranges) {
        bucket.push(range);
        total += 1;
        if (total >= MAX_RANGES) return;
      }
    };

    for (let index = 0; index < scans.length; index += 1) {
      const lines = scans[index];
      const caret = carets[index];
      const state = { open: false, char: '`', length: 3 };
      for (const line of lines) {
        const editing = caret !== null && line.block === caret.block && line.lineInBlock === caret.line;
        const info = classify(line.text, state);
        if (info.kind === 'blank') continue;
        // Block-level shapes are classes (syntax.cjs); only inline painting
        // happens here.
        if (info.kind === 'fence-open' || info.kind === 'fence-close' || info.kind === 'fence-body') continue;
        // A rule is not rendered yet (there is no line element to draw on), so
        // its dashes keep the composer's normal colour instead of being dimmed.
        if (info.kind === 'hr') continue;
        // A bullet's glyph is replaced by a dot once the line is finished, so
        // it must not be dimmed: a highlight colour would paint the dash back
        // on top of the dot.
        const bullet = info.kind === 'list' ? /^([ \t]{0,12})([-*+])([ \t\u00a0\u3000]+)/.exec(line.text) : null;
        for (const marker of info.markers) {
          if (bullet !== null) {
            add(HIGHLIGHTS.marker, line, bullet[1].length + bullet[2].length, Math.min(marker.end, line.text.length));
            continue;
          }
          add(HIGHLIGHTS.marker, line, marker.start, marker.end);
        }
        const contentStart = Math.min(info.contentStart, line.text.length);
        if (info.kind === 'quote' && !editing) add(HIGHLIGHTS.quote, line, contentStart, line.text.length);
        if (contentStart >= line.text.length) continue;
        for (const span of parseInline(line.text.slice(contentStart))) {
          const name = span.kind === 'marker' ? HIGHLIGHTS.marker : HIGHLIGHTS[span.kind];
          if (name === undefined) continue;
          add(name, line, contentStart + span.start, contentStart + span.end);
        }
      }
    }

    publish(buckets);
    // Committed only after a successful publish: a throw leaves the fingerprint
    // stale, so the next mutation retries instead of silently going quiet.
    signature = next;
  };

  /**
   * Coalesce changes into one paint per animation frame.
   * @returns {void}
   */
  const schedule = () => {
    if (disposed || frame !== 0) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      try {
        paint();
      } catch (error) {
        // Fail closed: a repaint must never escape into the host's own input
        // handling, and the next mutation schedules another attempt.
        clear();
        console.warn('[markdown-live] render skipped', error);
      }
    });
  };

  /**
   * Whether one mutation record can affect the composer's painted text.
   * Transcript streaming mutates the page continuously, so this filter keeps
   * the plugin from repainting on every token.
   * @param {MutationRecord} record - observed mutation.
   * @returns {boolean} true when a repaint is warranted.
   */
  const touchesComposer = record => {
    const target = record.target;
    const element = target.nodeType === 3 ? target.parentElement : target;
    if (element instanceof Element && element.closest(COMPOSER_INPUT) !== null) return true;
    // Mount/unmount covers the composer element itself; text changes inside a
    // composer are already caught by the containment check above. Deliberately
    // no subtree scan here: the transcript adds nodes continuously.
    const lists = [record.addedNodes, record.removedNodes];
    for (const list of lists) {
      for (const node of list) {
        if (node instanceof Element && (node.matches(COMPOSER_INPUT) || node.matches(COMPOSER_CARD))) return true;
      }
    }
    return false;
  };

  /**
   * Attach the observers this renderer owns.
   * @returns {void}
   */
  const start = () => {
    if (disposed) return;
    if (!highlightApiAvailable()) {
      console.error('[markdown-live] this build has no CSS Custom Highlight API; rendering is off');
      return;
    }
    observer = new MutationObserver(records => {
      for (const record of records) {
        if (touchesComposer(record)) {
          schedule();
          return;
        }
      }
    });
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    document.addEventListener('focusin', schedule, true);
    document.addEventListener('focusout', schedule, true);
    // The caret's line renders differently from finished lines, so moving the
    // caret is a rendering change even when no text changed.
    document.addEventListener('selectionchange', schedule);
    setTimeout(() => {
      if (disposed) return;
      const root = document.querySelector(COMPOSER_INPUT);
      if (root === null) {
        // A composer card without an input is a real contract break; a page
        // with no composer at all is simply an idle surface.
        if (document.querySelector(COMPOSER_CARD) !== null) {
          console.error('[markdown-live] composer card without [data-composer-input]; rendering is inert');
        }
        return;
      }
      // Name what a DSH update moved, so an upgrade leaves a diagnosable trace
      // instead of silence. Features degrade one by one; nothing is disabled.
      const probe = probeContract(root);
      if (!probe.ok) {
        console.error(`[markdown-live] host contract changed: ${probe.missing.join(', ')}; affected features degrade, the rest keeps working`);
      }
    }, 3000);
    schedule();
  };

  /**
   * Release every observer, frame, and highlight this renderer owns.
   * @returns {void}
   */
  const dispose = () => {
    disposed = true;
    if (frame !== 0) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    if (observer !== null) {
      observer.disconnect();
      observer = null;
    }
    document.removeEventListener('focusin', schedule, true);
    document.removeEventListener('focusout', schedule, true);
    document.removeEventListener('selectionchange', schedule);
    stripLineMarks(marked);
    for (const element of touched) {
      for (const className of ALL_CLASSES) element.classList.remove(className);
    }
    touched.clear();
    clear();
  };

  return { start, schedule, paint, dispose };
}

module.exports = { createRenderer, highlightApiAvailable, caretLineOf };
