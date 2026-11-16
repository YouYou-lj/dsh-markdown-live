/*!
 * dsh-markdown-live — generated browser bundle. Do not edit.
 * Source: src/client/*.cjs. Rebuild: node scripts/build.mjs
 */
window.__ModuleLoader__.load({
  id: 'dsh-markdown-live',
  factory(require) {
    var __defs = Object.create(null);
    var __cache = Object.create(null);

    function __define(id, factory) {
      __defs[id] = factory;
    }

    function __load(id) {
      var cached = __cache[id];
      if (cached !== undefined) return cached.exports;
      var factory = __defs[id];
      // Anything the bundle does not own resolves through the host module
      // table (React, when a future view needs it), never through a second copy.
      if (factory === undefined) return require(id);
      var module = { exports: {} };
      __cache[id] = module;
      factory(module, module.exports, __load);
      return module.exports;
    }

    __define('./constants.cjs', function (module, exports, require) {
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
      
    });

    __define('./compat.cjs', function (module, exports, require) {
      /**
       * Runtime contract probe.
       *
       * The plugin talks to the host through a small number of published shapes: the
       * composer element, the editor instance hanging off it, its node registry, and
       * the browser's CSS Custom Highlight API. A DSH update may move any of them.
       *
       * This probe is checked once per page so an update that breaks a shape leaves a
       * named diagnostic instead of silence. It never disables the plugin: every
       * feature already degrades to a no-op on its own, and a partial contract keeps
       * the rest working.
       */
      
      /**
       * Whether the CSS Custom Highlight API is available.
       * @returns {boolean} true when highlights can be registered.
       */
      const hasHighlights = () =>
        typeof CSS !== 'undefined'
        && CSS !== null
        && CSS.highlights !== undefined
        && typeof Highlight === 'function';
      
      /**
       * Read the editor instance the composer exposes.
       * @param {HTMLElement} root - the composer's contenteditable.
       * @returns {object | null} the editor, or null.
       */
      const editorOf = root => {
        const editor = root === null || root === undefined ? null : root.__lexicalEditor;
        return editor !== null && editor !== undefined ? editor : null;
      };
      
      /**
       * Probe the host contract the plugin relies on.
       *
       * @param {HTMLElement | null} root - a mounted composer, or null.
       * @returns {{ok: boolean, missing: string[]}} the probe result.
       */
      function probeContract(root) {
        const missing = [];
        if (!hasHighlights()) missing.push('CSS Custom Highlight API');
        if (root === null || root === undefined || root.nodeType !== 1) {
          missing.push('[data-composer-input]');
          return { ok: false, missing };
        }
        let textElements = 0;
        for (const child of root.children) textElements += child.querySelectorAll('[data-lexical-text]').length;
        if (textElements === 0) missing.push('data-lexical-text elements');
      
        const editor = editorOf(root);
        if (editor === null) {
          missing.push('editor.__lexicalEditor');
          return { ok: missing.length === 0, missing };
        }
        if (typeof editor.update !== 'function' || typeof editor.getEditorState !== 'function') {
          missing.push('editor.update/getEditorState');
        }
        const registry = editor._nodes;
        const get = registry !== null && registry !== undefined && typeof registry.get === 'function' ? registry.get.bind(registry) : null;
        if (get === null) {
          missing.push('editor._nodes');
        } else {
          const lineBreak = get('linebreak')?.klass;
          const text = get('text')?.klass;
          if (typeof lineBreak !== 'function') missing.push('linebreak node class');
          if (text === undefined || text === null || typeof text.prototype.splitText !== 'function') missing.push('text.splitText');
          if (text === undefined || text === null || typeof text.prototype.toggleUnmergeable !== 'function') missing.push('text.toggleUnmergeable');
        }
        return { ok: missing.length === 0, missing };
      }
      
      module.exports = { probeContract, hasHighlights };
      
    });

    __define('./grammar.cjs', function (module, exports, require) {
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
      
    });

    __define('./list.cjs', function (module, exports, require) {
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
      
    });

    __define('./inline.cjs', function (module, exports, require) {
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
      
    });

    __define('./dom.cjs', function (module, exports, require) {
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
      
    });

    __define('./decorate.cjs', function (module, exports, require) {
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
      
    });

    __define('./tokens.cjs', function (module, exports, require) {
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
      
    });

    __define('./syntax.cjs', function (module, exports, require) {
      /**
       * Syntax collapsing and block styling for finished lines.
       *
       * A finished line shows the *rendered* form: its block marker is gone from
       * view, bullets become a dot, and code is monospaced. Clicking back into a line
       * restores the literal markdown while you edit it. Nothing is ever removed from
       * the draft — the characters still travel to the model and to the message.
       *
       * Two mechanisms make this possible without touching the editor's structure:
       *
       *   - a class can only hide a whole element, so the line is **split** at the
       *     boundaries it needs (marker / bullet / backticks) and each piece becomes
       *     a text element Lexical already owns; both halves are flagged unmergeable
       *     so Lexical's normalization keeps them apart;
       *   - the split never targets the line the caret is on, so no selection offset
       *     has to be recomputed.
       *
       * A plan is pure data (line index, split offsets, class ranges); applying it is
       * a handful of class toggles plus at most one model update.
       */
      const { classify, closedFence } = require('./grammar.cjs');
      const { tokenize } = require('./tokens.cjs');
      
      /** @lexical/history merges an update carrying this tag into the previous undo entry. */
      const HISTORY_MERGE_TAG = 'history-merge';
      
      /** Ordered list marker: indent, digits, delimiter, spacing. */
      const ORDERED_RE = /^([ \t]{0,12})(\d{1,9})([.)])([ \t\u00a0\u3000]+)/;
      /** Unordered list marker, split so the bullet character can be isolated. */
      const BULLET_RE = /^([ \t]{0,12})([-*+])([ \t\u00a0\u3000]+)/;
      /** Inline code span: backticks plus content. */
      const INLINE_CODE_RE = /(`+)([^`\n]+?)\1/g;
      
      /**
       * Class assigned to each rendered piece.
       * @type {Readonly<Record<string, string>>}
       */
      const CLASSES = Object.freeze({
        hidden: 'dsh-md-syntax-hidden',
        bullet: 'dsh-md-bullet',
        codeLine: 'dsh-md-code-line',
        codeFence: 'dsh-md-code-fence',
        inlineCode: 'dsh-md-inline-code',
        tokComment: 'dsh-md-tok-comment',
        tokString: 'dsh-md-tok-string',
        tokNumber: 'dsh-md-tok-number',
        tokKeyword: 'dsh-md-tok-keyword',
        tokFunction: 'dsh-md-tok-function',
        tokValue: 'dsh-md-tok-value',
        tokPunctuation: 'dsh-md-tok-punctuation',
      });
      
      /** Token kind to class. */
      const TOKEN_CLASSES = Object.freeze({
        comment: CLASSES.tokComment,
        string: CLASSES.tokString,
        number: CLASSES.tokNumber,
        keyword: CLASSES.tokKeyword,
        function: CLASSES.tokFunction,
        value: CLASSES.tokValue,
        punctuation: CLASSES.tokPunctuation,
      });
      
      /** Lines longer than this are not tokenized: the split cost is not worth it. */
      const TOKENIZE_LIMIT = 400;
      
      /** Every class this module may add, so a pass can clear what it touched. */
      const ALL_CLASSES = Object.freeze([
        CLASSES.hidden, CLASSES.bullet, CLASSES.codeLine, CLASSES.codeFence,
        CLASSES.inlineCode, CLASSES.tokComment, CLASSES.tokString, CLASSES.tokNumber,
        CLASSES.tokKeyword, CLASSES.tokFunction, CLASSES.tokValue, CLASSES.tokPunctuation,
      ]);
      
      /**
       * Build the render plan for one draft.
       *
       * @param {{text: string, block: Element, lineInBlock: number}[]} lines - visual lines.
       * @param {{block: Element, line: number} | null} caret - the line being edited.
       * @returns {{
       *   lineIndex: number,
       *   splits: number[],
       *   ranges: {start: number, end: number, className: string}[],
       * }[]} one item per line that needs any treatment.
       */
      function syntaxPlan(lines, caret) {
        const plan = [];
        const state = closedFence();
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index];
          const info = classify(line.text, state);
          const editing = caret !== null && caret !== undefined && line.block === caret.block && line.lineInBlock === caret.line;
          /** Caret column on the line being edited, or -1 when it is elsewhere. */
          const caretColumn = editing && typeof caret.column === 'number' ? caret.column : -1;
          const item = { lineIndex: index, splits: [], ranges: [] };
      
          if (info.kind === 'fence-open' || info.kind === 'fence-close' || info.kind === 'fence-body') {
            // Code is styled while you type in it; only the fence markers wait for
            // the block to be finished.
            if (info.kind === 'fence-body') {
              if (line.text.length === 0) continue;
              if (editing || line.text.length > TOKENIZE_LIMIT) {
                // While typing, the line keeps the plain code face: splitting under
                // the caret would churn the model on every keystroke.
                item.ranges.push({ start: 0, end: line.text.length, className: CLASSES.codeLine });
                plan.push(item);
                continue;
              }
              const tokens = tokenize(line.text);
              if (tokens.length === 0) {
                item.ranges.push({ start: 0, end: line.text.length, className: CLASSES.codeLine });
                plan.push(item);
                continue;
              }
              for (const token of tokens) {
                item.splits.push(token.start, token.end);
                item.ranges.push({ start: token.start, end: token.end, className: CLASSES.codeLine });
                const tokenClass = TOKEN_CLASSES[token.kind];
                if (tokenClass !== undefined) item.ranges.push({ start: token.start, end: token.end, className: tokenClass });
              }
              plan.push(item);
              continue;
            }
            if (editing) continue;
            item.ranges.push({ start: 0, end: line.text.length, className: CLASSES.codeFence });
            if (line.text.length > 0) plan.push(item);
            continue;
          }
      
          // Ordered markers stay exactly as typed: no column, no indent, so the text
          // simply continues after "1. " and never jumps when the first character of
          // an item arrives.
          let bulletPlanned = false;
          if (info.kind === 'list') {
            const bullet = BULLET_RE.exec(line.text);
            if (bullet !== null) {
              const indentEnd = bullet[1].length;
              const bulletEnd = indentEnd + bullet[2].length;
              // The dot replaces the glyph as soon as the caret is past it. Editing
              // *inside* the glyph keeps the raw character: a transparent character
              // under the caret would swallow whatever is typed next.
              const reachable = !editing || caretColumn >= bulletEnd;
              if (reachable && bulletEnd < line.text.length) {
                if (indentEnd > 0) item.splits.push(indentEnd);
                item.splits.push(bulletEnd);
                item.ranges.push({ start: indentEnd, end: bulletEnd, className: CLASSES.bullet });
                bulletPlanned = true;
              }
            }
          }
      
          if (editing) {
            // Bullets are the one block shape rendered while typing.
            if (bulletPlanned) plan.push(item);
            continue;
          }
      
          if (info.kind === 'heading' || info.kind === 'quote') {
            const end = Math.min(info.contentStart, line.text.length);
            // A marker-only line stays visible, otherwise the line would look empty.
            if (end > 0 && end < line.text.length) {
              item.splits.push(end);
              item.ranges.push({ start: 0, end, className: CLASSES.hidden });
            }
          }
      
          // Inline code: hide the backticks and put the content in a code face.
          INLINE_CODE_RE.lastIndex = 0;
          for (let match = INLINE_CODE_RE.exec(line.text); match !== null; match = INLINE_CODE_RE.exec(line.text)) {
            const start = match.index;
            const ticks = match[1].length;
            const contentStart = start + ticks;
            const contentEnd = contentStart + match[2].length;
            const end = contentEnd + ticks;
            item.splits.push(contentStart, contentEnd);
            item.ranges.push({ start, end: contentStart, className: CLASSES.hidden });
            item.ranges.push({ start: contentEnd, end, className: CLASSES.hidden });
            item.ranges.push({ start: contentStart, end: contentEnd, className: CLASSES.inlineCode });
          }
      
          if (item.splits.length > 0 || item.ranges.length > 0) plan.push(item);
        }
        return plan;
      }
      
      /**
       * Whether the line's text nodes already break exactly where the plan needs.
       *
       * @param {{start: number, end: number}[]} runs - run offsets of the line.
       * @param {number[]} boundaries - required split positions.
       * @param {{start: number, end: number, className: string}[]} ranges - class ranges.
       * @returns {boolean} true when every boundary and range edge is a run edge.
       */
      function isIsolated(runs, boundaries, ranges) {
        const edges = new Set();
        for (const run of runs) {
          edges.add(run.start);
          edges.add(run.end);
        }
        for (const boundary of boundaries) {
          if (!edges.has(boundary)) return false;
        }
        for (const range of ranges) {
          if (!edges.has(range.start) || !edges.has(range.end)) return false;
        }
        return true;
      }
      
      /**
       * Apply the plan to the rendered DOM, reporting the lines that still need a
       * model-side split.
       *
       * @param {{text: string, runs: {node: Text, start: number, end: number}[], block: Element, lineInBlock: number}[]} lines - visual lines.
       * @param {{block: Element, line: number} | null} caret - the line being edited.
       * @param {Set<Element>} touched - elements this module marked last pass.
       * @returns {{lineIndex: number, boundaries: number[]}[]} lines to split.
       */
      function applySyntax(lines, caret, touched) {
        for (const element of touched) {
          if (typeof element.classList === 'undefined') continue;
          for (const className of ALL_CLASSES) element.classList.remove(className);
        }
        touched.clear();
      
        const requests = [];
        for (const item of syntaxPlan(lines, caret)) {
          const line = lines[item.lineIndex];
          if (line === undefined || line.runs.length === 0) continue;
          if (!isIsolated(line.runs, item.splits, item.ranges)) {
            const boundaries = [...new Set([
              ...item.splits,
              ...item.ranges.flatMap(range => [range.start, range.end]),
            ])].filter(boundary => boundary > 0 && boundary < line.text.length);
            if (boundaries.length > 0) requests.push({ lineIndex: item.lineIndex, boundaries });
            continue;
          }
          for (const range of item.ranges) {
            for (const run of line.runs) {
              if (run.start < range.start || run.end > range.end) continue;
              const element = run.node.parentElement;
              if (element === null || element === undefined || element === line.block) continue;
              if (typeof element.classList === 'undefined') continue;
              element.classList.add(range.className);
              touched.add(element);
            }
          }
        }
        return requests;
      }
      
      /**
       * Split each planned line at the requested boundaries.
       *
       * @param {object} editor - the live Lexical editor.
       * @param {{lineIndex: number, boundaries: number[]}[]} plan - lines to split.
       * @returns {boolean} whether an update was attempted.
       */
      function splitSyntax(editor, plan) {
        if (editor === null || editor === undefined || typeof editor.update !== 'function') return false;
        if (!Array.isArray(plan) || plan.length === 0) return false;
        try {
          editor.update(() => {
            const state = editor._pendingEditorState ?? editor.getEditorState();
            if (state === null || state === undefined) return;
            const root = state._nodeMap.get('root');
            if (root === null || root === undefined || typeof root.getChildren !== 'function') return;
      
            /**
             * Read the draft's visual lines as their text nodes, mirroring the DOM
             * reader's model (blocks are lines, a line break starts a new one, and a
             * trailing break with no text is an empty line's placeholder).
             * @returns {object[][]} text nodes per visual line.
             */
            const readModelLines = () => {
              const lines = [];
              for (const block of root.getChildren()) {
                if (typeof block.getChildren !== 'function') continue;
                const children = block.getChildren();
                let parts = [];
                children.forEach((child, index) => {
                  const type = typeof child.getType === 'function' ? child.getType() : '';
                  if (type === 'linebreak') {
                    const isLast = index === children.length - 1;
                    if (isLast && parts.length === 0) return;
                    lines.push(parts);
                    parts = [];
                    return;
                  }
                  if (type === 'text') parts.push(child);
                });
                lines.push(parts);
              }
              return lines;
            };
      
            for (const change of plan) {
              for (const boundary of [...change.boundaries].sort((left, right) => left - right)) {
                // Re-read after every split: the previous one replaced the node this
                // boundary was computed against.
                const nodes = readModelLines()[change.lineIndex] ?? [];
                let offset = 0;
                let target = null;
                for (const node of nodes) {
                  const text = typeof node.getTextContent === 'function' ? node.getTextContent() : '';
                  if (boundary > offset && boundary < offset + text.length) {
                    target = { node, local: boundary - offset };
                    break;
                  }
                  offset += text.length;
                }
                if (target === null) continue;
                if (typeof target.node.splitText !== 'function') continue;
                const parts = target.node.splitText(target.local);
                for (const part of parts) {
                  if (part === null || part === undefined) continue;
                  if (typeof part.isUnmergeable !== 'function' || typeof part.toggleUnmergeable !== 'function') continue;
                  if (!part.isUnmergeable()) part.toggleUnmergeable();
                }
              }
            }
          }, { tag: HISTORY_MERGE_TAG });
          return true;
        } catch (error) {
          console.warn('[markdown-live] syntax collapsing skipped', error);
          return false;
        }
      }
      
      module.exports = { applySyntax, syntaxPlan, splitSyntax, ALL_CLASSES, CLASSES, HISTORY_MERGE_TAG };
      
    });

    __define('./newlines.cjs', function (module, exports, require) {
      /**
       * Newline normalisation for pasted drafts.
       *
       * The composer's paste path hands the whole clipboard payload to
       * `selection.insertText`, and Lexical keeps it in a *single* text node,
       * newlines included. The browser paints those as line breaks, but the node is
       * one element: nothing line-scoped can be styled until each line is a node of
       * its own, and a hidden span would swallow the newline with it.
       *
       * This pass converts every embedded `\n` into Lexical's own `LineBreakNode`,
       * which is what typing produces anyway. The draft's text is byte-identical
       * afterwards — `LineBreakNode` projects to `\n` — so submission, clipboard and
       * persistence are unaffected.
       */
      const HISTORY_MERGE_TAG = 'history-merge';
      
      /**
       * Convert embedded newlines in the draft's text nodes into line breaks.
       *
       * @param {object} editor - the live Lexical editor.
       * @returns {boolean} whether an update was attempted.
       */
      function normalizeNewlines(editor) {
        if (editor === null || editor === undefined || typeof editor.update !== 'function') return false;
        const registry = editor._nodes;
        const LineBreak = registry !== null && registry !== undefined && typeof registry.get === 'function'
          ? registry.get('linebreak')?.klass
          : undefined;
        if (typeof LineBreak !== 'function') return false;
        try {
          editor.update(() => {
            const state = editor._pendingEditorState ?? editor.getEditorState();
            if (state === null || state === undefined) return;
            const root = state._nodeMap.get('root');
            if (root === null || root === undefined || typeof root.getChildren !== 'function') return;
            const selection = state._selection;
            for (const block of root.getChildren().slice()) {
              if (typeof block.getChildren !== 'function') continue;
              for (const child of block.getChildren().slice()) {
                if (typeof child.getType !== 'function' || child.getType() !== 'text') continue;
                const raw = typeof child.getTextContent === 'function' ? child.getTextContent() : '';
                if (!raw.includes('\n') && !raw.includes('\r')) continue;
                // Windows clipboards carry CRLF; the draft keeps LF only.
                const text = raw.replace(/\r\n?/g, '\n');
                const pieces = text.split('\n');
                const TextClass = child.constructor;
      
                // Remember where the caret sits before the node is rewritten.
                let caretPiece = -1;
                let caretOffset = 0;
                if (selection !== null && selection !== undefined && selection.anchor !== null && selection.anchor.key === child.getKey()) {
                  let consumed = 0;
                  for (let index = 0; index < pieces.length; index += 1) {
                    const end = consumed + pieces[index].length;
                    if (selection.anchor.offset <= end) {
                      caretPiece = index;
                      caretOffset = selection.anchor.offset - consumed;
                      break;
                    }
                    consumed = end + 1;
                  }
                }
      
                /** @type {object[]} */
                const pieceNodes = [];
                child.setTextContent(pieces[0]);
                pieceNodes.push(child);
                let cursor = child;
                for (let index = 1; index < pieces.length; index += 1) {
                  cursor = cursor.insertAfter(new LineBreak());
                  if (pieces[index] !== '') cursor = cursor.insertAfter(new TextClass(pieces[index]));
                  pieceNodes.push(cursor);
                }
      
                if (caretPiece >= 0) {
                  const target = pieceNodes[caretPiece];
                  if (target !== null && target !== undefined && pieces[caretPiece] !== '') {
                    selection.anchor.set(target.getKey(), caretOffset, 'text');
                    if (selection.focus !== null && selection.focus.key === child.getKey()) {
                      selection.focus.set(target.getKey(), caretOffset, 'text');
                    }
                  }
                }
              }
            }
          }, { tag: HISTORY_MERGE_TAG });
          return true;
        } catch (error) {
          console.warn('[markdown-live] newline normalisation skipped', error);
          return false;
        }
      }
      
      module.exports = { normalizeNewlines };
      
    });

    __define('./render.cjs', function (module, exports, require) {
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
      
    });

    __define('./continuation.cjs', function (module, exports, require) {
      /**
       * List auto-continuation: Shift+Enter on a list line starts the next item with
       * the incremented marker.
       *
       * This is the one place the plugin edits the draft instead of only painting it,
       * so the two halves use the cheapest safe channel each:
       *
       *   - **reading** the caret's line uses the rendered DOM only. The composer's
       *     own model is never touched, which keeps this path free of Lexical's
       *     "no active editor state" failure (#195) and of any dependency on its
       *     internal node API;
       *   - **writing** the marker goes through the editor's own update cycle and
       *     the selection's `insertText` — the same call the host uses internally —
       *     and is tagged `history-merge` so one undo removes both the line break and
       *     the marker.
       *
       * The key press itself is never prevented: the host performs its own line
       * break, and the marker follows one frame later. Every failure path degrades to
       * a plain line break and is reported instead of thrown.
       */
      const { COMPOSER_INPUT, SKIP_SUBTREE } = require('./constants.cjs');
      const { classify } = require('./grammar.cjs');
      const { continuationOf, exitPlanOf } = require('./list.cjs');
      
      /** A visible trigger menu owns Enter and Shift+Enter while it is open. */
      const MENU_PROBE = '[data-composer-card] [role="listbox"]';
      /** @lexical/history merges an update carrying this tag into the previous undo entry. */
      const HISTORY_MERGE_TAG = 'history-merge';
      /** Elements that start a new visual line without a <br>. */
      const BLOCKS = new Set(['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE']);
      
      /** Element test that also works with the stub trees the tests build. */
      const isElement = node => node !== null && node !== undefined && node.nodeType === 1;
      
      /** One-shot diagnostics, so a session reports a broken contract once. */
      const reported = new Set();
      
      /**
       * Report a diagnostic once per session.
       * @param {string} key - the report identity.
       * @param {string} message - text to emit.
       * @param {unknown} [error] - optional failure cause.
       * @returns {void}
       */
      function reportOnce(key, message, error) {
        if (reported.has(key)) return;
        reported.add(key);
        // console.error is the level the desktop shell forwards into its log, so a
        // broken host contract leaves a diagnosable trace instead of silence.
        console.error(message, error === undefined ? '' : error);
      }
      
      /**
       * Read the composer's visual lines from the rendered DOM.
       *
       * A line is a run of text between two line breaks: a block boundary or a
       * `<br>` inside a block. Unlike the painter, this keeps empty lines — the
       * continuation needs to address the line the caret just created even before it
       * holds text. Decorative chips are skipped, exactly as the painter skips them.
       *
       * @param {HTMLElement} root - the composer's contenteditable.
       * @returns {{lines: string[], blocks: {element: Element, firstLine: number, count: number}[]}}
       *   the visual lines plus each block's slice of them.
       */
      function readLines(root) {
        const lines = [];
        const blocks = [];
        for (const block of root.children) {
          if (!isElement(block)) continue;
          const blockLines = [];
          let text = '';
          const flush = () => {
            blockLines.push(text);
            text = '';
          };
          const visit = node => {
            for (let child = node.firstChild; child !== null; child = child.nextSibling) {
              if (child.nodeType === 3) {
                // A pasted payload can carry newlines inside one text node; they are
                // painted as line breaks, so they are read as line breaks.
                const pieces = (child.nodeValue ?? '').split('\n');
                pieces.forEach((piece, index) => {
                  if (index > 0) flush();
                  text += piece;
                });
                continue;
              }
              if (child.nodeType !== 1) continue;
              const element = /** @type {Element} */ (child);
              if (element.matches(SKIP_SUBTREE)) continue;
              if (element.tagName === 'BR') {
                // A lone trailing <br> is the browser's placeholder that gives an
                // empty line its height; it is not an extra line of its own.
                if (child.nextSibling === null && text === '') continue;
                flush();
                continue;
              }
              visit(element);
            }
          };
          visit(block);
          flush();
          blocks.push({ element: block, firstLine: lines.length, count: blockLines.length });
          for (const line of blockLines) lines.push(line);
        }
        return { lines, blocks };
      }
      
      /**
       * Locate a caret inside one block, in visual-line coordinates.
       *
       * @param {Element} block - the block containing the caret.
       * @param {Node} container - the caret's container node.
       * @param {number} offset - the caret's offset inside that container.
       * @returns {{line: number, column: number} | null} the position, or null.
       */
      /**
       * Position of a caret whose container is an element, counting its children.
       * @param {Element} element - the element holding the caret.
       * @param {number} offset - the caret offset among its children.
       * @returns {{line: number, column: number}} the position.
       */
      function elementPosition(element, offset) {
        let line = 0;
        let column = 0;
        let index = 0;
        /**
         * Advance the position over one string, counting embedded newlines.
         * @param {string} value - text to consume.
         * @returns {void}
         */
        const advance = value => {
          const pieces = value.split('\n');
          if (pieces.length > 1) {
            line += pieces.length - 1;
            column = pieces[pieces.length - 1].length;
            return;
          }
          column += value.length;
        };
        for (let child = element.firstChild; child !== null && index < offset; child = child.nextSibling, index += 1) {
          if (child.nodeType === 3) {
            advance(child.nodeValue ?? '');
            continue;
          }
          if (child.nodeType !== 1) continue;
          const inner = /** @type {Element} */ (child);
          if (inner.tagName === 'BR') {
            line += 1;
            column = 0;
          } else if (!inner.matches(SKIP_SUBTREE)) {
            advance(inner.textContent === null ? '' : inner.textContent);
          }
        }
        return { line, column };
      }
      
      function locateWithin(block, container, offset) {
        if (container === block) return elementPosition(block, offset);
        let line = 0;
        let column = 0;
        let found = false;
        /**
         * Advance the position over one string, counting embedded newlines.
         * @param {string} value - text to consume.
         * @returns {void}
         */
        const advance = value => {
          const pieces = value.split('\n');
          if (pieces.length > 1) {
            line += pieces.length - 1;
            column = pieces[pieces.length - 1].length;
            return;
          }
          column += value.length;
        };
        const visit = node => {
          for (let child = node.firstChild; child !== null; child = child.nextSibling) {
            if (found) return;
            if (child === container) {
              if (child.nodeType === 3) {
                advance((child.nodeValue ?? '').slice(0, offset));
              } else if (child.nodeType === 1) {
                const position = elementPosition(/** @type {Element} */ (child), offset);
                line += position.line;
                column = position.line === 0 ? column + position.column : position.column;
              }
              found = true;
              return;
            }
            if (child.nodeType === 3) {
              advance(child.nodeValue ?? '');
              continue;
            }
            if (child.nodeType !== 1) continue;
            const element = /** @type {Element} */ (child);
            if (element.matches(SKIP_SUBTREE)) continue;
            if (element.tagName === 'BR') {
              line += 1;
              column = 0;
              continue;
            }
            if (element.contains(container)) {
              visit(element);
              return;
            }
            advance(element.textContent === null ? '' : element.textContent);
          }
        };
        visit(block);
        return found ? { line, column } : null;
      }
      
      /**
       * Locate an arbitrary caret position in the composer's line coordinates.
       *
       * @param {{lines: string[], blocks: {element: Element, firstLine: number, count: number}[]}} draft - readLines output.
       * @param {Node} container - the caret's container node.
       * @param {number} offset - the caret's offset inside it.
       * @returns {{lineIndex: number, column: number} | null} the caret, or null.
       */
      function planForCaret(draft, container, offset) {
        if (container === null || container === undefined) return null;
        for (const block of draft.blocks) {
          if (block.element !== container && !block.element.contains(container)) continue;
          const within = locateWithin(block.element, container, offset);
          if (within === null) return null;
          return { lineIndex: block.firstLine + within.line, column: within.column };
        }
        return null;
      }
      
      /**
       * Locate the current selection in the composer's line coordinates.
       * @param {HTMLElement} root - the composer's contenteditable.
       * @param {{lines: string[], blocks: {element: Element, firstLine: number, count: number}[]}} draft - readLines output.
       * @returns {{lineIndex: number, column: number} | null} the caret, or null.
       */
      function locateCaret(root, draft) {
        const selection = typeof document.getSelection === 'function' ? document.getSelection() : null;
        if (selection === null || selection.rangeCount === 0 || selection.isCollapsed === false) return null;
        const range = selection.getRangeAt(0);
        if (range.collapsed === false) return null;
        const container = range.startContainer;
        if (container === null || !root.contains(container)) return null;
        return planForCaret(draft, container, range.startOffset);
      }
      
      /**
       * Classify one line, carrying fence state from the draft's first line.
       * @param {string[]} lines - every visual line.
       * @param {number} index - the line to classify.
       * @returns {string} the grammar kind of that line.
       */
      function kindAt(lines, index) {
        const state = { open: false, char: '`', length: 3 };
        let kind = 'text';
        for (let i = 0; i <= index && i < lines.length; i += 1) kind = classify(lines[i], state).kind;
        return kind;
      }
      
      /**
       * Insert text at the caret inside the editor's own update cycle.
       *
       * @param {object} editor - the live Lexical editor.
       * @param {string} text - text to insert.
       * @returns {boolean} whether an insertion was attempted.
       */
      function insertAtCaret(editor, text) {
        if (editor === null || editor === undefined || typeof editor.update !== 'function') return false;
        try {
          editor.update(() => {
            const state = editor._pendingEditorState ?? editor.getEditorState();
            const selection = state === null || state === undefined ? null : state._selection;
            if (selection === null || selection === undefined || typeof selection.insertText !== 'function') return;
            selection.insertText(text);
          }, { tag: HISTORY_MERGE_TAG });
          return true;
        } catch (error) {
          reportOnce('insert', '[markdown-live] list continuation could not insert the marker', error);
          return false;
        }
      }
      
      /**
       * Read the draft's visual lines as their text nodes, mirroring the DOM reader.
       * @param {object} state - the editor state.
       * @returns {object[][]} text nodes per visual line.
       */
      function modelLines(state) {
        const root = state._nodeMap.get('root');
        if (root === null || root === undefined || typeof root.getChildren !== 'function') return [];
        const lines = [];
        for (const block of root.getChildren()) {
          if (typeof block.getChildren !== 'function') continue;
          const children = block.getChildren();
          let parts = [];
          children.forEach((child, index) => {
            const type = typeof child.getType === 'function' ? child.getType() : '';
            if (type === 'linebreak') {
              const isLast = index === children.length - 1;
              if (isLast && parts.length === 0) return;
              lines.push(parts);
              parts = [];
              return;
            }
            if (type === 'text') parts.push(child);
          });
          lines.push(parts);
        }
        return lines;
      }
      
      /**
       * Remove one range from the draft by selecting it and deleting, which keeps
       * Lexical in charge of undo and of the caret.
       *
       * @param {object} editor - the live Lexical editor.
       * @param {{lineIndex: number, from: number, to: number}} plan - range to clear.
       * @returns {boolean} whether an update was attempted.
       */
      function clearMarker(editor, plan) {
        if (editor === null || editor === undefined || typeof editor.update !== 'function') return false;
        try {
          editor.update(() => {
            const state = editor._pendingEditorState ?? editor.getEditorState();
            if (state === null || state === undefined) return;
            const selection = state._selection;
            if (selection === null || selection === undefined || typeof selection.removeText !== 'function') return;
            const nodes = modelLines(state)[plan.lineIndex];
            if (nodes === undefined) return;
            let offset = 0;
            let anchor = null;
            let focus = null;
            for (const node of nodes) {
              const length = typeof node.getTextContent === 'function' ? node.getTextContent().length : 0;
              const start = offset;
              const end = offset + length;
              offset = end;
              if (anchor === null && plan.from >= start && plan.from < end) anchor = { node, local: plan.from - start };
              if (focus === null && plan.to > start && plan.to <= end) focus = { node, local: plan.to - start };
            }
            if (anchor === null || focus === null) return;
            selection.anchor.set(anchor.node.getKey(), anchor.local, 'text');
            selection.focus.set(focus.node.getKey(), focus.local, 'text');
            selection.removeText();
          }, { tag: HISTORY_MERGE_TAG });
          return true;
        } catch (error) {
          reportOnce('clear', '[markdown-live] could not clear the empty list marker', error);
          return false;
        }
      }
      
      /**
       * Build the continuation controller.
       * @returns {{start: () => void, dispose: () => void}} the lifecycle handle.
       */
      function createContinuation(options = {}) {
        /** The line a pending marker belongs to; cleared once fulfilled or stale. */
        let pending = null;
      
        /**
         * Whether the trigger menu is currently visible in the composer card.
         * @returns {boolean} true when a listbox is shown.
         */
        const menuOpen = () => {
          const menu = document.querySelector(MENU_PROBE);
          return menu instanceof HTMLElement && menu.offsetParent !== null;
        };
      
        /**
         * The composer element owning the current selection.
         * @returns {HTMLElement | null} the active composer, or null.
         */
        const activeComposer = () => {
          const selection = typeof document.getSelection === 'function' ? document.getSelection() : null;
          const node = selection === null ? null : selection.anchorNode;
          if (node === null) return null;
          const element = node.nodeType === 3 ? node.parentElement : node;
          if (!(element instanceof Element)) return null;
          const root = element.closest(COMPOSER_INPUT);
          return root instanceof HTMLElement ? root : null;
        };
      
        /**
         * The live Lexical editor bound to a composer root.
         * @param {HTMLElement} root - the contenteditable.
         * @returns {object | null} the editor, or null when the host shape changed.
         */
        const editorOf = root => {
          const editor = root.__lexicalEditor;
          if (editor === null || editor === undefined || typeof editor.update !== 'function') {
            reportOnce('editor', '[markdown-live] composer editor contract missing; list continuation is off');
            return null;
          }
          return editor;
        };
      
        /**
         * Insert the pending marker once the host's line break has landed.
         * @returns {void}
         */
        const fulfil = () => {
          const plan = pending;
          pending = null;
          if (plan === null || plan.root.isConnected !== true) return;
          try {
            const editor = editorOf(plan.root);
            if (editor === null) return;
            const draft = readLines(plan.root);
            const caret = locateCaret(plan.root, draft);
            if (caret === null) {
              reportOnce('caret-lost', '[markdown-live] list continuation: caret not locatable after the line break');
              return;
            }
            // Only continue when the caret actually landed at the start of the very
            // next line; anything else means the user edited or moved in between.
            if (caret.lineIndex !== plan.lineIndex + 1 || caret.column !== 0) {
              reportOnce(
                'unexpected-caret',
                `[markdown-live] list continuation: caret landed at line ${caret.lineIndex} column ${caret.column} (expected line ${plan.lineIndex + 1} column 0)`,
              );
              return;
            }
            if (insertAtCaret(editor, plan.marker) && typeof options.onDraftChanged === 'function') options.onDraftChanged();
          } catch (error) {
            reportOnce('fulfil', '[markdown-live] list continuation skipped after the line break', error);
          }
        };
      
        /**
         * Capture-phase keydown: recognise a list continuation and schedule it,
         * without preventing the host's own line break.
         * @param {KeyboardEvent} event - the key press.
         * @returns {void}
         */
        const onKeyDown = event => {
          try {
            if (event.defaultPrevented || event.isComposing) return;
            if (event.key !== 'Enter' || event.shiftKey === false) return;
            if (event.metaKey || event.ctrlKey || event.altKey) return;
            if (menuOpen()) return;
            const root = activeComposer();
            if (root === null) return;
            const draft = readLines(root);
            const caret = locateCaret(root, draft);
            if (caret === null || caret.lineIndex >= draft.lines.length) return;
            if (kindAt(draft.lines, caret.lineIndex) !== 'list') return;
            const line = draft.lines[caret.lineIndex];
      
            // Newline inside an empty item exits the list: the marker is removed and
            // no new line is started, the gesture Obsidian uses.
            const exit = exitPlanOf(line, caret.column);
            if (exit !== null) {
              const editor = editorOf(root);
              if (editor !== null) {
                // Lexical dispatches its Enter command without consulting
                // defaultPrevented, so the event must not reach it at all; this
                // gesture replaces the line break with the marker removal.
                event.preventDefault();
                event.stopImmediatePropagation();
                if (clearMarker(editor, { lineIndex: caret.lineIndex, from: exit.from, to: exit.to })) {
                  if (typeof options.onDraftChanged === 'function') options.onDraftChanged();
                }
                return;
              }
            }
      
            const plan = continuationOf(line.slice(0, caret.column));
            if (plan === null) return;
            pending = { root, lineIndex: caret.lineIndex, marker: `${plan.indent}${plan.marker}` };
            requestAnimationFrame(fulfil);
          } catch (error) {
            reportOnce('keydown', '[markdown-live] list continuation skipped this press', error);
          }
        };
      
        return {
          start() {
            document.addEventListener('keydown', onKeyDown, true);
          },
          dispose() {
            pending = null;
            document.removeEventListener('keydown', onKeyDown, true);
          },
        };
      }
      
      module.exports = {
        createContinuation, insertAtCaret, clearMarker, modelLines, readLines, locateCaret, locateWithin, planForCaret, kindAt, HISTORY_MERGE_TAG,
      };
      
    });

    __define('./renumber.cjs', function (module, exports, require) {
      /**
       * Ordered-list renumbering: keep every contiguous ordered group numbered 1..n.
       *
       * Continuation numbers the line the user just created; renumbering repairs the
       * lines around an insertion or a deletion. Together they are the two halves of
       * "the numbers just work", and both stay inside the draft: the message the
       * model receives carries the same digits the composer shows.
       *
       * Two rules keep the edits unsurprising:
       *
       *   - **the caret's own line is never edited.** Rewriting digits under a caret
       *     would move it, so that line keeps whatever number it has and the lines
       *     after it are numbered from there;
       *   - **a group in canonical order costs nothing.** A group already numbered
       *     1..n produces an empty plan, so ordinary typing never rewrites text;
       *   - **a lone item is left alone.** Only groups of two or more are repaired,
       *     so starting a list at "3." does not get rewritten under the author.
       *
       * The plan is computed from the rendered DOM (the same reader the continuation
       * uses); the edit is applied through the editor's update cycle so Lexical owns
       * the model, undo, and reconciliation.
       */
      const { COMPOSER_INPUT } = require('./constants.cjs');
      const { classify } = require('./grammar.cjs');
      const { readLines, locateCaret } = require('./continuation.cjs');
      
      /** @lexical/history merges an update carrying this tag into the previous undo entry. */
      const HISTORY_MERGE_TAG = 'history-merge';
      /** Ordered marker: indent, digits, delimiter, spacing. */
      const ORDERED_RE = /^([ \t]{0,12})(\d{1,9})([.)])([ \t\u00a0\u3000]+)/;
      /** How long the draft must stay quiet before numbers are repaired. */
      const SETTLE_MS = 150;
      /** Mutations this soon after our own edit are the edit itself, not the user. */
      const SELF_WINDOW_MS = 250;
      
      /**
       * Compute the digit rewrites that make every ordered group 1..n.
       *
       * @param {string[]} lines - the draft's visual lines.
       * @param {number} caretLine - index of the line to leave untouched, or -1.
       * @returns {{lineIndex: number, start: number, end: number, digits: string}[]}
       *   rewrites in line coordinates; empty when nothing needs repairing.
       */
      function renumberPlan(lines, caretLine) {
        const plan = [];
        const state = { open: false, char: '`', length: 3 };
        let group = [];
        let groupIndent = '';
      
        /**
         * Close the current group, emitting rewrites when its numbers are not 1..n.
         * @returns {void}
         */
        const flush = () => {
          if (group.length === 0) return;
          group.forEach((item, position) => {
            if (item.index === caretLine) return;
            const digits = String(position + 1);
            if (digits === item.digits) return;
            plan.push({ lineIndex: item.index, start: item.start, end: item.start + item.digits.length, digits });
          });
          group = [];
          groupIndent = '';
        };
      
        for (let index = 0; index < lines.length; index += 1) {
          const text = lines[index];
          const kind = classify(text, state).kind;
          const match = kind === 'list' ? ORDERED_RE.exec(text) : null;
          if (match === null) {
            flush();
            continue;
          }
          const indent = match[1];
          if (group.length > 0 && indent !== groupIndent) flush();
          groupIndent = indent;
          group.push({
            index,
            digits: match[2],
            start: indent.length,
          });
        }
        flush();
        return plan;
      }
      
      /**
       * Apply a renumber plan inside one editor update, restoring the caret.
       *
       * The caret is restored by key and offset: every rewrite targets a line other
       * than the caret's, so its node is untouched and survives the edit.
       *
       * @param {object} editor - the live Lexical editor.
       * @param {{lineIndex: number, start: number, end: number, digits: string}[]} plan - rewrites to apply.
       * @returns {boolean} whether an update was attempted.
       */
      function applyRenumber(editor, plan) {
        if (editor === null || editor === undefined || typeof editor.update !== 'function') return false;
        if (!Array.isArray(plan) || plan.length === 0) return false;
        try {
          editor.update(() => {
            const state = editor._pendingEditorState ?? editor.getEditorState();
            if (state === null || state === undefined) return;
            const selection = state._selection;
            if (selection === null || selection === undefined) return;
            const saved = {
              anchorKey: selection.anchor.key,
              anchorOffset: selection.anchor.offset,
              anchorType: selection.anchor.type,
              focusKey: selection.focus.key,
              focusOffset: selection.focus.offset,
              focusType: selection.focus.type,
            };
            const root = state._nodeMap.get('root');
            if (root === null || root === undefined || typeof root.getChildren !== 'function') return;
      
            // Visual lines as their text leaves, matching the DOM reader's rules:
            // a trailing line break that follows no text is the empty line's
            // placeholder, not an extra line.
            const lines = [];
            for (const block of root.getChildren()) {
              if (typeof block.getChildren !== 'function') continue;
              const children = block.getChildren();
              let parts = [];
              children.forEach((child, childIndex) => {
                const type = typeof child.getType === 'function' ? child.getType() : '';
                if (type === 'linebreak') {
                  const isLast = childIndex === children.length - 1;
                  if (isLast && parts.length === 0) return;
                  lines.push(parts);
                  parts = [];
                  return;
                }
                if (type !== 'text') return;
                parts.push({ node: child, text: typeof child.getTextContent === 'function' ? child.getTextContent() : '' });
              });
              lines.push(parts);
            }
      
            for (const change of plan) {
              const line = lines[change.lineIndex];
              if (line === undefined) continue;
              let offset = 0;
              for (const part of line) {
                const partStart = offset;
                const partEnd = offset + part.text.length;
                offset = partEnd;
                const from = Math.max(change.start, partStart);
                const to = Math.min(change.end, partEnd);
                if (to <= from) continue;
                selection.anchor.set(part.node.getKey(), from - partStart, 'text');
                selection.focus.set(part.node.getKey(), to - partStart, 'text');
                selection.insertText(change.digits);
                break;
              }
            }
      
            selection.anchor.set(saved.anchorKey, saved.anchorOffset, saved.anchorType);
            selection.focus.set(saved.focusKey, saved.focusOffset, saved.focusType);
          }, { tag: HISTORY_MERGE_TAG });
          return true;
        } catch (error) {
          console.warn('[markdown-live] renumbering skipped', error);
          return false;
        }
      }
      
      /**
       * Build the renumbering controller: watches the composer, and once the draft
       * settles, repairs ordered groups.
       *
       * @returns {{start: () => void, dispose: () => void}} the lifecycle handle.
       */
      function createRenumber() {
        let observer = null;
        let timer = 0;
        let disposed = false;
        let lastSelfEdit = 0;
      
        /**
         * Whether the composer currently owns a text caret (so its line can be left
         * alone) and what that line is.
         * @param {HTMLElement} root - the composer.
         * @returns {number} the caret line, or -1.
         */
        const caretLineOf = root => {
          const draft = readLines(root);
          const caret = locateCaret(root, draft);
          return caret === null ? -1 : caret.lineIndex;
        };
      
        /**
         * Run one repair pass if the draft needs it.
         * @returns {void}
         */
        const repair = () => {
          if (disposed) return;
          const root = document.querySelector(COMPOSER_INPUT);
          if (!(root instanceof HTMLElement)) return;
          const editor = root.__lexicalEditor;
          if (editor === null || editor === undefined) return;
          const evidence = document.activeElement === root || root.contains(document.activeElement);
          if (!evidence) return;
          const draft = readLines(root);
          const plan = renumberPlan(draft.lines, caretLineOf(root));
          if (plan.length === 0) return;
          if (applyRenumber(editor, plan)) lastSelfEdit = Date.now();
        };
      
        /**
         * Coalesce draft changes into one repair.
         * @returns {void}
         */
        const schedule = () => {
          if (disposed) return;
          if (Date.now() - lastSelfEdit < SELF_WINDOW_MS) return;
          if (timer !== 0) clearTimeout(timer);
          timer = window.setTimeout(() => {
            timer = 0;
            repair();
          }, SETTLE_MS);
        };
      
        /**
         * Repair as soon as the current frame paints, skipping the settle delay.
         * Used right after the plugin itself inserts a list marker, where waiting
         * would make the numbers below visibly lag.
         * @returns {void}
         */
        const repairNow = () => {
          if (disposed) return;
          if (timer !== 0) {
            clearTimeout(timer);
            timer = 0;
          }
          if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => repair());
          else repair();
        };
      
        return {
          repairNow,
          start() {
            if (disposed) return;
            observer = new MutationObserver(records => {
              for (const record of records) {
                const target = record.target;
                const element = target.nodeType === 3 ? target.parentElement : target;
                if (element instanceof Element && element.closest(COMPOSER_INPUT) !== null) {
                  schedule();
                  return;
                }
              }
            });
            observer.observe(document.body, { childList: true, characterData: true, subtree: true });
          },
          dispose() {
            disposed = true;
            if (timer !== 0) clearTimeout(timer);
            timer = 0;
            if (observer !== null) observer.disconnect();
            observer = null;
          },
        };
      }
      
      module.exports = { createRenumber, renumberPlan, applyRenumber, SETTLE_MS };
      
    });

    __define('./style-sheet.cjs', function (module, exports, require) {
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
      
    });

    __define('./index.cjs', function (module, exports, require) {
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
        // A marker the continuation inserts changes the numbering below it; repair
        // immediately instead of waiting for the settle timer.
        const continuation = createContinuation({ onDraftChanged: () => renumber.repairNow() });
      
        const dispose = () => {
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
      
    });

    var entry = __load('./index.cjs');
    return { name: entry.name, apply: entry.apply };
  },
});
