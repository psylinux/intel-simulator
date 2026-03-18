/**
 * i18n.js — Internacionalização do Intel x86/x64 Memory & Stack Lab
 *
 * Como usar (para tradutores):
 *   1. Copie locales/pt-BR.json para locales/<lang>.json
 *   2. Traduza apenas os valores (nunca as chaves)
 *   3. Mantenha os placeholders {0}, {1}, {2}... intocados
 *   4. Adicione o locale no array AVAILABLE_LOCALES abaixo
 *
 * Como usar (para desenvolvedores):
 *   - t('chave')               → string traduzida
 *   - t('chave', val0, val1)   → string com {0}, {1} substituídos
 *   - Em HTML: data-i18n="chave"           → substitui textContent
 *              data-i18n-html="chave"       → substitui innerHTML
 *              data-i18n-title="chave"      → substitui title
 *              data-i18n-placeholder="chave"→ substitui placeholder
 */

const I18N = (() => {
  // ── Locales disponíveis ────────────────────────────────────────────────────
  const AVAILABLE_LOCALES = [
    { code: 'pt-BR', name: 'Português (Brasil)' },
    { code: 'en-US', name: 'English (US)' },
  ];

  const LOCALE_STORAGE_KEY = 'intel_sim_locale';
  const DEFAULT_LOCALE = 'pt-BR';

  let _strings = {};
  let _current = DEFAULT_LOCALE;

  // ── Interpolação: t('chave', arg0, arg1, ...) ─────────────────────────────
  function t(key, ...args) {
    const raw = _strings[key];
    if (raw === undefined) {
      console.warn(`[i18n] key not found: "${key}"`);
      return key;
    }
    if (!args.length) return raw;
    return raw.replace(/\{(\d+)\}/g, (_, i) => {
      const v = args[Number(i)];
      return v !== undefined ? v : `{${i}}`;
    });
  }

  // ── Aplica traduções a todos os elementos data-i18n* no DOM ───────────────
  function applyDOM(root = document) {
    root.querySelectorAll('[data-i18n]').forEach(el => {
      const k = el.getAttribute('data-i18n');
      if (_strings[k] !== undefined) el.textContent = _strings[k];
    });
    root.querySelectorAll('[data-i18n-html]').forEach(el => {
      const k = el.getAttribute('data-i18n-html');
      if (_strings[k] !== undefined) el.innerHTML = _strings[k];
    });
    root.querySelectorAll('[data-i18n-title]').forEach(el => {
      const k = el.getAttribute('data-i18n-title');
      if (_strings[k] !== undefined) el.title = _strings[k];
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const k = el.getAttribute('data-i18n-placeholder');
      if (_strings[k] !== undefined) el.placeholder = _strings[k];
    });
  }

  // ── Carrega um arquivo de locale via fetch ─────────────────────────────────
  async function load(code) {
    const url = `locales/${code}.json`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // Remove a chave de metadados antes de usar
      const { _meta, ...strings } = data;
      _strings = strings;
      _current = code;
      document.documentElement.lang = _meta?.lang ?? code;
      document.documentElement.dir  = _meta?.dir  ?? 'ltr';
      if (_strings['page.title']) document.title = _strings['page.title'];
      localStorage.setItem(LOCALE_STORAGE_KEY, code);
      return true;
    } catch (err) {
      console.error(`[i18n] Failed to load locale "${code}":`, err);
      return false;
    }
  }

  // ── Inicialização: detecta locale salvo ou preferência do browser ──────────
  async function init() {
    const saved    = localStorage.getItem(LOCALE_STORAGE_KEY);
    const browser  = navigator.language; // e.g. "en-US", "pt-BR"
    const codes    = AVAILABLE_LOCALES.map(l => l.code);

    // Prioridade: 1. salvo pelo usuário  2. browser exato  3. prefixo (pt)  4. default
    const candidate =
      (saved && codes.includes(saved) ? saved : null) ||
      (codes.includes(browser) ? browser : null) ||
      (codes.find(c => c.startsWith(browser.split('-')[0])) ?? null) ||
      DEFAULT_LOCALE;

    await load(candidate);
    applyDOM();

    // Atualiza o seletor de língua se já existir no DOM
    _syncLangSwitcher();
  }

  // ── Troca de idioma em tempo real ─────────────────────────────────────────
  async function setLocale(code) {
    if (code === _current) return;
    const ok = await load(code);
    if (ok) {
      applyDOM();
      _syncLangSwitcher();
      // Notifica o app.js para reatualizar strings geradas por JS
      document.dispatchEvent(new CustomEvent('i18n:changed', { detail: { locale: code } }));
    }
  }

  function _syncLangSwitcher() {
    const sel = document.getElementById('langSwitcher');
    if (sel) sel.value = _current;
  }

  // ── API pública ───────────────────────────────────────────────────────────
  return {
    t,
    init,
    load,
    setLocale,
    applyDOM,
    get current()  { return _current; },
    get locales()  { return AVAILABLE_LOCALES; },
  };
})();

// Atalho global para uso em app.js: t('key', ...args)
function t(key, ...args) { return I18N.t(key, ...args); }
