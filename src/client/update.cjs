/**
 * Version comparison and the upstream check for the version chip.
 *
 * The check reads the repository's `package.json` from GitHub's raw host (CORS
 * open, no token) and compares it with the version compiled into this bundle.
 * It never throws: an offline machine or a rate limit simply reports "unknown"
 * and the chip keeps showing the installed version.
 */

/**
 * Parse a semantic version into its numeric and prerelease parts.
 * @param {string} value - a version like `1.2.3` or `1.2.0-rc.1`.
 * @returns {{major: number, minor: number, patch: number, pre: string[]} | null} the parts.
 */
function parseVersion(value) {
  if (typeof value !== 'string') return null;
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value.trim());
  if (match === null) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] === undefined ? [] : match[4].split('.'),
  };
}

/**
 * Compare two semantic versions.
 * @param {string} left - first version.
 * @param {string} right - second version.
 * @returns {number} negative when left is older, 0 when equal, positive when newer.
 */
function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (a === null || b === null) return 0;
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  // A release is newer than its own prereleases.
  if (a.pre.length === 0 && b.pre.length > 0) return 1;
  if (b.pre.length === 0 && a.pre.length > 0) return -1;
  for (let index = 0; index < Math.max(a.pre.length, b.pre.length); index += 1) {
    const leftPart = a.pre[index];
    const rightPart = b.pre[index];
    if (leftPart === rightPart) continue;
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    const leftNumber = /^\d+$/.test(leftPart);
    const rightNumber = /^\d+$/.test(rightPart);
    if (leftNumber && rightNumber) return Number(leftPart) < Number(rightPart) ? -1 : 1;
    if (leftNumber) return -1;
    if (rightNumber) return 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

/**
 * The published version in a repository's package.json.
 * @param {string} text - raw file contents.
 * @returns {string | null} the version, or null when it cannot be read.
 */
function versionFromManifest(text) {
  try {
    const data = JSON.parse(text);
    return typeof data.version === 'string' && parseVersion(data.version) !== null ? data.version : null;
  } catch {
    return null;
  }
}

/**
 * Build the raw manifest URL for a repository.
 * @param {string} repository - `https://github.com/<owner>/<name>`.
 * @param {string} [branch] - default branch.
 * @returns {string | null} the raw URL, or null.
 */
function manifestUrlOf(repository, branch = 'main') {
  const match = /^https?:\/\/github\.com\/([^/]+)\/([^/#?]+)/.exec(typeof repository === 'string' ? repository : '');
  if (match === null) return null;
  return `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${branch}/package.json`;
}

/**
 * Ask GitHub for the published version and compare it with the installed one.
 *
 * @param {{fetch: typeof fetch, repository: string, current: string, branch?: string, timeoutMs?: number}} options - check inputs.
 * @returns {Promise<{status: 'current'|'update'|'unknown', latest: string | null}>} the result.
 */
async function checkForUpdate(options) {
  const url = manifestUrlOf(options.repository, options.branch);
  if (url === null || typeof options.fetch !== 'function') return { status: 'unknown', latest: null };
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => { if (controller !== null) controller.abort(); }, options.timeoutMs ?? 6000);
  try {
    const response = await options.fetch(url, {
      cache: 'no-store',
      signal: controller === null ? undefined : controller.signal,
    });
    if (response === null || response === undefined || response.ok !== true) return { status: 'unknown', latest: null };
    const latest = versionFromManifest(await response.text());
    if (latest === null) return { status: 'unknown', latest: null };
    return { status: compareVersions(latest, options.current) > 0 ? 'update' : 'current', latest };
  } catch {
    return { status: 'unknown', latest: null };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { checkForUpdate, compareVersions, manifestUrlOf, parseVersion, versionFromManifest };
