/**
 * The version chip: the installed version in the composer dock, and — when the
 * repository publishes a newer one — a link that opens it.
 *
 * The chip is optional decoration: it registers into `conversation.composer.dock`
 * only when that slot exists, and any failure is contained so the rendering
 * layer never depends on it.
 */
const { checkForUpdate } = require('./update.cjs');

/**
 * Build the React component for one runtime descriptor.
 * @param {object} React - the host's React.
 * @param {{version: string, repository: string}} runtime - compiled-in version info.
 * @returns {Function} the component.
 */
function createChip(React, runtime) {
  const h = React.createElement;

  /**
   * The chip itself.
   * @returns {object} a React element.
   */
  function VersionChip() {
    const [state, setState] = React.useState({ status: 'checking', latest: null });
    React.useEffect(() => {
      let cancelled = false;
      checkForUpdate({
        fetch: typeof window === 'undefined' || typeof window.fetch !== 'function' ? undefined : window.fetch.bind(window),
        repository: runtime.repository,
        current: runtime.version,
      }).then(result => {
        if (!cancelled) setState(result);
      });
      return () => { cancelled = true; };
    }, []);

    const update = state.status === 'update' && typeof state.latest === 'string';
    const label = update ? `v${runtime.version} → v${state.latest}` : `v${runtime.version}`;
    const style = {
      fontSize: '11px',
      lineHeight: '20px',
      whiteSpace: 'nowrap',
      color: update ? 'var(--dsw-alias-link, #2f7ce0)' : 'var(--dsw-alias-label-caption, rgba(136, 142, 150, 0.9))',
      textDecoration: update ? 'underline' : 'none',
      textUnderlineOffset: '2px',
    };
    if (update) {
      return h('a', {
        href: runtime.repository,
        target: '_blank',
        rel: 'noreferrer',
        title: 'dsh-markdown-live — open the repository to update',
        style,
      }, label);
    }
    return h('span', { title: 'dsh-markdown-live', style }, label);
  }

  return VersionChip;
}

/**
 * Register the chip into the composer dock, waiting briefly for the slot
 * service so an early apply cannot lose it.
 *
 * @param {object} ctx - the Cordis client context.
 * @param {{version: string, repository: string}} runtime - compiled-in version info.
 * @returns {{dispose: () => void}} the registration handle.
 */
function registerVersionChip(ctx, runtime) {
  let timer = 0;
  let attempts = 0;
  let registered = false;

  /**
   * Try once, then retry while the slot service is still missing.
   * @returns {void}
   */
  const attempt = () => {
    const slots = ctx === null || ctx === undefined ? null : ctx.slots;
    if (slots !== null && slots !== undefined && typeof slots.inject === 'function' && typeof slots.register === 'function') {
      try {
        slots.inject('conversation.composer.dock', () => slots.register({
          name: 'conversation.composer.dock',
          id: 'markdown-live-version',
          order: 40,
        }, createChip(require('react'), runtime)));
        registered = true;
      } catch (error) {
        console.warn('[markdown-live] version chip unavailable', error);
      }
      return;
    }
    attempts += 1;
    if (attempts <= 6) timer = setTimeout(attempt, 400 * attempts);
  };

  attempt();
  return {
    dispose() {
      if (timer !== 0) clearTimeout(timer);
      timer = 0;
    },
  };
}

/**
 * Build the Plugins-settings page: the installed version, a manual check, and
 * the repository link.
 *
 * @param {object} React - the host's React.
 * @param {{version: string, repository: string}} runtime - compiled-in version info.
 * @returns {Function} the component.
 */
function createSettingsPage(React, runtime) {
  const h = React.createElement;
  const row = { display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', lineHeight: '20px' };
  const button = {
    padding: '2px 10px',
    fontSize: '12px',
    lineHeight: '20px',
    borderRadius: 'var(--dsw-radius-sm, 6px)',
    border: '1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.3))',
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
  };
  const link = { color: 'var(--dsw-alias-link, #2f7ce0)', textDecoration: 'underline', textUnderlineOffset: '2px' };

  /**
   * The settings page.
   * @returns {object} a React element.
   */
  function SettingsPage() {
    const [state, setState] = React.useState({ status: 'idle', latest: null });

    /**
     * Run one upstream check.
     * @returns {void}
     */
    const run = () => {
      setState({ status: 'checking', latest: null });
      checkForUpdate({
        fetch: typeof window === 'undefined' || typeof window.fetch !== 'function' ? undefined : window.fetch.bind(window),
        repository: runtime.repository,
        current: runtime.version,
      }).then(setState);
    };

    React.useEffect(() => { run(); }, []);

    const text = state.status === 'checking'
      ? '正在检查…'
      : state.status === 'update'
        ? `发现新版本 v${state.latest}`
        : state.status === 'current'
          ? '已是最新版本'
          : state.status === 'unknown'
            ? '无法检查（网络不可用或受限）'
            : '';

    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
      h('div', { style: row }, h('span', null, '当前版本'), h('strong', null, `v${runtime.version}`)),
      h('div', { style: row }, h('span', null, '最新版本'), h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, text || '—')),
      h('div', { style: row },
        h('button', { type: 'button', style: button, onClick: run }, '检查更新'),
        h('a', { href: runtime.repository, target: '_blank', rel: 'noreferrer', style: link }, '打开仓库升级')),
      h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-caption)', lineHeight: '18px' } },
        '更新方式：在「插件」中移除本插件后再从 GitHub 添加，或执行 ',
        h('code', null, 'dsh plugin --profile desktop add github:YouYou-lj/dsh-markdown-live'), '。'),
    );
  }

  return SettingsPage;
}

/**
 * Register the settings page inside Settings → Plugins, waiting briefly for the
 * slot service.
 *
 * @param {object} ctx - the Cordis client context.
 * @param {{version: string, repository: string}} runtime - compiled-in version info.
 * @returns {{dispose: () => void}} the registration handle.
 */
function registerSettingsPage(ctx, runtime) {
  let timer = 0;
  let attempts = 0;

  /**
   * Try once, then retry while the slot service is still missing.
   * @returns {void}
   */
  const attempt = () => {
    const slots = ctx === null || ctx === undefined ? null : ctx.slots;
    if (slots !== null && slots !== undefined && typeof slots.inject === 'function' && typeof slots.register === 'function') {
      try {
        slots.inject('settings.plugins.tab', () => slots.register({
          name: 'settings.plugins.tab',
          id: 'markdown-live',
          order: 40,
          label: 'Markdown composer',
        }, createSettingsPage(require('react'), runtime)));
      } catch (error) {
        console.warn('[markdown-live] settings page unavailable', error);
      }
      return;
    }
    attempts += 1;
    if (attempts <= 6) timer = setTimeout(attempt, 400 * attempts);
  };

  attempt();
  return { dispose() { if (timer !== 0) clearTimeout(timer); timer = 0; } };
}

module.exports = { createChip, createSettingsPage, registerSettingsPage, registerVersionChip };
