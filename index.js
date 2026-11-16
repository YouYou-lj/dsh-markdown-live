/**
 * Host half of dsh-markdown-live.
 *
 * All behaviour ships in the browser bundle (`dsh.client`, `./client`); this
 * row exists so the bundle appears in the loader and in Settings → Plugins,
 * where it can be switched off like any other plugin.
 */

/** Plugin id; matches the cordis.patch.yml row and the Client bundle id. */
export const name = 'markdown-live';

/**
 * Host plugin body — intentionally empty: no host services, no configuration,
 * no data leaves the page.
 * @returns {void}
 */
export function apply() {}
