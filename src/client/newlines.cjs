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
