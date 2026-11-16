# dsh-markdown-live

[English](README.md) · [简体中文](README.zh-CN.md)

Renders Markdown inside the DSH composer while you type — without replacing the
composer, changing its size, or touching `@` mentions and `/` commands.

## What it renders

| Markdown | In the composer |
| --- | --- |
| `**bold**`, `*italic*`, `~~strike~~` | weight, double underline, strike-through |
| `` `code` `` | backticks hidden, monospace chip |
| `[label](url)` | link colour and underline |
| `#` … `#####` | marker hidden, line grows — never bold |
| `- item` | the dash becomes a dot as soon as you type `- ` |
| `1. item` | number kept, text follows directly; Shift+Enter continues it, an empty item exits the list, groups stay numbered `1..n` |
| `> quote` | marker hidden once the line is finished |
| ` ``` ` fences | code surface, monospace, token colours (strings, numbers, keywords, calls, comments) |
| pasted blocks | normalised into real lines and rendered like typed text |

Finished lines render; the line you are editing keeps its literal Markdown, and
clicking back into a rendered line restores the markers. Paste works too — a
whole block lands in one text node and is split into lines on the spot.
Markers are recognised with a half-width, no-break, or full-width space after
them (`#　标题` counts).

## Install

Marketplace — **Settings → DSH Plugin Market**, search *Markdown composer*, install, reload the page.

npm / GitHub / local checkout:

```sh
dsh plugin --profile web add dsh-markdown-live
dsh plugin --profile web add github:YouYou-lj/dsh-markdown-live
dsh plugin --profile web add link:/absolute/path/to/dsh-markdown-live
```

Reload the page after installing, then toggle it in **Settings → Plugins**.

## Notes

- Chromium's `::highlight()` cannot change font weight or style, so bold is drawn
  with a zero-blur text-shadow and italic with a double underline.
- Headings stop at level five; `######` and longer runs stay ordinary text.
- Numbered items are not indented into a column, so `1.` and `10.` do not align
  their text; a wrapped item line starts at the margin (the composer keeps the
  whole draft in one paragraph).
- `---` is left as typed: a rule is not drawn.

## Development

```sh
node scripts/build.mjs          # regenerate client.js from src/client/*.cjs
node tests/run-tests.mjs        # grammar, inline, lists, traversal, bundle, manifest
node tests/markdown-matrix.mjs  # one row per rendered construct
```

A second suite runs the editor-facing code against the real Lexical 0.49 in a
sibling checkout (`../dsh-md-harness/tests/lexical-harness.mjs`).

## License

MIT
