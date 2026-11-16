# Compatibility

The plugin is built for the **DSH desktop app** (the Electron shell hosting the
Web client) and for a `dsh web` server — both render the same Web UI.

## Verified against

| Component | Version |
| --- | --- |
| DSH desktop | `2.0.23-next` |
| DSH runtime (`@deepseek-ai/dsh-app-boot`) | `0.2.2-rc.3` |
| Lexical (bundled by the composer) | `0.49.0` |
| Chromium | `152` |

`package.json` declares the runtime window it is verified for:

```json
"engines": { "dsh": ">=0.2.0-rc.1 <0.3.0-0" }
```

The installer and the plugin manager read `engines.dsh`; a runtime outside that
range reports an unmet requirement instead of failing silently later. Within
`0.2.x` the contracts below have been stable, so patch and minor updates are
expected to keep working; `0.3` is treated as a breaking boundary.

## What it depends on

These shapes are the whole host surface. Each one is feature-probed:

| Contract | Used for | If it moves |
| --- | --- | --- |
| `[data-composer-input]` contenteditable | reading the draft | rendering stops, input untouched |
| `data-lexical-text` text elements | per-line classes | markers stay literal |
| `__lexicalEditor.update / getEditorState / _nodes / _selection` | editor-side edits (split, insert, delete) | list continuation and marker collapsing stop |
| `TextNode.splitText`, `toggleUnmergeable` | isolating markers | markers stay visible, nothing breaks |
| `linebreak` node class | pasted-newline normalisation | paste keeps its newlines as one node |
| CSS Custom Highlight API | inline colours | no inline styling; the composer still works |

Nothing is disabled wholesale: a missing piece turns off the feature that needs
it, and every pass runs inside a guard. After an update, the browser console
prints which contract is missing:

```
[markdown-live] host contract changed: text.splitText; affected features degrade, the rest keeps working
```

## Keeping up

- `npm test` runs the logic suite, the rendering matrix and the real-Lexical
  harness — the last one pins `devDependencies.lexical` to the version DSH
  bundles, so bumping it is the check for a new composer.
- CI runs the same suites on every push and pull request.
- A weekly *Upstream drift* workflow compares the published
  `@deepseek-ai/dsh-app-boot` version against `engines.dsh` and `lexical`
  against the pinned version, and opens a tracking issue when either moves.

If you hit a break after a DSH update, open an issue with the console message
above and the DSH version — that names the contract that needs adapting.
