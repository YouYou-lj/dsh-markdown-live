/**
 * Build the single browser artifact the Client module loader expects.
 *
 * The shipped `client.js` is generated from `src/client/*.cjs`, so the source
 * stays reviewable and the bundle stays a dependency-free classic script that
 * only touches `window.__ModuleLoader__`. Run `node scripts/build.mjs`; pass
 * `--check` to fail when the committed artifact is stale.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageName = 'dsh-markdown-live';

/** Modules in dependency order; the entry is last. */
const MODULES = [
  './constants.cjs',
  './grammar.cjs',
  './list.cjs',
  './inline.cjs',
  './dom.cjs',
  './decorate.cjs',
  './tokens.cjs',
  './syntax.cjs',
  './newlines.cjs',
  './render.cjs',
  './continuation.cjs',
  './renumber.cjs',
  './style-sheet.cjs',
  './index.cjs',
];

/**
 * Wrap one CommonJS module body for the local registry.
 * @param {string} id - module id as required from other modules.
 * @param {string} source - its source text.
 * @returns {string} the wrapped definition.
 */
function wrap(id, source) {
  return `    __define('${id}', function (module, exports, require) {\n${source.replace(/^/gm, '      ')}\n    });\n`;
}

const sources = await Promise.all(MODULES.map(id => readFile(join(root, 'src/client', id.slice(2)), 'utf8')));

const artifact = `/*!
 * ${packageName} — generated browser bundle. Do not edit.
 * Source: src/client/*.cjs. Rebuild: node scripts/build.mjs
 */
window.__ModuleLoader__.load({
  id: '${packageName}',
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

${sources.map((source, index) => wrap(MODULES[index], source)).join('\n')}
    var entry = __load('./index.cjs');
    return { name: entry.name, apply: entry.apply };
  },
});
`;

const target = join(root, 'client.js');
if (process.argv.includes('--check')) {
  const current = await readFile(target, 'utf8').catch(() => '');
  if (current !== artifact) {
    console.error('client.js is stale; run: node scripts/build.mjs');
    process.exit(1);
  }
  console.log('client.js is up to date');
} else {
  await writeFile(target, artifact, 'utf8');
  console.log(`wrote client.js (${artifact.length} bytes, ${MODULES.length} modules)`);
}
