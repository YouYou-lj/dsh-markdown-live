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
