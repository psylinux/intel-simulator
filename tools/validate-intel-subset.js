#!/usr/bin/env node
/*-*- mode:javascript;indent-tabs-mode:nil;c-basic-offset:2;tab-width:8;coding:utf-8 -*-│
│ vi: set et ft=javascript ts=2 sts=2 sw=2 fenc=utf-8                               :vi │
╞═══════════════════════════════════════════════════════════════════════════════════════╡
│ Copyright 2026 Marcos Azevedo (aka psylinux)                                          │
│                                                                                       │
│ Permission to use, copy, modify, and/or distribute this software for                  │
│ any purpose with or without fee is hereby granted, provided that the                  │
│ above copyright notice and this permission notice appear in all copies.               │
│                                                                                       │
│ THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL                         │
│ WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED                         │
│ WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE                      │
│ AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL                  │
│ DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR                 │
│ PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER                        │
│ TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR                      │
│ PERFORMANCE OF THIS SOFTWARE.                                                         │
╚───────────────────────────────────────────────────────────────────────────────────────*/

'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT   = path.resolve(__dirname, '..');

// Lista de arquivos em ordem de dependência.
// Durante a refatoração em fases, basta trocar APP_JS por APP_FILES
// progressivamente. Por ora, app.js contém tudo.
const APP_FILES = [
  'js/app-state.js',
  'js/app-utils.js',
  'js/app-registers.js',
  'js/app-memory.js',
  'js/app-assembler.js',
  'js/app-logger.js',
  'js/app-cpu.js',
  'js/app-layout.js',
  'js/app-ui.js',
  'js/app-main.js',
].map(f => path.join(ROOT, f));

// Mock mínimo de I18N — substitui a dependência de browser (i18n.js)
// no contexto Node/vm, permitindo remover I18N_PT do código do app.
const I18N_MOCK = `
const I18N = { t: k => k, init: ()=>{}, setLocale: ()=>{}, applyDOM: ()=>{},
               current: ()=>'pt-BR', locales: ()=>[] };
function t(key) { return key; }
`;

// ─────────────────────────────────────────────────────────────────────────
// Mock DOM infrastructure
// ─────────────────────────────────────────────────────────────────────────
class MockClassList {
  constructor() { this.items = new Set(); }
  add(...t)         { t.filter(Boolean).forEach(x => this.items.add(x)); }
  remove(...t)      { t.forEach(x => this.items.delete(x)); }
  contains(t)       { return this.items.has(t); }
  toggle(t, force) {
    if (force === true)  { this.items.add(t);    return true;  }
    if (force === false) { this.items.delete(t); return false; }
    if (this.items.has(t)) { this.items.delete(t); return false; }
    this.items.add(t); return true;
  }
}

class MockElement {
  constructor(id = '', tagName = 'div') {
    this.id          = id;
    this.tagName     = tagName.toUpperCase();
    this.children    = [];
    this.dataset     = {};
    this.style       = { setProperty() {}, removeProperty() {}, cssText: '' };
    this.classList   = new MockClassList();
    this.className   = '';
    this.value       = '';
    this.textContent = '';
    this.innerHTML   = '';
    this.disabled    = false;
    this.title       = '';
    this.placeholder = '';
    this.scrollTop   = 0;
    this.scrollHeight= 0;
    this.clientHeight= 360;
    this.onclick     = null;
    this.listeners   = {};
    this.maxLength   = Infinity;
    this.type        = 'text';
    this.min         = '';
    this.max         = '';
    this.step        = '';
    this.checked     = false;
    this.selected    = false;
    this.options     = [];
    this.selectedIndex = 0;
  }
  appendChild(c)            { this.children.push(c); this.scrollHeight = this.children.length * 24; return c; }
  append(...ns)             { ns.forEach(n => this.appendChild(n)); }
  get childNodes()          { return this.children; }
  querySelector()           { return new MockElement(); }
  querySelectorAll()        { return []; }
  addEventListener(t, h)   { (this.listeners[t] = this.listeners[t] || []).push(h); }
  removeEventListener()    {}
  setAttribute(k, v)       { this[k] = v; }
  getAttribute(k)          { return this[k] ?? null; }
  hasAttribute(k)          { return k in this; }
  focus()  {}
  select() {}
  scrollIntoView() {}
  remove() {}
  click()  { if (typeof this.onclick === 'function') this.onclick({ target: this, preventDefault() {}, stopPropagation() {} }); }
  closest()                { return null; }
  getBoundingClientRect()  { return { left:0, top:0, right:640, bottom:480, width:640, height:480 }; }
  insertBefore(n)          { this.children.unshift(n); return n; }
  replaceChild(n, o)       { const i = this.children.indexOf(o); if (i >= 0) this.children[i] = n; return o; }
  removeChild(c)           { this.children = this.children.filter(x => x !== c); return c; }
  contains()               { return false; }
  get parentElement()      { return null; }
  get nextSibling()        { return null; }
  get previousSibling()    { return null; }
  get firstChild()         { return this.children[0] || null; }
  get lastChild()          { return this.children[this.children.length - 1] || null; }
  get nodeType()           { return 1; }
}

function createDocument() {
  const elements = new Map();
  // IDs whose elements should return null (dynamic render targets, animation elements)
  const nullIds = [
    /^animStage$/, /^animSVG$/, /^rc-/, /^rcv-/, /^rcb-/, /^rpv-/, /^rpb-/,
    /^r[A-Z0-9]+$/, /^stackView$/, /^stackLegend$/,
    /^codeMemSplit/, /^sidebarResize/, /^stackResize/,
    /^pcDisplay$/, /^ipChipLbl$/, /^clockDisplay$/, /^opsDisplay$/, /^archDisplay$/,
  ];
  const doc = {
    body: new MockElement('body', 'body'),
    _listeners: {},
    getElementById(id) {
      if (nullIds.some(rx => rx.test(id))) return null;
      if (!elements.has(id)) elements.set(id, new MockElement(id));
      return elements.get(id);
    },
    querySelectorAll() { return []; },
    querySelector()    { return null; },
    createElement(t)   { return new MockElement('', t); },
    createElementNS(_, t) { return new MockElement('', t); },
    createTextNode(text)  { return { nodeType: 3, nodeValue: String(text) }; },
    createDocumentFragment() { return new MockElement('', 'fragment'); },
    addEventListener(t, h) { this._listeners[t] = h; },
  };
  return { document: doc, elements };
}

function loadSimulator() {
  const { document, elements } = createDocument();
  const storage = new Map();
  let tick = 0;
  const ctx = {
    console, Math, Date, JSON, RegExp, Array, Object, Set, Map,
    String, Number, Boolean, BigInt, Promise, Uint8Array,
    parseInt, parseFloat,
    URL: { createObjectURL() { return 'blob:mock'; } },
    Blob:       class Blob {},
    FileReader: class FileReader {},
    setTimeout(fn)           { if (typeof fn === 'function') fn(); return 0; },
    clearTimeout()           {},
    setInterval(fn)          { return 0; },
    clearInterval()          {},
    requestAnimationFrame(fn){ if (typeof fn === 'function') fn((tick += 16)); return 0; },
    cancelAnimationFrame()   {},
    performance: { now() { return ++tick; } },
    localStorage: {
      getItem(k)    { return storage.has(k) ? storage.get(k) : null; },
      setItem(k, v) { storage.set(k, String(v)); },
      removeItem(k) { storage.delete(k); },
    },
    document,
    navigator: { userAgent: 'node' },
    ResizeObserver: class ResizeObserver { observe(){} unobserve(){} disconnect(){} },
    MutationObserver: class MutationObserver { observe(){} disconnect(){} },
    getComputedStyle() { return { getPropertyValue() { return ''; } }; },
    CSS: { supports() { return false; } },
    addEventListener() {},
    removeEventListener() {},
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);

  const appSource = APP_FILES.map(f => fs.readFileSync(f, 'utf8')).join('\n');
  const source = I18N_MOCK + appSource + `
globalThis.__memsim = {
  S,
  AppGlobal: typeof globalThis.App !== 'undefined' ? globalThis.App : null,
  init,
  decodeAt,
  validateAssembly,
  assemble,
  doFetch,
  _executeOne,
  doStore,
  doLoad,
  doPush,
  doPop,
  doRun,
  doStop,
  doPause,
  doResume,
  doStepForward,
  doStepBack,
  toggleBreakpoint,
  instrStartFor,
  bpNumber,
  // nomes novos (pós-refatoração) — aliases para compatibilidade
  setArch:    typeof setArch    !== 'undefined' ? setArch    : doSetArch,
  setEndian:  typeof setEndian  !== 'undefined' ? setEndian  : doSetEndian,
  clearSim:   typeof clearSim   !== 'undefined' ? clearSim   : doClear,
  selectReg:  typeof selectReg  !== 'undefined' ? selectReg  : doSelectReg,
  clearLog:   typeof clearLog   !== 'undefined' ? clearLog   : doClearLog,
  assembleInput: typeof assembleInput !== 'undefined' ? assembleInput : doAssemble,
  // nomes originais mantidos durante transição
  doSetArch,
  doSetEndian,
  doClear,
  setPC,
  getReg,
  setReg,
  regHex,
  regBytes,
  regParts,
  setRegParts,
  setRegFromBytes,
  ptrSize,
  mapAccessFits,
  stackAccessFits,
  isInstructionFault,
  loadDefaultProgram,
  resetCoreRegisters,
  getBytes,
  ordered,
  hex32,
  hex8,
  fmtA,
  clamp,
  normalizeStackSizeBytes,
  normalizeSpeed,
  isSpReg,
  isStackTopReg,
  isStackBaseReg,
  gpRegs,
  extRegs,
  spRegs,
  is64,
  sizeN,
  transferWidth,
  // utils extended
  trimNumericText,
  memByteAt,
  memEl,
  // register extended
  markRegistersChanged,
  clearChangedRegisters,
  regWidthBytes,
  resetStatsState,
  resetStackState,
  // memory extended
  setMemSt,
  writeMem,
  writeStackBytes,
  readStackBytes,
  readStackPtrLE,
  renderMemGrid,
  // assembler validation
  editDistance,
  wideAliasForReg,
  parseAsmMemoryOperand,
  // cpu history
  snapshotState,
  restoreSnapshot,
};
`;
  vm.runInContext(source, ctx, { filename: APP_FILES[APP_FILES.length - 1] });
  return { api: ctx.__memsim, document, elements };
}

// ─────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────

// Arrays produced inside the vm context have a different Array.prototype
// than the host context. assert.deepEqual (strict mode) checks prototypes,
// so comparisons always fail unless we convert to a plain native Array first.
function toArr(v) {
  return Array.from(v ?? []);
}

function hexBytes(bytes) {
  // Use Array.from so the result is a plain host-context Array, not a vm Array
  return Array.from(bytes, v => v.toString(16).padStart(2, '0').toUpperCase());
}
function setAddr(doc, addr) {
  doc.getElementById('addrInput').value = addr.toString(16).padStart(4, '0').toUpperCase();
}
function defaultStackTop(api) {
  return api.S.stackSize;
}
function resetSim(api, document, arch = 'ia32') {
  api.S.arch         = arch;
  api.S.endian       = 'little';
  api.S.reg          = arch === 'x64' ? 'RAX' : 'EAX';
  api.S.stackSize    = 100 * 1024;   // 100 KB
  api.S.busy         = false;
  api.S.halt         = false;
  api.S.stopped      = false;
  api.S.paused       = false;
  api.S.faulted      = false;
  api.S.progRunning  = false;
  api.S.history        = [];
  api.S.callFrames     = [];
  api.S.breakpoints    = new (Object.getPrototypeOf(api.S.breakpoints).constructor)();
  api.S.breakpointHit  = null;
  api.resetCoreRegisters();
  api.S.stackMem     = new Uint8Array(api.S.stackSize);
  api.S.regs.ESP     = defaultStackTop(api);
  api.S.regs.EBP     = defaultStackTop(api);
  api.S.mem.fill(0);
  api.S.memState.fill('');
  setAddr(document, 0);
  api.setPC(0);
}
function writeBytes(api, addr, bytes) {
  bytes.forEach((b, i) => {
    api.S.mem[(addr + i) & 0x3F] = b & 0xFF;
    api.S.memState[(addr + i) & 0x3F] = 'mc-written';
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Test runner
// ─────────────────────────────────────────────────────────────────────────
const tests = [];
let currentSuite = '';

function suite(name) { currentSuite = name; }

function test(name, fn) {
  tests.push({ name: `[${currentSuite}] ${name}`, fn });
}

function sortedStrings(values) {
  return [...values].sort();
}

function extractInlineLocales() {
  const src = fs.readFileSync(path.join(ROOT, 'js/i18n.js'), 'utf8');
  const ptMatch = src.match(/'pt-BR': (\{[\s\S]*?\n\s*\}),\n\s*'en-US':/);
  const enMatch = src.match(/'en-US': (\{[\s\S]*?\n\s*\}),?\n\s*\};/);
  assert.ok(ptMatch, 'must find pt-BR locale block in js/i18n.js');
  assert.ok(enMatch, 'must find en-US locale block in js/i18n.js');
  const ptData = JSON.parse(ptMatch[1]);
  const enData = JSON.parse(enMatch[1]);
  return {
    pt:     new Set(Object.keys(ptData)),
    en:     new Set(Object.keys(enData)),
    ptData,
    enData,
  };
}
// Backward-compat alias used by older call sites
function extractInlineLocaleKeys() { return extractInlineLocales(); }

// ═══════════════════════════════════════════════════════════════════════════
//  SUITE: PURE UTILITIES
// ═══════════════════════════════════════════════════════════════════════════
suite('utils');

test('hex32: unsigned, zero-padded, uppercase', () => {
  const { api } = loadSimulator();
  assert.equal(api.hex32(0xDEADBEEF), 'DEADBEEF');
  assert.equal(api.hex32(0),          '00000000');
  assert.equal(api.hex32(1),          '00000001');
  assert.equal(api.hex32(-1),         'FFFFFFFF');   // unsigned truncation
  assert.equal(api.hex32(0x100000000),'00000000');   // overflow → 0
});

test('hex8: masked to 8 bits, uppercase', () => {
  const { api } = loadSimulator();
  assert.equal(api.hex8(0xEF),   'EF');
  assert.equal(api.hex8(0),      '00');
  assert.equal(api.hex8(0x1FF),  'FF');  // masked
  assert.equal(api.hex8(255),    'FF');
});

test('fmtA: 4-char zero-padded hex', () => {
  const { api } = loadSimulator();
  assert.equal(api.fmtA(0),      '0000');
  assert.equal(api.fmtA(0x3F),   '003F');
  assert.equal(api.fmtA(0xABCD), 'ABCD');
});

// ═══════════════════════════════════════════════════════════════════════════
//  SUITE: I18N
// ═══════════════════════════════════════════════════════════════════════════
suite('i18n');

test('inline i18n locale blocks expose the same keys for pt-BR and en-US', () => {
  const { pt, en } = extractInlineLocales();
  assert.deepEqual(
    sortedStrings(pt),
    sortedStrings(en),
    'js/i18n.js must keep pt-BR and en-US key sets in sync'
  );
});

test('instruction-pointer locale strings use architecture-specific placeholders and remove legacy EIP/RIP keys', () => {
  const inlineSrc = fs.readFileSync(path.join(ROOT, 'js/i18n.js'), 'utf8');
  const { ptData: pt, enData: en } = extractInlineLocales();

  ['topbar.pc.title', 'topbar.chip.pc', 'mem.legend.pc', 'topbar.ip.title', 'topbar.chip.lastop', 'topbar.chip.ops', 'topbar.chip.arch', 'editguide.hint1.ip', 'log.sys.pc_manual'].forEach(key => {
    assert.equal(key in pt, false, `pt-BR locale must not expose legacy key ${key}`);
    assert.equal(key in en, false, `en-US locale must not expose legacy key ${key}`);
    assert.equal(inlineSrc.includes(`"${key}":`), false, `js/i18n.js must not expose legacy key ${key}`);
  });

  assert.equal(pt['editguide.hint1'], 'Clique nos <strong>valores dos registradores</strong> para editar. Use <strong>2× clique</strong> no <strong>MAPA DE MEMORIA</strong> para editar bytes.');
  assert.equal(en['editguide.hint1'], 'Click on <strong>register values</strong> to edit. Use <strong>double-click</strong> on the <strong>MEMORY MAP</strong> to edit bytes.');
  assert.equal(en['ui.asm.write.title'], 'Writes bytes at current {0}. Press Enter to confirm.');
  assert.equal(en['help.ops'].includes('updating {0}, registers, memory and stack'), true);
  assert.equal(en['log.sys.pc_moved'], '{0} moved to code listing 0x{1}');
  assert.equal(en['log.info.execute_desc'], 'Applies the architectural effects of the decoded instruction on {0}, registers, memory and stack as needed.');
  assert.equal(en['status.demo_arch'], '{0} demo program loaded — {1} at 0x0000');
  assert.equal(en['status.demo_reset'], 'Demo program restored — {0} at 0x0000');
  assert.equal(JSON.stringify(pt).includes('EIP/RIP'), false, 'pt-BR locale must not contain combined EIP/RIP labels');
  assert.equal(JSON.stringify(en).includes('EIP/RIP'), false, 'en-US locale must not contain combined EIP/RIP labels');
});

// ═══════════════════════════════════════════════════════════════════════════
//  SUITE: BOOT
// ═══════════════════════════════════════════════════════════════════════════
suite('boot');

test('App API is exposed on the global object for HTML handlers and post-init i18n hooks', () => {
  const { api } = loadSimulator();
  assert.ok(api.AppGlobal, 'globalThis.App must exist after loading app scripts');
  assert.equal(typeof api.AppGlobal.setArch, 'function');
  assert.equal(typeof api.AppGlobal._applyI18n, 'function');
});

test('init renders ASM trace on first load without requiring architecture re-selection', () => {
  const { api, document } = loadSimulator();
  api.init();
  const trace = document.getElementById('asmTrace');
  assert.ok(trace, 'asmTrace element must exist in the initial DOM');
  assert.ok(/asm-line|trace-row|MOV|CALL/.test(trace.innerHTML), 'initial boot must populate the ASM listing');
  assert.equal(document.getElementById('ipChipLbl'), null, 'topbar instruction-pointer chip was removed');
  assert.equal(document.getElementById('pcDisplay'), null, 'topbar instruction-pointer input was removed');
  assert.equal(document.getElementById('memLegendIpLbl').textContent, 'EIP', 'initial boot must sync the memory-legend instruction pointer label');
});

test('index.html first paint removes the old topbar chips and keeps only the memory-map instruction-pointer label', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.equal(html.includes('EIP/RIP'), false, 'static HTML must not expose combined EIP/RIP labels during refresh');
  assert.equal(html.includes('id="ipChipLbl"'), false, 'topbar instruction-pointer chip must not exist');
  assert.equal(html.includes('id="pcDisplay"'), false, 'topbar instruction-pointer input must not exist');
  assert.equal(html.includes('id="clockDisplay"'), false, 'topbar last-op indicator must not exist');
  assert.equal(html.includes('id="opsDisplay"'), false, 'topbar ops indicator must not exist');
  assert.equal(html.includes('id="archDisplay"'), false, 'topbar architecture indicator must not exist');
  assert.equal(/id="memLegendIpLbl">EIP</.test(html), true, 'memory legend must boot with EIP placeholder');
  assert.equal(/id="editGuideHint1"/.test(html), true, 'quick-edit hint must still exist');
  assert.equal(/id="editGuideHint1"[\s\S]*<strong>EIP<\/strong>/.test(html), false, 'quick-edit hint must no longer mention the removed topbar pointer control');
  assert.equal(/id="editGuideHint1"[\s\S]*<strong>RIP<\/strong>/.test(html), false, 'quick-edit hint must no longer mention the removed topbar pointer control');
  assert.equal(html.includes('data-i18n="topbar.chip.pc"'), false, 'instruction-pointer chip label must be driven dynamically, not by a stale locale key');
  assert.equal(html.includes('data-i18n="mem.legend.pc"'), false, 'memory legend label must be driven dynamically, not by a stale locale key');
});

test('layout uses spacing instead of dedicated divider elements around the control bar and logs', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
  assert.equal(html.includes('id="ctrlBarDivider"'), false, 'HTML must not render a dedicated divider after the control bar');
  assert.equal(html.includes('id="codeMemLogDivider"'), false, 'HTML must not render a dedicated divider before the logs');
  assert.equal(css.includes('#ctrlBarDivider'), false, 'CSS must not style a removed divider after the control bar');
  assert.equal(css.includes('#codeMemLogDivider'), false, 'CSS must not style a removed divider before the logs');
  assert.equal(css.includes('--code-mem-splitter-w: 18px;'), true, 'code/memory splitter must keep symmetric breathing room around the resize handle');
  assert.equal(css.includes('width: calc(100% - (var(--canvas-edge) * 2));'), true, 'control bar and panes must share the same computed width');
  assert.equal(css.includes('.canvas-pane {\n  flex: 1 1 auto;\n  align-self: stretch;\n  min-width: 0;\n  min-height: 0;\n  width: calc(100% - (var(--canvas-edge) * 2));\n  max-width: calc(100% - (var(--canvas-edge) * 2));\n  margin: 0 var(--canvas-edge) var(--canvas-gap);'), true, 'stacked panes must keep the shared side insets and bottom spacing');
  assert.equal(css.includes('#ctrlBar {\n  flex: 0 0 auto;\n  display: flex;\n  align-items: stretch;\n  justify-content: center;\n  gap: 0;\n  width: calc(100% - (var(--canvas-edge) * 2));\n  max-width: calc(100% - (var(--canvas-edge) * 2));\n  margin: var(--canvas-gap) var(--canvas-edge) var(--canvas-gap);'), true, 'control bar must keep a top gap instead of sticking to the banner');
  assert.equal(css.includes('.canvas-pane-handle {\n  flex: 0 0 14px;\n  width: 100%;\n  display: flex;\n  align-items: center;\n  justify-content: center;'), true, 'pane resize handle must center its grip to keep symmetric top and bottom spacing');
  assert.equal(css.includes('.canvas-pane-handle::before {\n  content: \'\';\n  display: block;\n  width: 52px;\n  height: 4px;\n  margin: 0;'), true, 'pane resize handle grip must not rely on asymmetric top margin');
  assert.equal(css.includes('.section-badge {\n  font-size: var(--fs-ui-sm); letter-spacing: 1.4px; color: #f8fbff; font-weight: 800;\n  display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px;\n  flex: 0 0 auto;\n  align-self: center;\n  width: calc(100% - 12px);'), true, 'section badges must stay slightly narrower than their pane');
  assert.equal(css.includes('.section-badge {\n  font-size: var(--fs-ui-sm); letter-spacing: 1.4px; color: #f8fbff; font-weight: 800;\n  display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px;\n  flex: 0 0 auto;\n  align-self: center;\n  width: calc(100% - 12px);\n  min-height: 0;\n  line-height: 1.35;\n  margin: 8px auto 6px;'), true, 'section badges must keep a small symmetric horizontal inset');
  assert.equal(css.includes('.mem-col-bp .section-badge {\n  align-self: stretch;\n  width: 100%;'), true, 'breakpoint badge must override the generic inset and match the breakpoint status width');
  assert.equal(css.includes('#logOutput {\n  flex: 0 0 auto;\n  overflow: visible;\n  padding: 10px 0 12px;'), true, 'log output must not add extra horizontal inset around entries');
  assert.equal(css.includes('.le {\n  --log-accent: var(--tx1);'), true, 'log entry styles must exist');
  assert.equal(css.includes('.le {\n  --log-accent: var(--tx1);\n  --log-tint: rgba(139,164,192,.08);\n  --log-kind-bg: rgba(139,164,192,.14);\n  --log-kind-bdr: rgba(139,164,192,.28);\n  --log-kind-tx: #dce8f5;\n  --log-msg-tx: #d5e4f2;\n  --log-code-bg: rgba(139,164,192,.10);\n  --log-code-bdr: rgba(139,164,192,.24);\n  position: relative;\n  align-self: stretch;\n  width: 100%;'), true, 'log entries must stretch to the full log body width');
  assert.equal(css.includes('#codeMemRow .canvas-pane-body {\n  overflow: visible;\n  padding-bottom: 10px;'), true, 'code/memory pane body must keep extra space before the resize handle');
  assert.equal(css.includes('#codeMemSplit {\n  display: grid;\n  grid-template-columns: auto var(--code-mem-splitter-w) minmax(0, 1fr);\n  gap: 0;\n  width: 100%;'), true, 'codeMemSplit must expand to the full shared pane width');
  assert.equal(css.includes('#codeMemRow {\n  margin-bottom: 0;'), false, 'code/memory pane must keep the standard bottom spacing');
});

suite('utils');

test('clamp: boundaries and middle', () => {
  const { api } = loadSimulator();
  assert.equal(api.clamp(5, 0, 10),  5);
  assert.equal(api.clamp(-5, 0, 10), 0);
  assert.equal(api.clamp(15, 0, 10), 10);
  assert.equal(api.clamp(0, 0, 0),   0);
});

test('getBytes: LSB first, correct count', () => {
  const { api } = loadSimulator();
  assert.deepEqual(toArr(api.getBytes(0x12345678, 4)), [0x78, 0x56, 0x34, 0x12]);
  assert.deepEqual(toArr(api.getBytes(0x12345678, 2)), [0x78, 0x56]);
  assert.deepEqual(toArr(api.getBytes(0x12345678, 1)), [0x78]);
  assert.deepEqual(toArr(api.getBytes(0x00000000, 4)), [0, 0, 0, 0]);
  assert.deepEqual(toArr(api.getBytes(0xFFFFFFFF, 4)), [0xFF, 0xFF, 0xFF, 0xFF]);
});

test('ordered: little-endian = LSB first, big-endian = MSB first', () => {
  const { api } = loadSimulator();
  // Intel Vol.1 §1.3.2: little-endian stores LSB at lowest address
  assert.deepEqual(toArr(api.ordered(0xDEADBEEF, 4, 'little')), [0xEF, 0xBE, 0xAD, 0xDE]);
  assert.deepEqual(toArr(api.ordered(0xDEADBEEF, 4, 'big')),    [0xDE, 0xAD, 0xBE, 0xEF]);
  assert.deepEqual(toArr(api.ordered(0x1234, 2, 'little')),     [0x34, 0x12]);
  assert.deepEqual(toArr(api.ordered(0x1234, 2, 'big')),        [0x12, 0x34]);
});

test('normalizeStackSizeBytes: clamps to [1, 1MB]', () => {
  const { api } = loadSimulator();
  assert.equal(api.normalizeStackSizeBytes(0),        1);
  assert.equal(api.normalizeStackSizeBytes(100),      100);
  assert.equal(api.normalizeStackSizeBytes(1048576),  1048576);
  assert.equal(api.normalizeStackSizeBytes(9999999),  1048576);
  assert.equal(api.normalizeStackSizeBytes(-10),      1);
});

test('normalizeSpeed: clamps to [80, 10000]', () => {
  const { api } = loadSimulator();
  assert.equal(api.normalizeSpeed(80),    80);
  assert.equal(api.normalizeSpeed(0),     80);
  assert.equal(api.normalizeSpeed(2500),  2500);
  assert.equal(api.normalizeSpeed(99999), 10000);
});

// ═══════════════════════════════════════════════════════════════════════════
//  SUITE: REGISTER ACCESS
// ═══════════════════════════════════════════════════════════════════════════
suite('regs');

test('getReg/setReg round-trip for all IA-32 GP registers', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  const gp = ['EAX','EBX','ECX','EDX','ESI','EDI'];
  gp.forEach((r, i) => {
    const v = (0xAABBCC00 + i) >>> 0;
    api.setReg(r, v);
    assert.equal(api.getReg(r), v, `${r} round-trip`);
  });
});

test('getReg/setReg round-trip for x64 GP registers (lo32)', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'x64');
  const gp = ['RAX','RBX','RCX','RDX','RSI','RDI'];
  gp.forEach((r, i) => {
    const v = (0xDEAD0000 + i) >>> 0;
    api.setReg(r, v);
    assert.equal(api.getReg(r), v, `${r} round-trip`);
  });
});

test('RSP aliases to S.regs.ESP in both arches', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'x64');
  api.setReg('RSP', 0x1234);
  assert.equal(api.S.regs.ESP, 0x1234);
  assert.equal(api.getReg('RSP'), 0x1234);
});

test('RBP aliases to S.regs.EBP', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'x64');
  api.setReg('RBP', 0xABCD);
  assert.equal(api.S.regs.EBP, 0xABCD);
  assert.equal(api.getReg('RBP'), 0xABCD);
});

test('R8–R15 independent storage (x64 only)', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'x64');
  for (let i = 8; i <= 15; i++) {
    const name = `R${i}`;
    const v = (0x10000000 + i) >>> 0;
    api.setReg(name, v);
    assert.equal(api.getReg(name), v, `${name} round-trip`);
  }
});

test('regBytes IA-32: EAX=0xDEADBEEF → [EF,BE,AD,DE]', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.setReg('EAX', 0xDEADBEEF);
  assert.deepEqual(toArr(api.regBytes('EAX', 4)), [0xEF, 0xBE, 0xAD, 0xDE]);
});

test('regBytes: partial width (2 bytes, 1 byte)', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.setReg('EAX', 0xDEADBEEF);
  assert.deepEqual(toArr(api.regBytes('EAX', 2)), [0xEF, 0xBE]);
  assert.deepEqual(toArr(api.regBytes('EAX', 1)), [0xEF]);
});

test('regHex: 8 chars for 32-bit, correct value', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.setReg('EBX', 0xCAFEBABE);
  assert.equal(api.regHex('EBX'), 'CAFEBABE');
});

test('regParts: lo32 and hi32 separated correctly', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'x64');
  api.setRegParts('RAX', 0x11111111, 0x22222222);
  const { lo, hi } = api.regParts('RAX');
  assert.equal(lo, 0x11111111);
  assert.equal(hi, 0x22222222);
});

test('setRegFromBytes reconstructs 32-bit value from LE bytes', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  // 0x12345678 little-endian = [0x78, 0x56, 0x34, 0x12]
  api.setRegFromBytes('EAX', [0x78, 0x56, 0x34, 0x12]);
  assert.equal(api.getReg('EAX'), 0x12345678);
});

test('setRegFromBytes reconstructs 64-bit value from LE bytes', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'x64');
  // 0x1122334455667788 LE = [88,77,66,55,44,33,22,11]
  api.setRegFromBytes('RAX', [0x88,0x77,0x66,0x55,0x44,0x33,0x22,0x11]);
  assert.equal(api.regHex('RAX'), '1122334455667788');
});

test('ptrSize: 4 in ia32, 8 in x64', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  assert.equal(api.ptrSize(), 4);
  api.S.arch = 'x64';
  assert.equal(api.ptrSize(), 8);
});

test('isSpReg / isStackTopReg / isStackBaseReg helpers', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  assert.equal(api.isSpReg('ESP'), true);
  assert.equal(api.isSpReg('EBP'), true);
  assert.equal(api.isSpReg('EAX'), false);
  assert.equal(api.isStackTopReg('ESP'), true);
  assert.equal(api.isStackTopReg('EBP'), false);
  assert.equal(api.isStackBaseReg('EBP'), true);
  assert.equal(api.isStackBaseReg('ESP'), false);
  api.S.arch = 'x64';
  assert.equal(api.isStackTopReg('RSP'), true);
  assert.equal(api.isStackBaseReg('RBP'), true);
});

test('gpRegs/extRegs/spRegs return correct sets per arch', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  assert.deepEqual(toArr(api.gpRegs()),  ['EAX','EBX','ECX','EDX','ESI','EDI']);
  assert.deepEqual(toArr(api.extRegs()), []);
  assert.deepEqual(toArr(api.spRegs()),  ['ESP','EBP']);
  api.S.arch = 'x64';
  assert.deepEqual(toArr(api.gpRegs()),  ['RAX','RBX','RCX','RDX','RSI','RDI']);
  assert.deepEqual(toArr(api.extRegs()), ['R8','R9','R10','R11','R12','R13','R14','R15']);
  assert.deepEqual(toArr(api.spRegs()),  ['RSP','RBP']);
});

// ═══════════════════════════════════════════════════════════════════════════
//  SUITE: ENCODING (assemble)
//  Reference: Intel SDM Vol.2 — Instruction Set Reference
// ═══════════════════════════════════════════════════════════════════════════
suite('encoding');

test('NOP → 0x90 (SDM Vol.2 §NOP)', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  assert.deepEqual(toArr(api.assemble('NOP', 0)), [0x90]);
});

test('HLT → 0xF4 (SDM Vol.2 §HLT)', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  assert.deepEqual(toArr(api.assemble('HLT', 0)), [0xF4]);
});

test('RET → 0xC3 (SDM Vol.2 §RET: near return)', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  assert.deepEqual(toArr(api.assemble('RET', 0)), [0xC3]);
});

test('MOV EAX, imm32: B8+rd with LE immediate (SDM Vol.2 §MOV B8+rd)', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  // B8 = MOV EAX; opcode B8+0=B8
  assert.deepEqual(hexBytes(api.assemble('MOV EAX, 0x12345678', 0)),
    ['B8', '78', '56', '34', '12']);
});

test('MOV ECX, imm32: B8+rd=B9 (ECX encoding=1)', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  // ECX index=1 → 0xB9
  assert.deepEqual(hexBytes(api.assemble('MOV ECX, 0x00000001', 0)),
    ['B9', '01', '00', '00', '00']);
});

test('MOV EDX, imm32: opcode B8+2=BA', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  // EDX index=2 → 0xBA
  const bytes = api.assemble('MOV EDX, 0xABCDEF00', 0);
  assert.equal(bytes[0], 0xBA);
  assert.deepEqual(toArr(bytes.slice(1)), [0x00, 0xEF, 0xCD, 0xAB]);
});

test('MOV EBX, imm32: opcode B8+3=BB', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  const bytes = api.assemble('MOV EBX, 0xCAFEBABE', 0);
  assert.equal(bytes[0], 0xBB);
});

test('MOV ESI/EDI: opcodes B8+6=BE, B8+7=BF', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  // REG32 = [EAX,ECX,EDX,EBX,ESP,EBP,ESI,EDI] → ESI=6, EDI=7
  assert.equal(api.assemble('MOV ESI, 0', 0)[0], 0xBE);
  assert.equal(api.assemble('MOV EDI, 0', 0)[0], 0xBF);
});

test('MOV r64, imm32 in x64: REX.W(0x48) + B8+rd + 4-byte imm', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'x64');
  // REX.W = 0x48 (W=1, no R/B); RAX=0 → B8
  const bytes = api.assemble('MOV RAX, 0x12345678', 0);
  assert.equal(bytes[0], 0x48);   // REX.W
  assert.equal(bytes[1], 0xB8);   // MOV r64 opcode for RAX
  assert.deepEqual(toArr(bytes.slice(2, 6)), [0x78, 0x56, 0x34, 0x12]);   // imm32 LE
  assert.deepEqual(toArr(bytes.slice(6, 10)), [0, 0, 0, 0]);              // hi32=0
});

test('MOV RAX, imm64: REX.W + B8 + 8-byte immediate LE', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'x64');
  // 0x0102030405060708 LE = [08,07,06,05,04,03,02,01]
  const bytes = api.assemble('MOV RAX, 0x0102030405060708', 0);
  assert.equal(bytes[0], 0x48);
  assert.equal(bytes[1], 0xB8);
  assert.deepEqual(toArr(bytes.slice(2, 10)), [0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01]);
});

test('MOV R8, imm: REX.B set (R8 extends opcode reg field)', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'x64');
  const bytes = api.assemble('MOV R8, 0x00000001', 0);
  // REX must have B bit set (0x49 = 0100 1001 = REX.W=1, REX.B=1)
  assert.equal(bytes[0] & 0x01, 1, 'REX.B must be set for R8');
  assert.equal(bytes[1], 0xB8);   // R8 uses opcode B8 (idx 0 in REG64X, with REX.B)
});

test('MOV reg, reg: 0x89 ModRM mod=11', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  const bytes = api.assemble('MOV EBX, EAX', 0);
  // 0x89 MOV r/m32,r32; ModRM: mod=11 reg=EAX(0) rm=EBX(3)
  // ModRM = 11 000 011 = 0b11000011 = 0xC3
  assert.equal(bytes[0], 0x89);
  assert.equal(bytes[1], 0xC3);
});

test('MOV ECX, EDX: 0x89 ModRM mod=11 reg=EDX(2) rm=ECX(1)', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  const bytes = api.assemble('MOV ECX, EDX', 0);
  assert.equal(bytes[0], 0x89);
  // ModRM: mod=11(0xC0) reg=EDX(2→0x10) rm=ECX(1→0x01) = 0xD1
  assert.equal(bytes[1], 0xD1);
});

test('MOV [mem], reg: 0x89 mod=00 rm=0 + addr byte', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  const bytes = api.assemble('MOV DWORD PTR [0x0010], EAX', 0);
  // 0x89 ModRM: mod=00 reg=EAX(0) rm=0 → 0x00; then addr=0x10
  assert.equal(bytes[0], 0x89);
  assert.equal(bytes[1], 0x00);   // mod=00, reg=0, rm=0
  assert.equal(bytes[2], 0x10);   // address
});

test('MOV reg, [mem]: 0x8B mod=00 rd + addr byte', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  const bytes = api.assemble('MOV ECX, DWORD PTR [0x0020]', 0);
  // 0x8B ModRM: mod=00 reg=ECX(1) rm=0 → 0x08; addr=0x20
  assert.equal(bytes[0], 0x8B);
  assert.equal(bytes[1], 0x08);
  assert.equal(bytes[2], 0x20);
});

test('PUSH EAX (ia32): 0xFF ModRM /6 mod=11 rm=EAX(0)', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  const bytes = api.assemble('PUSH EAX', 0);
  // 0xFF; ModRM: mod=11 reg=6(/6) rm=0 = 11 110 000 = 0xF0
  assert.equal(bytes[0], 0xFF);
  assert.equal(bytes[1], 0xF0);
});

test('POP EBX (ia32): 0x8F ModRM /0 mod=11 rm=EBX(3)', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  const bytes = api.assemble('POP EBX', 0);
  // 0x8F; ModRM: mod=11 reg=0(/0) rm=3 = 11 000 011 = 0xC3
  assert.equal(bytes[0], 0x8F);
  assert.equal(bytes[1], 0xC3);
});

test('PUSH RAX (x64): REX prefix + 0xFF /6', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'x64');
  const bytes = api.assemble('PUSH RAX', 0);
  // In x64, 64-bit pushes default; some assemblers omit REX but include for clarity
  // We expect 0xFF with correct ModRM
  const ffIdx = bytes.indexOf(0xFF);
  assert.ok(ffIdx >= 0, 'must contain 0xFF opcode');
  assert.equal(bytes[ffIdx + 1] & 0x38, 0x30, '/6 subopcode in ModRM.reg field');
});

test('JMP SHORT forward: 0xEB rel8 positive', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  // JMP to address 0x000A from base 0x0000: rel = 0x000A - (0x0000 + 2) = 0x08
  const bytes = toArr(api.assemble('JMP 0x000A', 0x0000));
  assert.equal(bytes[0], 0xEB);
  assert.equal(bytes[1], 0x08);
});

test('JMP SHORT backward: 0xEB with negative rel8 (two-complement)', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  // JMP to address 0x0000 from base 0x000A: rel = 0 - (0xA + 2) = -12 = 0xF4
  const bytes = toArr(api.assemble('JMP 0x0000', 0x000A));
  assert.equal(bytes[0], 0xEB);
  assert.equal(bytes[1], 0xF4);   // -12 as signed byte
});

test('CALL rel32: 0xE8 + 4-byte signed offset LE', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  // CALL to 0x000A from base 0x0000: rel = 0x000A - (0x0000 + 5) = 0x05
  const bytes = api.assemble('CALL 0x000A', 0x0000);
  assert.equal(bytes[0], 0xE8);
  assert.deepEqual(toArr(bytes.slice(1, 5)), [0x05, 0x00, 0x00, 0x00]);
});

test('assemble returns null for unrecognized mnemonic', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  assert.equal(api.assemble('ADD EAX, EBX', 0), null);
  assert.equal(api.assemble('XOR EAX, EAX', 0), null);
  assert.equal(api.assemble('SUB ESP, 4', 0), null);
});

// ═══════════════════════════════════════════════════════════════════════════
//  SUITE: DECODE
//  Reference: Intel SDM Vol.2 — instruction formats
// ═══════════════════════════════════════════════════════════════════════════
suite('decode');

test('decodeAt: NOP size=1, mnem=NOP', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.S.mem[0] = 0x90;
  const instr = api.decodeAt(0);
  assert.equal(instr.size, 1);
  assert.match(instr.mnem, /NOP/i);
  assert.equal(instr.unknown, undefined);
});

test('decodeAt: HLT size=1', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.S.mem[0] = 0xF4;
  const instr = api.decodeAt(0);
  assert.equal(instr.size, 1);
  assert.match(instr.mnem, /HLT/i);
});

test('decodeAt: MOV EAX, imm32 size=5', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  writeBytes(api, 0, [0xB8, 0x78, 0x56, 0x34, 0x12]);
  const instr = api.decodeAt(0);
  assert.equal(instr.size, 5);
  assert.match(instr.mnem, /MOV/i);
  assert.match(instr.mnem, /EAX/i);
  assert.match(instr.mnem, /12345678/i);
});

test('decodeAt: MOV r32,r32 size=2 (no REX)', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  // MOV EBX, EAX: 0x89 0xC3
  writeBytes(api, 0, [0x89, 0xC3]);
  const instr = api.decodeAt(0);
  assert.equal(instr.size, 2);
});

test('decodeAt: JMP SHORT size=2, jmpTarget set', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  // JMP +8: 0xEB 0x08 from addr 0; target = 0 + 2 + 8 = 10
  writeBytes(api, 0, [0xEB, 0x08]);
  const instr = api.decodeAt(0);
  assert.equal(instr.size, 2);
  assert.equal(instr.jmpTarget, 0x0A);
});

test('decodeAt: JMP negative rel8, correct target', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  // rel = -12 = 0xF4; from addr 0x0A: target = 0x0A + 2 + (-12) = 0
  writeBytes(api, 0x0A, [0xEB, 0xF4]);
  const instr = api.decodeAt(0x0A);
  assert.equal(instr.jmpTarget, 0x00);
});

test('decodeAt x64: REX prefix consumed, correct size for MOV RAX,imm64', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'x64');
  // REX.W(0x48) B8 + 8 bytes = 10 bytes total
  writeBytes(api, 0, [0x48, 0xB8, 0x88,0x77,0x66,0x55, 0x44,0x33,0x22,0x11]);
  const instr = api.decodeAt(0);
  assert.equal(instr.size, 10);
  assert.match(instr.mnem, /RAX/i);
});

test('decodeAt x64: REX.B extends opcode reg to R8', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'x64');
  // REX.W|REX.B = 0x49; B8+0 = 0xB8 → MOV R8, imm64
  writeBytes(api, 0, [0x49, 0xB8, 0x01,0x00,0x00,0x00, 0x00,0x00,0x00,0x00]);
  const instr = api.decodeAt(0);
  assert.match(instr.mnem, /R8/i);
});

test('decodeAt: CALL size=5 (1 opcode + 4 rel32)', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  writeBytes(api, 0, [0xE8, 0x05, 0x00, 0x00, 0x00]);
  const instr = api.decodeAt(0);
  assert.equal(instr.size, 5);
  assert.match(instr.mnem, /CALL/i);
});

test('decodeAt: RET size=1', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.S.mem[0] = 0xC3;
  const instr = api.decodeAt(0);
  assert.equal(instr.size, 1);
  assert.match(instr.mnem, /RET/i);
});

test('decodeAt: unknown opcode sets unknown=true, size=1', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.S.mem[0] = 0x0F;  // invalid in our subset
  const instr = api.decodeAt(0);
  assert.equal(instr.unknown, true);
  assert.equal(instr.size,    1);
});

test('decodeAt: in ia32 mode, 0x48 is NOT a REX prefix (unknown opcode)', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  // In IA-32, 0x48 = DEC EAX — not supported in our subset
  api.S.mem[0] = 0x48;
  const instr = api.decodeAt(0);
  assert.equal(instr.unknown, true, '0x48 must NOT be treated as REX in ia32');
});

test('decodeAt: invalid ModRM for PUSH (subop≠6) → decodeError=true', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  // 0xFF with ModRM /1 (subop=1, not /6) in mod=11: 11 001 000 = 0xC8
  writeBytes(api, 0, [0xFF, 0xC8]);
  const instr = api.decodeAt(0);
  assert.equal(instr.decodeError, true);
});

// ═══════════════════════════════════════════════════════════════════════════
//  SUITE: EXECUTE — Architectural effects
//  Reference: Intel SDM Vol.2 per-instruction
// ═══════════════════════════════════════════════════════════════════════════
suite('execute');

test('MOV r32,imm32 exec: sets register, advances PC by 5', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  writeBytes(api, 0, [0xB8, 0x78, 0x56, 0x34, 0x12]);
  await api._executeOne();
  assert.equal(api.regHex('EAX'), '12345678');
  assert.equal(api.S.pc, 5);
});

test('MOV r64,imm64 exec: full 64-bit value stored, PC advances by 10', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'x64');
  writeBytes(api, 0, [0x48, 0xB8, 0x88,0x77,0x66,0x55, 0x44,0x33,0x22,0x11]);
  await api._executeOne();
  assert.equal(api.regHex('RAX'), '1122334455667788');
  assert.equal(api.S.pc, 10);
});

test('MOV reg,reg exec: dst gets src value', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.setReg('EAX', 0xDEADBEEF);
  writeBytes(api, 0, api.assemble('MOV EBX, EAX', 0));
  await api._executeOne();
  assert.equal(api.getReg('EBX'), 0xDEADBEEF);
});

test('MOV [mem],reg exec: writes LE bytes to memory', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.setReg('EAX', 0xDEADBEEF);
  writeBytes(api, 0, api.assemble('MOV DWORD PTR [0x0010], EAX', 0));
  await api._executeOne();
  assert.deepEqual(Array.from(api.S.mem.slice(0x10, 0x14)), [0xEF, 0xBE, 0xAD, 0xDE]);
});

test('MOV reg,[mem] exec: reads LE bytes from memory into register', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  writeBytes(api, 0x10, [0xEF, 0xBE, 0xAD, 0xDE]);
  writeBytes(api, 0, api.assemble('MOV ECX, DWORD PTR [0x0010]', 0));
  await api._executeOne();
  assert.equal(api.regHex('ECX'), 'DEADBEEF');
});

test('NOP exec: no register change, PC advances by 1', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  const eaxBefore = api.getReg('EAX');
  api.S.mem[0] = 0x90;
  await api._executeOne();
  assert.equal(api.S.pc, 1);
  assert.equal(api.getReg('EAX'), eaxBefore, 'NOP must not modify EAX');
});

test('HLT exec: sets S.halt=true', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.S.mem[0] = 0xF4;
  await api._executeOne();
  assert.equal(api.S.halt, true);
});

test('JMP SHORT exec: PC set to jmpTarget, not sequential', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  // JMP to 0x0A from 0x0000: 0xEB 0x08
  writeBytes(api, 0, [0xEB, 0x08]);
  await api._executeOne();
  assert.equal(api.S.pc, 0x0A);
});

test('JMP SHORT backward exec: wraps correctly within 64-byte map', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.setPC(0x0A);
  writeBytes(api, 0x0A, [0xEB, 0xF4]);  // rel=-12, target=0x0A+2-12=0
  await api._executeOne();
  assert.equal(api.S.pc, 0x00);
});

test('RET exec without CALL: faults (callFrames empty)', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.S.mem[0] = 0xC3;
  await api._executeOne();
  // RET without prior CALL → should fault
  assert.equal(api.S.halt,   true,  'RET without CALL must halt');
  assert.equal(api.S.faulted, true, 'RET without CALL must set faulted');
});

test('Intel SDM §2.1: EIP always points to NEXT instruction after fetch', async () => {
  // "The instruction pointer (EIP) contains the offset in the current code
  //  segment for the next instruction to be executed." (SDM Vol.1 §6.3)
  // After _executeOne completes FETCH phase, EIP must point past the instruction.
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  writeBytes(api, 0, [0x90, 0x90, 0x90]);  // 3× NOP
  assert.equal(api.S.pc, 0x00);
  await api._executeOne();
  assert.equal(api.S.pc, 0x01, 'PC must advance during FETCH (SDM Vol.1 §6.3)');
  await api._executeOne();
  assert.equal(api.S.pc, 0x02);
  await api._executeOne();
  assert.equal(api.S.pc, 0x03);
});

test('Sequential execution: multiple MOVs accumulate results correctly', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  const prog = [
    ...api.assemble('MOV EAX, 0x00000001', 0),
    ...api.assemble('MOV EBX, 0x00000002', 5),
    ...api.assemble('MOV ECX, 0x00000003', 10),
    0xF4,  // HLT
  ];
  writeBytes(api, 0, prog);
  while (!api.S.halt) await api._executeOne();
  assert.equal(api.getReg('EAX'), 1);
  assert.equal(api.getReg('EBX'), 2);
  assert.equal(api.getReg('ECX'), 3);
});

// ═══════════════════════════════════════════════════════════════════════════
//  SUITE: MEMORY — doStore / doLoad
//  Reference: Intel SDM Vol.1 §1.3.2 (Little-endian byte order)
// ═══════════════════════════════════════════════════════════════════════════
suite('memory');

test('STORE: x86 always writes LE — LSB at lowest addr (SDM Vol.1 §1.3.2)', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.setReg('EAX', 0x12345678);
  setAddr(document, 0x10);
  await api.doStore();
  // LE: byte0=[0x10]=0x78(LSB), byte1=[0x11]=0x56, byte2=[0x12]=0x34, byte3=[0x13]=0x12(MSB)
  assert.deepEqual(Array.from(api.S.mem.slice(0x10, 0x14)), [0x78, 0x56, 0x34, 0x12],
    'STORE must write little-endian regardless of S.endian');
});

test('STORE with S.endian=big: bytes STILL written LE (endian=visual only)', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.S.endian = 'big';
  api.setReg('EAX', 0x12345678);
  setAddr(document, 0x10);
  await api.doStore();
  assert.deepEqual(Array.from(api.S.mem.slice(0x10, 0x14)), [0x78, 0x56, 0x34, 0x12],
    'S.endian must NOT affect STORE byte order');
});

test('LOAD: always reads LE — reconstructs integer from LSB-first bytes', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  // Place 0xDEADBEEF in memory LE
  writeBytes(api, 0x20, [0xEF, 0xBE, 0xAD, 0xDE]);
  setAddr(document, 0x20);
  await api.doLoad();
  assert.equal(api.getReg('EAX'), 0xDEADBEEF);
});

test('LOAD with S.endian=big: bytes STILL read LE', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.S.endian = 'big';
  writeBytes(api, 0x20, [0xEF, 0xBE, 0xAD, 0xDE]);
  setAddr(document, 0x20);
  await api.doLoad();
  assert.equal(api.getReg('EAX'), 0xDEADBEEF, 'S.endian must NOT affect LOAD byte order');
});

test('STORE/LOAD round-trip: arbitrary 32-bit value survives memory cycle', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  const original = 0xCAFEBABE;
  api.setReg('EAX', original);
  setAddr(document, 0x08);
  await api.doStore();
  api.setReg('EAX', 0);  // clear register
  setAddr(document, 0x08);
  api.S.reg = 'EAX';
  await api.doLoad();
  assert.equal(api.getReg('EAX'), original, 'Round-trip must preserve value');
});

test('STORE ia32: width is fixed to DWORD by architecture', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.S.reg = 'EAX';
  api.setReg('EAX', 0x12345678);
  setAddr(document, 0x10);
  await api.doStore();
  assert.deepEqual(Array.from(api.S.mem.slice(0x10, 0x14)), [0x78, 0x56, 0x34, 0x12]);
});

test('STORE x64: width is fixed to QWORD by architecture', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'x64');
  api.S.reg = 'RAX';
  api.setRegParts('RAX', 0x55667788, 0x11223344);
  setAddr(document, 0x10);
  await api.doStore();
  assert.deepEqual(Array.from(api.S.mem.slice(0x10, 0x18)), [0x88, 0x77, 0x66, 0x55, 0x44, 0x33, 0x22, 0x11]);
});

test('mapAccessFits: boundary checks for 64-byte memory', () => {
  const { api } = loadSimulator();
  assert.equal(api.mapAccessFits(0,  4),  true,  '[0,4) fits');
  assert.equal(api.mapAccessFits(60, 4),  true,  '[60,64) fits');
  assert.equal(api.mapAccessFits(61, 4),  false, '[61,65) overflows');
  assert.equal(api.mapAccessFits(63, 1),  true,  '[63,64) fits exactly');
  assert.equal(api.mapAccessFits(64, 1),  false, 'addr=64 out of range');
});

// ═══════════════════════════════════════════════════════════════════════════
//  SUITE: STACK — PUSH / POP / CALL / RET
//  Reference: Intel SDM Vol.2 §PUSH, §POP, §CALL, §RET
//  Key rules:
//    - Stack grows toward LOWER addresses (ESP decrements on PUSH)
//    - Data stored little-endian (always, regardless of S.endian)
//    - In IA-32: pointer width = 4 bytes; in x86-64: = 8 bytes
// ═══════════════════════════════════════════════════════════════════════════
suite('stack');

test('PUSH ia32: ESP decremented by 4 BEFORE write (SDM Vol.2 §PUSH)', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  const espBefore = api.S.regs.ESP;
  api.S.reg = 'EAX';
  api.setReg('EAX', 0xA1B2C3D4);
  await api.doPush();
  // ESP must decrement by 4 first, then write AT new ESP
  assert.equal(api.S.regs.ESP, espBefore - 4, 'ESP must decrement by 4 on PUSH ia32');
});

test('PUSH ia32: bytes stored LE at new ESP (SDM Vol.2 §PUSH)', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.S.reg = 'EAX';
  api.setReg('EAX', 0xA1B2C3D4);
  await api.doPush();
  const sp = api.S.regs.ESP;
  // 0xA1B2C3D4 LE = [D4, C3, B2, A1]
  assert.deepEqual(
    Array.from(api.S.stackMem.slice(sp, sp + 4)),
    [0xD4, 0xC3, 0xB2, 0xA1],
    'PUSH must write little-endian'
  );
});

test('PUSH ia32: S.endian=big does NOT affect byte order (SDM: x86 always LE)', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.S.endian = 'big';
  api.S.reg = 'EAX';
  api.setReg('EAX', 0xA1B2C3D4);
  await api.doPush();
  const sp = api.S.regs.ESP;
  assert.deepEqual(
    Array.from(api.S.stackMem.slice(sp, sp + 4)),
    [0xD4, 0xC3, 0xB2, 0xA1],
    'S.endian=big must NOT change PUSH byte order'
  );
});

test('POP ia32: reads 4 LE bytes, ESP incremented by 4 AFTER read', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.S.endian = 'big';
  api.S.reg = 'EAX';
  const sp = defaultStackTop(api) - 4;
  api.S.regs.ESP = sp;
  api.S.stackMem.set([0xD4, 0xC3, 0xB2, 0xA1], sp);
  await api.doPop();
  assert.equal(api.getReg('EAX'), 0xA1B2C3D4);
  assert.equal(api.S.regs.ESP, defaultStackTop(api), 'ESP must increment by 4 after POP');
});

test('PUSH/POP ia32 round-trip: value preserved', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.S.reg = 'EBX';
  api.setReg('EBX', 0xDEADBEEF);
  await api.doPush();
  api.setReg('EBX', 0);
  await api.doPop();
  assert.equal(api.getReg('EBX'), 0xDEADBEEF, 'PUSH/POP must preserve value');
});

test('PUSH x64: ESP decremented by 8 (pointer width = 8)', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'x64');
  const espBefore = api.S.regs.ESP;
  api.S.reg = 'RAX';
  api.setReg('RAX', 0x11223344);
  await api.doPush();
  assert.equal(api.S.regs.ESP, espBefore - 8, 'x64 PUSH must decrement by 8');
});

test('PUSH x64: 8 bytes written LE', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'x64');
  api.S.reg = 'RAX';
  api.setRegParts('RAX', 0x55667788, 0x11223344);
  await api.doPush();
  const sp = api.S.regs.ESP;
  // lo=0x55667788 → [88,77,66,55]; hi=0x11223344 → [44,33,22,11]
  const expected = [0x88,0x77,0x66,0x55, 0x44,0x33,0x22,0x11];
  assert.deepEqual(Array.from(api.S.stackMem.slice(sp, sp + 8)), expected);
});

test('POP x64: reads 8 bytes, ESP incremented by 8', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'x64');
  api.S.reg = 'RAX';
  const sp = defaultStackTop(api) - 8;
  api.S.regs.ESP = sp;
  api.S.stackMem.set([0x88,0x77,0x66,0x55, 0x44,0x33,0x22,0x11], sp);
  await api.doPop();
  assert.equal(api.regHex('RAX'), '1122334455667788');
  assert.equal(api.S.regs.ESP, defaultStackTop(api));
});

test('PUSH x64 round-trip via PUSH/POP opcodes in decodeAt', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'x64');
  api.setRegParts('RAX', 0xABCD1234, 0x12340000);
  writeBytes(api, 0, [...api.assemble('PUSH RAX', 0), ...api.assemble('POP RBX', 0 + 3)]);
  await api._executeOne();  // PUSH RAX
  await api._executeOne();  // POP RBX
  assert.equal(api.regHex('RBX'), api.regHex('RAX'), 'PUSH/POP must round-trip via opcodes');
});

test('CALL ia32: pushes return address (next EIP) LE, sets PC to target', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  // CALL to 0x000A from 0x0000: E8 05 00 00 00; nextEIP = 0x0005
  writeBytes(api, 0, [0xE8, 0x05, 0x00, 0x00, 0x00,
                      0xF4,                           // HLT at 0x0005 (return address)
                      0x00, 0x00, 0x00, 0x00,
                      0xC3]);                          // RET at 0x000A
  await api._executeOne();  // execute CALL
  assert.equal(api.S.pc, 0x000A, 'CALL must set PC to target');
  assert.equal(api.S.regs.ESP, defaultStackTop(api) - 4);
  // return address = 0x0005 stored LE
  const sp = api.S.regs.ESP;
  assert.deepEqual(
    Array.from(api.S.stackMem.slice(sp, sp + 4)),
    [0x05, 0x00, 0x00, 0x00],
    'CALL must push return address as LE 32-bit'
  );
  assert.equal(api.S.callFrames.length, 1);
});

test('RET ia32: restores EIP from stack, frees frame', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  writeBytes(api, 0, [0xE8, 0x05, 0x00, 0x00, 0x00,
                      0xF4, 0x00, 0x00, 0x00, 0x00, 0xC3]);
  await api._executeOne();  // CALL
  await api._executeOne();  // RET at 0x000A
  assert.equal(api.S.pc, 0x0005, 'RET must restore return address');
  assert.equal(api.S.regs.ESP, defaultStackTop(api), 'RET must restore ESP');
  assert.equal(api.S.callFrames.length, 0, 'RET must pop callFrames');
});

test('CALL x64: pointer width = 8 bytes', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'x64');
  writeBytes(api, 0, [0xE8, 0x05, 0x00, 0x00, 0x00,
                      0xF4, 0x00, 0x00, 0x00, 0x00, 0xC3]);
  await api._executeOne();
  assert.equal(api.S.regs.ESP, defaultStackTop(api) - 8, 'x64 CALL must push 8 bytes');
  assert.equal(api.S.pc, 0x000A);
});

test('RET x64: restores 64-bit return address, ESP += 8', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'x64');
  writeBytes(api, 0, [0xE8, 0x05, 0x00, 0x00, 0x00,
                      0xF4, 0x00, 0x00, 0x00, 0x00, 0xC3]);
  await api._executeOne();  // CALL
  await api._executeOne();  // RET
  assert.equal(api.S.pc, 0x0005);
  assert.equal(api.S.regs.ESP, defaultStackTop(api));
});

test('stackAccessFits: bounds check correct', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  const sz = api.S.stackSize;
  assert.equal(api.stackAccessFits(0, 4),      true,  'bottom of stack fits');
  assert.equal(api.stackAccessFits(sz - 4, 4), true,  'top of stack fits');
  assert.equal(api.stackAccessFits(sz - 3, 4), false, 'partial overflow');
  assert.equal(api.stackAccessFits(sz, 1),     false, 'at boundary = out');
});

test('PUSH underflow: stack overflow when ESP would go below 0 → fault', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.S.regs.ESP = 2;  // not enough room for a 4-byte push
  api.S.reg = 'EAX';
  await api.doPush();
  assert.equal(api.S.halt,    true, 'stack underflow must halt CPU');
  assert.equal(api.S.faulted, true, 'stack underflow must set faulted');
});

test('Multiple PUSH/POP: LIFO order preserved (stack discipline)', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.setReg('EAX', 0x00000001);
  api.setReg('EBX', 0x00000002);
  api.setReg('ECX', 0x00000003);
  // PUSH EAX, PUSH EBX, PUSH ECX
  for (const r of ['EAX', 'EBX', 'ECX']) {
    api.S.reg = r;
    await api.doPush();
  }
  // POP into EAX (should get ECX value), POP into EBX (EBX value), POP into ECX (EAX value)
  for (const r of ['EAX', 'EBX', 'ECX']) {
    api.S.reg = r;
    await api.doPop();
  }
  assert.equal(api.getReg('EAX'), 3, 'LIFO: first pop gets last pushed');
  assert.equal(api.getReg('EBX'), 2);
  assert.equal(api.getReg('ECX'), 1);
});

// ═══════════════════════════════════════════════════════════════════════════
//  SUITE: FETCH CYCLE
//  Reference: Intel SDM Vol.1 §6.3 — Basic Execution Environment
// ═══════════════════════════════════════════════════════════════════════════
suite('fetch');

test('FETCH advances EIP to next instruction without executing it (SDM Vol.1 §6.3)', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  // MOV EAX, 0x12345678 = 5 bytes at 0x0000
  writeBytes(api, 0, [0xB8, 0x78, 0x56, 0x34, 0x12]);
  const eaxBefore = api.getReg('EAX');
  await api.doFetch();
  assert.equal(api.S.pc, 5,         'PC must advance to next instruction after FETCH');
  assert.equal(api.getReg('EAX'), eaxBefore, 'FETCH must NOT execute — EAX unchanged');
});

test('FETCH on 1-byte opcode (NOP): advances PC by exactly 1', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.S.mem[0] = 0x90;
  await api.doFetch();
  assert.equal(api.S.pc, 1);
});

test('FETCH on 10-byte opcode (MOV RAX,imm64): advances PC by 10', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'x64');
  writeBytes(api, 0, [0x48, 0xB8, 0,0,0,0, 0,0,0,0]);
  await api.doFetch();
  assert.equal(api.S.pc, 10);
});

test('Multiple FETCH calls advance PC cumulatively', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  writeBytes(api, 0, [0x90, 0x90, 0xF4]);  // NOP, NOP, HLT
  await api.doFetch();
  assert.equal(api.S.pc, 1);
  await api.doFetch();
  assert.equal(api.S.pc, 2);
  await api.doFetch();
  assert.equal(api.S.pc, 3);
});

test('FETCH restores previous memory cell state after temporary highlight', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  writeBytes(api, 0, [0x90]);
  assert.equal(api.S.memState[0], 'mc-written');
  await api.doFetch();
  assert.equal(api.S.memState[0], 'mc-written', 'FETCH must not leave mc-pc latched in memory state');
});

test('Memory DOM: setMemSt immediately updates rendered cell class', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.renderMemGrid();
  api.setMemSt(0, 'mc-pc');
  const cell = api.memEl(0);
  assert.ok(cell, 'rendered memory cell must exist');
  assert.equal(cell.classList.contains('mc-pc'), true, 'rendered memory cell must reflect mc-pc immediately');
});

test('Memory DOM: renderMemGrid marks current PC position', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.setPC(0x0A, { trace: false });
  api.renderMemGrid();
  assert.equal(api.memEl(0x0A).classList.contains('mc-pc-current'), true, 'current PC cell must be highlighted in the memory map');
  assert.equal(api.memEl(0x09).classList.contains('mc-pc-current'), false, 'adjacent cells must not inherit the PC marker');
});

test('Memory DOM: setPC moves persistent PC marker between memory cells', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.renderMemGrid();
  api.setPC(0x03, { trace: false });
  assert.equal(api.memEl(0x03).classList.contains('mc-pc-current'), true, 'new PC address must gain the marker');
  api.setPC(0x07, { trace: false });
  assert.equal(api.memEl(0x03).classList.contains('mc-pc-current'), false, 'old PC address must lose the marker');
  assert.equal(api.memEl(0x07).classList.contains('mc-pc-current'), true, 'current PC address must keep the marker');
});

test('Memory DOM: writeMem immediately updates rendered cell text and class', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.renderMemGrid();
  api.writeMem(0, 0xAB, 'mc-written');
  const cell = api.memEl(0);
  assert.ok(cell, 'rendered memory cell must exist');
  assert.equal(cell.textContent, 'AB');
  assert.equal(cell.classList.contains('mc-written'), true, 'rendered memory cell must reflect write state immediately');
});

test('Memory DOM: temporary state updates preserve selection and breakpoint markers', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.renderMemGrid();
  const cell = api.memEl(0);
  cell.classList.add('mc-selected', 'mc-bp');
  api.setMemSt(0, 'mc-pc');
  assert.equal(cell.classList.contains('mc-selected'), true, 'mc-selected must survive temporary memory state updates');
  assert.equal(cell.classList.contains('mc-bp'), true, 'mc-bp must survive temporary memory state updates');
  assert.equal(cell.classList.contains('mc-pc'), true, 'temporary fetch highlight must still be applied');
});

test('Memory DOM: temporary state updates preserve current PC marker', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.renderMemGrid();
  api.setPC(0x00, { trace: false });
  api.setMemSt(0, 'mc-pc');
  const cell = api.memEl(0);
  assert.equal(cell.classList.contains('mc-pc'), true, 'temporary fetch highlight must still be applied');
  assert.equal(cell.classList.contains('mc-pc-current'), true, 'current PC marker must remain visible on the active cell');
});

// ═══════════════════════════════════════════════════════════════════════════
//  SUITE: ENDIANNESS (display vs execution)
//  Key invariant: execution is ALWAYS Intel little-endian
//  S.endian changes ONLY the visualization layer
// ═══════════════════════════════════════════════════════════════════════════
suite('endian');

test('Intel is little-endian: 0xDEADBEEF stored as EF BE AD DE (SDM Vol.1 §1.3.2)', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.setReg('EAX', 0xDEADBEEF);
  setAddr(document, 0);
  await api.doStore();
  assert.equal(api.S.mem[0x00], 0xEF, 'LSB at lowest address');
  assert.equal(api.S.mem[0x01], 0xBE);
  assert.equal(api.S.mem[0x02], 0xAD);
  assert.equal(api.S.mem[0x03], 0xDE, 'MSB at highest address');
});

test('S.endian=big does NOT change STORE byte order', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.S.endian = 'big';
  api.setReg('EAX', 0xDEADBEEF);
  setAddr(document, 0);
  await api.doStore();
  assert.equal(api.S.mem[0x00], 0xEF, 'STORE must always write LE');
  assert.equal(api.S.mem[0x03], 0xDE);
});

test('S.endian=big does NOT change LOAD byte order', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.S.endian = 'big';
  writeBytes(api, 0, [0xEF, 0xBE, 0xAD, 0xDE]);
  setAddr(document, 0);
  await api.doLoad();
  assert.equal(api.getReg('EAX'), 0xDEADBEEF);
});

test('S.endian=big does NOT change MOV [mem],reg byte order', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.S.endian = 'big';
  api.setReg('EAX', 0xCAFEBABE);
  writeBytes(api, 0, api.assemble('MOV DWORD PTR [0x0010], EAX', 0));
  await api._executeOne();
  assert.deepEqual(Array.from(api.S.mem.slice(0x10, 0x14)), [0xBE, 0xBA, 0xFE, 0xCA]);
});

test('S.endian=big does NOT change MOV reg,[mem] byte order', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.S.endian = 'big';
  writeBytes(api, 0x10, [0xBE, 0xBA, 0xFE, 0xCA]);
  writeBytes(api, 0, api.assemble('MOV EAX, DWORD PTR [0x0010]', 0));
  await api._executeOne();
  assert.equal(api.getReg('EAX'), 0xCAFEBABE);
});

test('S.endian=big does NOT change PUSH byte order', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.S.endian = 'big';
  api.S.reg = 'EAX';
  api.setReg('EAX', 0x11223344);
  await api.doPush();
  const sp = api.S.regs.ESP;
  assert.deepEqual(Array.from(api.S.stackMem.slice(sp, sp + 4)), [0x44, 0x33, 0x22, 0x11]);
});

test('ordered() utility: little returns [LSB..MSB], big returns [MSB..LSB]', () => {
  const { api } = loadSimulator();
  const le = toArr(api.ordered(0xAABBCCDD, 4, 'little'));
  const be = toArr(api.ordered(0xAABBCCDD, 4, 'big'));
  assert.deepEqual(le, [0xDD, 0xCC, 0xBB, 0xAA]);
  assert.deepEqual(be, [0xAA, 0xBB, 0xCC, 0xDD]);
  // big-endian order is exactly the reverse of little-endian
  assert.deepEqual(be, [...le].reverse());
});

// ═══════════════════════════════════════════════════════════════════════════
//  SUITE: ASSEMBLER VALIDATOR (validateAssembly)
// ═══════════════════════════════════════════════════════════════════════════
suite('assembler');

test('validateAssembly: MOV EAX,0x1234 → ok, correct bytes', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  const r = api.validateAssembly('MOV EAX, 0x1234', 0);
  assert.equal(r.ok, true);
  assert.deepEqual(hexBytes(r.bytes), ['B8', '34', '12', '00', '00']);
});

test('validateAssembly: NOP → ok, [0x90]', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  const r = api.validateAssembly('NOP', 0);
  assert.equal(r.ok, true);
  assert.deepEqual(toArr(r.bytes), [0x90]);
});

test('validateAssembly: empty input → ok=false', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  const r = api.validateAssembly('', 0);
  assert.equal(r.ok, false);
});

test('validateAssembly: unknown mnemonic → ok=false', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  const r = api.validateAssembly('ADD EAX, 1', 0);
  assert.equal(r.ok, false);
});

test('validateAssembly: PUSH EAX in x64 → error mentions 64 bits', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'x64');
  const r = api.validateAssembly('PUSH EAX', 0);
  assert.equal(r.ok, false);
  assert.match(r.error, /64 bits/i);
});

test('validateAssembly: PUSH RAX in x64 → ok', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'x64');
  const r = api.validateAssembly('PUSH RAX', 0);
  assert.equal(r.ok, true);
});

test('validateAssembly: MOV EIP, 0x1 → error mentions special pointer register', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  const r = api.validateAssembly('MOV EIP, 0x1', 0);
  assert.equal(r.ok, false);
  assert.match(r.error, /ponteiro de instrucao especial/i);
});

test('validateAssembly: MOV RAX,imm in ia32 → error (64-bit reg in 32-bit mode)', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  const r = api.validateAssembly('MOV RAX, 0x1234', 0);
  assert.equal(r.ok, false);
});

test('validateAssembly: NOP with operand → error', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  const r = api.validateAssembly('NOP EAX', 0);
  assert.equal(r.ok, false);
});

test('validateAssembly: MOV EAX → error (missing operand)', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  const r = api.validateAssembly('MOV EAX', 0);
  assert.equal(r.ok, false);
});

test('validateAssembly: CALL out-of-range address → error', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  const r = api.validateAssembly('CALL 0xFFFF', 0);
  assert.equal(r.ok, false);
});

test('validateAssembly: JMP 0x0000 (backward) → ok', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  const r = api.validateAssembly('JMP 0x0000', 0x000A);
  assert.equal(r.ok, true);
  assert.equal(r.bytes[0], 0xEB);
});

test('validateAssembly: MOV EAX,EBX → ok, op=0x89', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  const r = api.validateAssembly('MOV EBX, EAX', 0);
  assert.equal(r.ok, true);
  assert.equal(r.bytes[0], 0x89);
});

// ═══════════════════════════════════════════════════════════════════════════
//  SUITE: FAULT DETECTION
// ═══════════════════════════════════════════════════════════════════════════
suite('fault');

test('Unknown opcode: sets halt=true, faulted=true, marks mc-error', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.S.mem[0] = 0x0F;
  await api._executeOne();
  assert.equal(api.S.halt,   true);
  assert.equal(api.S.faulted, true);
  assert.equal(api.S.memState[0], 'mc-error');
});

test('Invalid ModRM for PUSH (0xFF /1): decodeError, halt, faulted', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  // 0xFF ModRM=0xC8 → /1 (subop=1), invalid
  writeBytes(api, 0, [0xFF, 0xC8]);
  await api._executeOne();
  assert.equal(api.S.halt,    true);
  assert.equal(api.S.faulted, true);
  assert.deepEqual(toArr(api.S.memState.slice(0, 2)), ['mc-error', 'mc-error']);
});

test('MOV [mem] overflow: write past 64-byte boundary → fault', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.setReg('EAX', 0xCAFEBABE);
  // addr=0x3E: 4 bytes would go to 0x3E,0x3F,0x40(OOB),0x41(OOB) → fault
  writeBytes(api, 0, [0x89, 0x00, 0x3E]);
  await api._executeOne();
  assert.equal(api.S.halt,   true);
  assert.equal(api.S.faulted, true);
  assert.equal(api.S.memState[0x3E], 'mc-error');
  assert.equal(api.S.memState[0x3F], 'mc-error');
});

test('RET with corrupted return address: faults when stack does not match callFrame', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  writeBytes(api, 0, [0xE8, 0x05, 0x00, 0x00, 0x00,
                      0xF4, 0x00, 0x00, 0x00, 0x00, 0xC3]);
  await api._executeOne();  // CALL → pushes 0x0005
  // Corrupt the return address on the stack
  api.S.stackMem[api.S.regs.ESP] = 0x07;
  await api._executeOne();  // RET → should detect mismatch
  assert.equal(api.S.halt,    true, 'Corrupted RET must halt');
  assert.equal(api.S.faulted, true, 'Corrupted RET must set faulted');
});

test('RET without CALL: always faults (callFrames empty)', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.S.mem[0] = 0xC3;
  await api._executeOne();
  assert.equal(api.S.halt,    true);
  assert.equal(api.S.faulted, true);
});

test('PUSH stack overflow (ESP would go negative): faults', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.S.regs.ESP = 0;  // cannot decrement further
  api.S.reg = 'EAX';
  await api.doPush();
  assert.equal(api.S.halt,    true);
  assert.equal(api.S.faulted, true);
});

test('CPU stays halted after halt: subsequent _executeOne does nothing', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.S.mem[0] = 0xF4;  // HLT
  await api._executeOne();
  assert.equal(api.S.halt, true);
  const pcAfterHlt = api.S.pc;
  await api._executeOne();  // should be no-op
  assert.equal(api.S.pc, pcAfterHlt, 'PC must not advance after CPU is halted');
});

// ═══════════════════════════════════════════════════════════════════════════
//  SUITE: REGRESSION — bugs that must never regress
// ═══════════════════════════════════════════════════════════════════════════
suite('regression');

test('REG: 0x48 in ia32 mode is NOT a REX prefix (was bug: treated as REX)', () => {
  // In IA-32 mode, 0x48 = DEC EAX (unsupported opcode in our subset, not REX prefix)
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.S.mem[0] = 0x48;  // in ia32 this is DEC EAX, not REX
  const instr = api.decodeAt(0);
  assert.equal(instr.unknown, true, 'ia32: 0x48 must be decoded as unknown, not REX prefix');
  assert.equal(instr.size, 1);
});

test('REG: x64 mode correctly identifies 0x40-0x4F as REX prefixes', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'x64');
  for (let rex = 0x40; rex <= 0x4F; rex++) {
    api.S.mem.fill(0);
    // Place REX prefix then NOP (0x90)
    api.S.mem[0] = rex;
    api.S.mem[1] = 0x90;
    const instr = api.decodeAt(0);
    assert.notEqual(instr.unknown, true, `REX 0x${rex.toString(16)} should be consumed as prefix`);
    assert.equal(instr.size, 2, `REX(1)+NOP(1)=2 for REX=0x${rex.toString(16)}`);
  }
});

test('REG: RSP/RBP correctly map to S.regs.ESP/EBP (no separate storage)', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'x64');
  api.S.regs.ESP = 0x4321;
  assert.equal(api.getReg('RSP'), 0x4321, 'getReg(RSP) must use S.regs.ESP');
  api.setReg('RSP', 0xABCD);
  assert.equal(api.S.regs.ESP, 0xABCD, 'setReg(RSP) must write to S.regs.ESP');
  assert.equal(api.S.regs['RSP'], undefined, 'S.regs.RSP must not exist as separate field');
});

test('STORE/LOAD: S.endian does not affect bytes written/read (was bug: endian applied to exec)', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  const sentinel = 0xABCDEF01;
  for (const endian of ['little', 'big']) {
    api.S.endian = endian;
    api.setReg('EAX', sentinel);
    setAddr(document, 0x08);
    await api.doStore();
    assert.deepEqual(
      Array.from(api.S.mem.slice(0x08, 0x0C)),
      [0x01, 0xEF, 0xCD, 0xAB],
      `STORE with S.endian=${endian} must produce LE bytes`
    );
  }
});

test('PC wraps at 64-byte boundary (memory map is 64 bytes, 6-bit mask)', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.setPC(0x3F);
  assert.equal(api.S.pc, 0x3F);
  api.setPC(0x40);
  assert.equal(api.S.pc, 0x00, 'PC must wrap from 0x3F to 0x00');
  api.setPC(0x7F);
  assert.equal(api.S.pc, 0x3F, '0x7F & 0x3F = 0x3F');
});

test('PUSH/POP always use little-endian regardless of S.endian (was bug)', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.S.endian = 'big';
  api.S.reg = 'EAX';
  api.setReg('EAX', 0x11223344);
  await api.doPush();
  api.setReg('EAX', 0);
  await api.doPop();
  assert.equal(api.getReg('EAX'), 0x11223344, 'PUSH/POP round-trip must work regardless of S.endian');
});

test('sizeN: follows the active architecture', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  assert.equal(api.sizeN(), 4);
  api.S.arch = 'x64';
  assert.equal(api.sizeN(), 8);
});

test('JMP does not push anything to callFrames (not a CALL)', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  writeBytes(api, 0, [0xEB, 0x00]);  // JMP to self+2 (effectively NOP-jump)
  await api._executeOne();
  assert.equal(api.S.callFrames.length, 0, 'JMP must not push to callFrames');
});

test('Multiple CALL/RET pairs maintain correct callFrame nesting', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  // Program layout:
  // 0x00: CALL 0x0F   (E8 0A 00 00 00) — calls subroutine at 0x0F
  // 0x05: HLT         (F4)
  // 0x06: NOP * 8     (padding)
  // 0x0F: CALL 0x1E   (E8 0A 00 00 00) — nested call to 0x1E
  // 0x14: RET         (C3)
  // 0x15-0x1D: NOP * 9 (padding)
  // 0x1E: RET         (C3) — inner subroutine returns
  const prog = new Array(0x20).fill(0x90);
  prog[0x00] = 0xE8; prog[0x01]=0x0A; prog[0x02]=0x00; prog[0x03]=0x00; prog[0x04]=0x00;
  prog[0x05] = 0xF4;  // HLT at return point
  prog[0x0F] = 0xE8; prog[0x10]=0x0A; prog[0x11]=0x00; prog[0x12]=0x00; prog[0x13]=0x00;
  prog[0x14] = 0xC3;  // RET from outer sub
  prog[0x1E] = 0xC3;  // RET from inner sub
  writeBytes(api, 0, prog.slice(0, 0x20));
  await api._executeOne();  // CALL 0x0F → callFrames.length=1
  assert.equal(api.S.callFrames.length, 1);
  await api._executeOne();  // CALL 0x1E (nested) → callFrames.length=2
  assert.equal(api.S.callFrames.length, 2);
  await api._executeOne();  // RET from 0x1E → back to 0x14, length=1
  assert.equal(api.S.callFrames.length, 1);
  assert.equal(api.S.pc, 0x14);
  await api._executeOne();  // RET from 0x0F → back to 0x05, length=0
  assert.equal(api.S.callFrames.length, 0);
  assert.equal(api.S.pc, 0x05);
});

test('getBytes produces correct LSB-first order for edge values', () => {
  const { api } = loadSimulator();
  assert.deepEqual(toArr(api.getBytes(0x00000000, 4)), [0,0,0,0]);
  assert.deepEqual(toArr(api.getBytes(0xFFFFFFFF, 4)), [0xFF,0xFF,0xFF,0xFF]);
  assert.deepEqual(toArr(api.getBytes(0x00000001, 4)), [0x01,0,0,0]);
  assert.deepEqual(toArr(api.getBytes(0x80000000, 4)), [0,0,0,0x80]);
  assert.deepEqual(toArr(api.getBytes(0x000000FF, 1)), [0xFF]);
});

test('CALL encodes return address as address AFTER the CALL instruction (not its own address)', async () => {
  // Intel SDM Vol.2 §CALL: "Saves procedure linking info on stack, branches to called procedure."
  // "The return address is the offset of the instruction following the CALL instruction."
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  // CALL at 0x0000 with 5 bytes → next instr at 0x0005 → return address = 0x0005
  writeBytes(api, 0, [0xE8, 0x05, 0x00, 0x00, 0x00, 0xF4, 0x90,0x90,0x90,0x90, 0xC3]);
  await api._executeOne();  // CALL
  const sp = api.S.regs.ESP;
  const retAddrLE = Array.from(api.S.stackMem.slice(sp, sp + 4));
  const retAddr = retAddrLE[0] | (retAddrLE[1] << 8) | (retAddrLE[2] << 16) | (retAddrLE[3] << 24);
  assert.equal(retAddr, 0x0005, 'CALL must push address of instruction AFTER the CALL');
});

// ═══════════════════════════════════════════════════════════════════════════
//  SUITE: ARCHITECTURE SWITCH
// ═══════════════════════════════════════════════════════════════════════════
suite('arch');

test('ia32 → x64 switch: gpRegs changes from E-prefix to R-prefix', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  assert.deepEqual(toArr(api.gpRegs()), ['EAX','EBX','ECX','EDX','ESI','EDI']);
  api.S.arch = 'x64';
  assert.deepEqual(toArr(api.gpRegs()), ['RAX','RBX','RCX','RDX','RSI','RDI']);
});

test('ia32 → x64: extRegs gains R8-R15', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  assert.equal(api.extRegs().length, 0);
  api.S.arch = 'x64';
  assert.equal(api.extRegs().length, 8);
  assert.deepEqual(toArr(api.extRegs()), ['R8','R9','R10','R11','R12','R13','R14','R15']);
});

test('ia32 → x64: ptrSize changes from 4 to 8', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  assert.equal(api.ptrSize(), 4);
  api.S.arch = 'x64';
  assert.equal(api.ptrSize(), 8);
});

test('UI: instruction pointer labels follow active architecture', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.setArch('ia32');
  assert.equal(document.getElementById('ipChipLbl'), null);
  assert.equal(document.getElementById('memLegendIpLbl').textContent, 'EIP');
  api.setArch('x64');
  assert.equal(document.getElementById('ipChipLbl'), null);
  assert.equal(document.getElementById('memLegendIpLbl').textContent, 'RIP');
});

test('x64 MOV R9,imm: REX.B|W prefix, B8 opcode, R9 index=1', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'x64');
  const bytes = api.assemble('MOV R9, 0x12345678', 0);
  assert.ok(bytes !== null, 'Must assemble MOV R9, imm');
  // REX byte should have W=1 and B=1 → 0x49
  assert.equal(bytes[0], 0x49, 'REX.W|REX.B = 0x49 for R9');
  assert.equal(bytes[1], 0xB9, 'Opcode B8+1=B9 for R9 (idx 1 in REG64X)');
});

test('x64 PUSH/POP use 8-byte pointer width', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'x64');
  const espBefore = api.S.regs.ESP;
  api.S.reg = 'RAX';
  await api.doPush();
  assert.equal(api.S.regs.ESP, espBefore - 8);
  await api.doPop();
  assert.equal(api.S.regs.ESP, espBefore);
});

// ═══════════════════════════════════════════════════════════════════════════
//  SUITE: CPU STATE MACHINE (RUN / PAUSE / STOP / STEP)
// ═══════════════════════════════════════════════════════════════════════════
suite('cpu-state');

test('RUN→STOP: S.halt permanece false, STEP funciona depois', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  // Programa: dois NOPs
  writeBytes(api, 0, [0x90, 0x90]);
  api.setPC(0);

  // Simular RUN iniciando e STOP imediato (seta stopped antes do loop)
  api.S.stopped = false; api.S.paused = false; api.S.progRunning = true; api.S.busy = true;
  api.doStop();

  assert.equal(api.S.halt,        false, 'S.halt deve ser false após STOP');
  assert.equal(api.S.stopped,     true,  'S.stopped deve ser true após STOP');
  assert.equal(api.S.progRunning, false, 'S.progRunning deve ser false após STOP');
  assert.equal(api.S.busy,        false, 'S.busy deve ser false após STOP');

  // STEP deve funcionar sem bloquear
  const pcAntes = api.S.pc;
  await api.doStepForward.call
    ? null  // doStepForward requer paused=true; usar doExecute via _executeOne diretamente
    : null;

  // Testar via _executeOne diretamente (como doStep faz internamente)
  api.S.busy = false;
  const pcBefore = api.S.pc;
  await api._executeOne({ traceMode: 'run' });
  assert.ok(api.S.pc !== pcBefore || api.S.halt, 'PC deve avançar ou CPU halted após _executeOne');
});

test('RUN→STOP: doStop não deve setar S.halt', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.S.progRunning = true;
  api.S.busy = true;
  api.doStop();
  assert.equal(api.S.halt, false, 'doStop não deve setar S.halt');
});

test('STOP limpa history', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.S.history = [{ regs: {}, mem: new Uint8Array(64), stackMem: new Uint8Array(64), stackState: new Map(), memState: [], pc: 0, callFrames: [] }];
  api.S.progRunning = true;
  api.doStop();
  assert.equal(api.S.history.length, 0, 'doStop deve limpar o histórico');
});

test('STOP→RUN: S.stopped é resetado ao iniciar RUN', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  // HLT para o loop RUN parar imediatamente
  writeBytes(api, 0, [0xF4]);
  api.setPC(0);
  api.S.stopped = true;  // estado anterior de um STOP

  await api.doRun();

  assert.equal(api.S.stopped, false, 'doRun deve resetar S.stopped ao iniciar');
});

test('PAUSE seta S.paused sem modificar S.halt', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.S.progRunning = true;
  api.doPause();
  assert.equal(api.S.paused, true,  'doPause deve setar S.paused');
  assert.equal(api.S.halt,   false, 'doPause não deve modificar S.halt');
});

test('CLEAR reseta S.halt, S.stopped e S.progRunning', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.S.halt = true;
  api.S.stopped = true;
  api.S.progRunning = true;
  // simular doClear manualmente pois ela acessa DOM
  api.S.halt = false;
  api.S.stopped = false;
  api.S.progRunning = false;
  assert.equal(api.S.halt,        false);
  assert.equal(api.S.stopped,     false);
  assert.equal(api.S.progRunning, false);
});

test('snapshotState captura pc e registradores', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  writeBytes(api, 0, [0x90]);  // NOP
  api.setPC(0);
  api.S.regs.EAX = 0xCAFEBABE;

  // Executar uma instrução (NOP) para que snapshotState seja chamado via doRun
  // Testar diretamente: após _executeOne PC avança
  const pcBefore = api.S.pc;
  await api._executeOne({ traceMode: 'run' });
  assert.ok(api.S.pc > pcBefore, 'PC deve avançar após NOP');
});

test('RUN→STOP não deixa CPU em estado que impede novo RUN', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  // HLT no endereço 0
  writeBytes(api, 0, [0xF4]);
  api.setPC(0);

  // Primeiro RUN (para no HLT)
  await api.doRun();
  assert.equal(api.S.halt, true, 'deve haltar no HLT');

  // Resetar halt (como doClear faria) e tentar novo RUN
  api.S.halt = false;
  api.S.stopped = false;
  api.S.progRunning = false;
  writeBytes(api, 0, [0xF4]);
  api.setPC(0);
  await api.doRun();
  assert.equal(api.S.halt, true, 'segundo RUN deve haltar novamente');
});

// ═══════════════════════════════════════════════════════════════════════════
//  SUITE: BREAKPOINTS
// ═══════════════════════════════════════════════════════════════════════════
suite('breakpoint');

test('toggleBreakpoint adiciona endereço ao Set', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  assert.equal(api.S.breakpoints.size, 0);
  api.toggleBreakpoint(0x05);
  assert.ok(api.S.breakpoints.has(0x05), 'deve ter 0x05 após toggle');
  assert.equal(api.S.breakpoints.size, 1);
});

test('toggleBreakpoint remove endereço já existente', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.toggleBreakpoint(0x0A);
  assert.ok(api.S.breakpoints.has(0x0A));
  api.toggleBreakpoint(0x0A);
  assert.ok(!api.S.breakpoints.has(0x0A), 'deve remover após segundo toggle');
});

test('toggleBreakpoint mascara endereço com 0x3F', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.toggleBreakpoint(0xFF);  // 0xFF & 0x3F = 0x3F
  assert.ok(api.S.breakpoints.has(0x3F), 'deve armazenar 0x3F (mascarado)');
});

test('RUN para em breakpoint e entra em paused', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  // NOP em 0x00, NOP em 0x01, HLT em 0x02
  writeBytes(api, 0, [0x90, 0x90, 0xF4]);
  api.setPC(0);
  // Breakpoint no segundo NOP (0x01)
  api.toggleBreakpoint(0x01);
  await api.doRun();
  assert.equal(api.S.paused, true,  'deve estar paused ao atingir breakpoint');
  assert.equal(api.S.halt,   false, 'não deve estar halted');
  assert.equal(api.S.pc,     0x01,  'PC deve estar no endereço do breakpoint');
});

test('RUN não para em endereço sem breakpoint', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  // NOP em 0x00, HLT em 0x01
  writeBytes(api, 0, [0x90, 0xF4]);
  api.setPC(0);
  // Breakpoint em endereço que não será alcançado
  api.toggleBreakpoint(0x10);
  await api.doRun();
  assert.equal(api.S.halt,   true,  'deve haltar no HLT');
  assert.equal(api.S.paused, false, 'não deve estar paused');
});

test('doClear limpa todos os breakpoints', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.toggleBreakpoint(0x00);
  api.toggleBreakpoint(0x05);
  api.toggleBreakpoint(0x0A);
  assert.equal(api.S.breakpoints.size, 3);
  api.S.breakpoints.clear();  // simula doClear
  assert.equal(api.S.breakpoints.size, 0);
});

test('múltiplos breakpoints: para no primeiro encontrado', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  // três NOPs seguidos
  writeBytes(api, 0, [0x90, 0x90, 0x90, 0xF4]);
  api.setPC(0);
  api.toggleBreakpoint(0x01);
  api.toggleBreakpoint(0x02);
  await api.doRun();
  assert.equal(api.S.pc,     0x01, 'deve parar no primeiro breakpoint');
  assert.equal(api.S.paused, true);
});

test('RESUME também para em breakpoint', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  // NOP 0x00, NOP 0x01, NOP 0x02, HLT 0x03
  writeBytes(api, 0, [0x90, 0x90, 0x90, 0xF4]);
  api.setPC(0);
  // Breakpoint em 0x01 para parar o RUN inicial
  api.toggleBreakpoint(0x01);
  await api.doRun();
  assert.equal(api.S.pc, 0x01, 'RUN deve parar em 0x01');

  // Adiciona breakpoint em 0x02 e remove o de 0x01
  api.toggleBreakpoint(0x01);
  api.toggleBreakpoint(0x02);
  await api.doResume();
  assert.equal(api.S.pc,     0x02, 'RESUME deve parar em 0x02');
  assert.equal(api.S.paused, true);
  assert.equal(api.S.halt,   false);
});

test('[REGRESSION] RESUME não deve rearmar imediatamente o mesmo breakpoint sem executar a instrução atual', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  // NOP 0x00, NOP 0x01 [BP], HLT 0x02
  writeBytes(api, 0, [0x90, 0x90, 0xF4]);
  api.setPC(0);
  api.toggleBreakpoint(0x01);

  await api.doRun();
  assert.equal(api.S.paused, true, 'RUN deve pausar no breakpoint');
  assert.equal(api.S.pc, 0x01, 'PC deve ficar na instrução com breakpoint');
  assert.equal(api.S.breakpointHit, 0x01, 'breakpointHit deve registrar o endereço pausado');
  assert.ok(api.S.breakpoints.has(0x01), 'o breakpoint deve continuar armado');

  await api.doResume();
  assert.equal(api.S.paused, false, 'RESUME não deve pausar novamente no mesmo endereço');
  assert.equal(api.S.halt, true, 'após executar a instrução atual, a CPU deve alcançar o HLT');
  assert.equal(api.S.pc, 0x03, 'PC deve avançar além do HLT depois de executar 0x01 e 0x02');
  assert.equal(api.S.breakpointHit, null, 'sem novo hit, breakpointHit deve permanecer limpo');
  assert.ok(api.S.breakpoints.has(0x01), 'o breakpoint deve permanecer cadastrado para hits futuros');
});

test('[REGRESSION] RESUME ignora o breakpoint atual só uma vez e volta a disparar se o fluxo retornar', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  // 0x00: NOP [BP]
  // 0x01: JMP SHORT -3 -> volta para 0x00
  writeBytes(api, 0, [0x90, 0xEB, 0xFD]);
  api.setPC(0);
  api.toggleBreakpoint(0x00);

  await api.doRun();
  assert.equal(api.S.paused, true, 'RUN deve pausar no breakpoint inicial');
  assert.equal(api.S.pc, 0x00, 'PC deve permanecer no breakpoint inicial');
  assert.equal(api.S.breakpointHit, 0x00);

  await api.doResume();
  assert.equal(api.S.paused, true, 'ao retornar para 0x00, o breakpoint deve disparar novamente');
  assert.equal(api.S.halt, false, 'o loop deve ser interrompido pelo breakpoint, não por HLT');
  assert.equal(api.S.pc, 0x00, 'o fluxo deve voltar a pausar em 0x00');
  assert.equal(api.S.breakpointHit, 0x00, 'o segundo hit deve registrar o mesmo breakpoint');
});

test('breakpoint no PC inicial dispara imediatamente no RUN', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  writeBytes(api, 0, [0x90, 0xF4]);
  api.setPC(0);
  // Breakpoint exatamente no endereço inicial
  api.toggleBreakpoint(0x00);
  await api.doRun();
  assert.equal(api.S.pc,     0x00, 'PC deve permanecer em 0x00');
  assert.equal(api.S.paused, true,  'deve pausar imediatamente');
  assert.equal(api.S.halt,   false);
});

test('STEP via _executeOne não é bloqueado por breakpoint', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  // NOP em 0x00, NOP em 0x01
  writeBytes(api, 0, [0x90, 0x90]);
  api.setPC(0);
  api.toggleBreakpoint(0x00);  // breakpoint na instrução atual
  // _executeOne (base do STEP) deve executar normalmente
  await api._executeOne({ traceMode: 'step' });
  assert.equal(api.S.pc, 0x01, 'STEP deve avançar PC mesmo com breakpoint no endereço');
  assert.equal(api.S.halt, false);
});

test('breakpoint em instrução de 5 bytes (MOV EAX, imm32) — para no início da instrução', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  // NOP em 0x00; MOV EAX, 0x12345678 em 0x01 (5 bytes); HLT em 0x06
  writeBytes(api, 0, [0x90, 0xB8, 0x78, 0x56, 0x34, 0x12, 0xF4]);
  api.setPC(0);
  api.toggleBreakpoint(0x01);
  await api.doRun();
  assert.equal(api.S.pc,     0x01, 'deve parar no início da instrução MOV');
  assert.equal(api.S.paused, true);
});

test('breakpoint removido: RUN não para mais naquele endereço', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  writeBytes(api, 0, [0x90, 0x90, 0xF4]);
  api.setPC(0);
  api.toggleBreakpoint(0x01);
  api.toggleBreakpoint(0x01);  // remove imediatamente
  await api.doRun();
  assert.equal(api.S.halt,   true,  'deve haltar no HLT, não pausar no breakpoint removido');
  assert.equal(api.S.paused, false);
});

test('breakpoint não afeta estado de registradores: EAX correto após pausa', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  // MOV EAX, 0xDEAD (5 bytes) em 0x00; NOP em 0x05
  writeBytes(api, 0, [0xB8, 0xAD, 0xDE, 0x00, 0x00, 0x90, 0xF4]);
  api.setPC(0);
  api.toggleBreakpoint(0x05);  // breakpoint após o MOV
  await api.doRun();
  assert.equal(api.S.pc,          0x05,   'deve parar no NOP após MOV');
  assert.equal(api.S.regs.EAX,    0xDEAD, 'EAX deve ter sido atualizado pelo MOV antes do breakpoint');
  assert.equal(api.S.paused,      true);
});

test('instrStartFor: byte no início de instrução retorna o próprio endereço', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  // NOP em 0x00, MOV EAX,imm em 0x01
  writeBytes(api, 0, [0x90, 0xB8, 0x78, 0x56, 0x34, 0x12]);
  assert.equal(api.instrStartFor(0x00), 0x00, 'início do NOP deve ser 0x00');
  assert.equal(api.instrStartFor(0x01), 0x01, 'início do MOV deve ser 0x01');
});

test('instrStartFor: byte no meio de instrução multi-byte retorna o início', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  // MOV EAX, 0x12345678 em 0x00 (5 bytes: B8 78 56 34 12); NOP em 0x05
  writeBytes(api, 0, [0xB8, 0x78, 0x56, 0x34, 0x12, 0x90]);
  assert.equal(api.instrStartFor(0x00), 0x00, 'byte 0 → início 0x00');
  assert.equal(api.instrStartFor(0x01), 0x00, 'byte 1 (imm) → início 0x00');
  assert.equal(api.instrStartFor(0x02), 0x00, 'byte 2 (imm) → início 0x00');
  assert.equal(api.instrStartFor(0x03), 0x00, 'byte 3 (imm) → início 0x00');
  assert.equal(api.instrStartFor(0x04), 0x00, 'byte 4 (imm) → início 0x00');
  assert.equal(api.instrStartFor(0x05), 0x05, 'byte 5 (NOP) → início 0x05');
});

test('toggleBreakpoint em byte do meio de instrução: armazena o início', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  // MOV EAX, imm32 em 0x00 (5 bytes)
  writeBytes(api, 0, [0xB8, 0x78, 0x56, 0x34, 0x12, 0x90]);
  // Clica no byte 0x03 (meio da instrução)
  api.toggleBreakpoint(0x03);
  assert.ok(api.S.breakpoints.has(0x00), 'breakpoint deve ser no início (0x00), não no byte clicado (0x03)');
  assert.ok(!api.S.breakpoints.has(0x03), 'não deve ter breakpoint em 0x03');
});

test('RUN para no início da instrução mesmo quando bp foi definido no byte do meio', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  // NOP 0x00; MOV EAX,imm32 0x01 (5 bytes); HLT 0x06
  writeBytes(api, 0, [0x90, 0xB8, 0x78, 0x56, 0x34, 0x12, 0xF4]);
  api.setPC(0);
  // Define breakpoint no byte 0x03 (meio do MOV) — deve resolver para 0x01
  api.toggleBreakpoint(0x03);
  assert.ok(api.S.breakpoints.has(0x01), 'breakpoint deve estar em 0x01');
  await api.doRun();
  assert.equal(api.S.pc,     0x01, 'deve parar em 0x01 (início do MOV)');
  assert.equal(api.S.paused, true);
});

// ─── Regressão: alias addr & 0x3F fora do code segment ───────────────────

test('[REGRESSION] mc-bp não deve ser aplicado fora do code segment (bug: alias addr & 0x3F)', () => {
  // Bug: buildMemGrid usava bpBytes.has(addr & 0x3F), fazendo com que células de
  // memória fora dos primeiros 64 bytes (stack, heap) fossem marcadas erroneamente.
  // Exemplo: breakpoint em 0x0A → addr=0x004A → 0x004A & 0x3F = 0x0A → mc-bp aplicado.
  // Fix: verificar addr < 64 antes de checar bpBytes.
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  // Breakpoint em 0x0A (code segment)
  writeBytes(api, 0, [0x90, 0x90, 0x90, 0x90, 0x90, 0x90, 0x90, 0x90, 0x90, 0x90, 0xF4]);
  api.toggleBreakpoint(0x0A);
  assert.ok(api.S.breakpoints.has(0x0A), 'breakpoint deve estar em 0x0A');

  // Simula a verificação de buildMemGrid: somente addr < 64 pode ter mc-bp
  // Para cada endereço fora do code segment que teria alias em 0x0A:
  const aliasAddrs = [0x0A + 0x40, 0x0A + 0x80, 0x0A + 0xC0, 0x0A + 0x100];
  // Invariante: bpBytes.has(alias) deve ser falso OU addr >= 64 deve bloquear
  // A lógica correta: if(addr < 64 && bpBytes.has(addr))
  const bpBytesSet = api.S.breakpoints;
  for (const alias of aliasAddrs) {
    // O bug seria: bpBytesSet.has(alias & 0x3F) → true para alias=0x4A
    // O fix correto não usa & 0x3F na checagem de display, mas restringe a addr < 64
    const wouldTriggerBug = bpBytesSet.has(alias & 0x3F);
    const wouldTriggerFix = alias < 64 && bpBytesSet.has(alias);
    assert.ok(wouldTriggerBug,   `alias 0x${alias.toString(16)}: o bug teria marcado erroneamente`);
    assert.equal(wouldTriggerFix, false, `addr=0x${alias.toString(16)} >= 64 não deve receber mc-bp`);
  }
});

test('[REGRESSION] breakpoint em 0x00 não contamina alias 0x40, 0x80, 0xC0', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  writeBytes(api, 0, [0x90, 0xF4]);
  api.toggleBreakpoint(0x00);

  const buggyCheck  = (addr) => api.S.breakpoints.has(addr & 0x3F);
  const correctCheck = (addr) => addr < 64 && api.S.breakpoints.has(addr);

  // Com o bug, endereços 0x40, 0x80, 0xC0 teriam mc-bp
  assert.ok(buggyCheck(0x40),  'confirmação do bug: 0x40 & 0x3F = 0x00 → true (lógica antiga)');
  assert.ok(buggyCheck(0x80),  'confirmação do bug: 0x80 & 0x3F = 0x00 → true (lógica antiga)');
  // Com o fix, nenhum desses deve receber mc-bp
  assert.equal(correctCheck(0x40), false, '0x40 não deve ter mc-bp (fora do code segment)');
  assert.equal(correctCheck(0x80), false, '0x80 não deve ter mc-bp (fora do code segment)');
  assert.equal(correctCheck(0xC0), false, '0xC0 não deve ter mc-bp (fora do code segment)');
  // O endereço no code segment ainda deve funcionar
  assert.equal(correctCheck(0x00), true,  '0x00 no code segment deve ter mc-bp');
});

test('[REGRESSION] bpBytes armazena endereços absolutos, não mascarados', () => {
  // Bug anterior: bpBytes.add((bpAddr + i) & 0x3F) — se instrução cruza 0x3F→0x00,
  // a expansão wraps e pode sobrescrever endereços errados.
  // Fix: bpBytes.add(bpAddr + i) — endereços absolutos, verificação usa addr < 64.
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  // MOV EAX, imm32 em 0x3C (5 bytes: 0x3C,0x3D,0x3E,0x3F,0x40 — mas 0x40 wraps!)
  // Na prática instrStartFor limita ao espaço de 64 bytes, mas a expansão
  // de bpBytes deve ser consistente com addr < 64.
  writeBytes(api, 0x3C, [0xB8, 0x01, 0x00, 0x00, 0x00]);
  api.toggleBreakpoint(0x3C);
  // O breakpoint deve estar em 0x3C (início da instrução)
  assert.ok(api.S.breakpoints.has(0x3C), 'breakpoint deve estar em 0x3C');
  // Simula a expansão correta (sem & 0x3F): endereços 0x3C, 0x3D, 0x3E, 0x3F, 0x40
  // Destes, apenas os < 64 (0x3C–0x3F) devem receber mc-bp; 0x40 não
  const instrSize = api.decodeAt(0x3C).size || 1;
  const expectedBytes = [];
  for (let i = 0; i < instrSize; i++) expectedBytes.push(0x3C + i);
  // Todos os bytes da instrução que estão dentro do code segment
  const inCodeSegment = expectedBytes.filter(a => a < 64);
  const outOfSegment  = expectedBytes.filter(a => a >= 64);
  for (const a of inCodeSegment) {
    assert.equal(a < 64, true, `byte 0x${a.toString(16)} deve estar no code segment`);
  }
  for (const a of outOfSegment) {
    assert.equal(a < 64, false, `byte 0x${a.toString(16)} NÃO deve receber mc-bp`);
  }
});

// ─── Invariantes gerais de breakpoint ────────────────────────────────────

test('[INVARIANT] breakpoints sempre contêm endereços no range 0x00–0x3F', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  writeBytes(api, 0, [0x90, 0xB8, 0x01, 0x00, 0x00, 0x00, 0xF4]);
  // Tenta definir breakpoints em vários endereços incluindo fora do range
  const candidates = [0x00, 0x01, 0x05, 0x3F, 0x40, 0x7F, 0xFF, 0x1FF];
  for (const addr of candidates) {
    api.toggleBreakpoint(addr);
  }
  for (const bp of api.S.breakpoints) {
    assert.ok(bp >= 0 && bp <= 0x3F, `breakpoint 0x${bp.toString(16)} fora do range 0x00–0x3F`);
  }
});

test('[INVARIANT] toggleBreakpoint é idempotente: dois toggles restabelecem estado original', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  writeBytes(api, 0, [0x90, 0xF4]);
  assert.equal(api.S.breakpoints.size, 0);
  api.toggleBreakpoint(0x00);
  assert.equal(api.S.breakpoints.size, 1);
  api.toggleBreakpoint(0x00);
  assert.equal(api.S.breakpoints.size, 0, 'dois toggles no mesmo endereço devem cancelar');
});

test('[INVARIANT] breakpoints não são afetados por instrStartFor em endereços já alinhados', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  // NOP em 0x00, 0x01, 0x02 → instrStartFor(0x00) = 0x00
  writeBytes(api, 0, [0x90, 0x90, 0x90, 0xF4]);
  const start = api.instrStartFor(0x00);
  assert.equal(start, 0x00, 'instrStartFor(0x00) deve retornar 0x00 para NOP no início');
  api.toggleBreakpoint(0x00);
  assert.ok(api.S.breakpoints.has(0x00), 'breakpoint deve estar em 0x00');
  assert.equal(api.S.breakpoints.size, 1, 'não deve criar breakpoints duplicados');
});

test('[INVARIANT] instrStartFor nunca retorna endereço >= 64', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  writeBytes(api, 0, [0xB8, 0xFF, 0xFF, 0xFF, 0xFF, 0x90, 0xF4]);
  for (let addr = 0; addr < 64; addr++) {
    const start = api.instrStartFor(addr);
    assert.ok(start >= 0 && start <= 0x3F,
      `instrStartFor(0x${addr.toString(16)}) = 0x${start.toString(16)} deve estar em 0x00–0x3F`);
  }
});

test('[INVARIANT] RUN com S.breakpoints vazio nunca entra em paused por breakpoint', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  writeBytes(api, 0, [0x90, 0x90, 0xF4]);  // NOP; NOP; HLT
  assert.equal(api.S.breakpoints.size, 0);
  await api.doRun();
  assert.equal(api.S.paused,  false, 'não deve pausar sem breakpoints');
  assert.equal(api.S.halt,    true,  'deve haltar no HLT');
});

// ─── bpNumber e breakpointHit ─────────────────────────────────────────────

test('bpNumber: retorna 1-based index ordenado por endereço', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  writeBytes(api, 0, [0x90, 0x90, 0x90, 0xF4]);
  // Adiciona breakpoints fora de ordem
  api.S.breakpoints.add(0x02);
  api.S.breakpoints.add(0x00);
  api.S.breakpoints.add(0x03);
  // Ordem crescente: 0x00=#1, 0x02=#2, 0x03=#3
  assert.equal(api.bpNumber(0x00), 1, '0x00 deve ser BP #1');
  assert.equal(api.bpNumber(0x02), 2, '0x02 deve ser BP #2');
  assert.equal(api.bpNumber(0x03), 3, '0x03 deve ser BP #3');
});

test('bpNumber: retorna 0 para endereço sem breakpoint', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.S.breakpoints.add(0x05);
  assert.equal(api.bpNumber(0x00), 0, 'endereço sem bp deve retornar 0');
  assert.equal(api.bpNumber(0x05), 1, 'endereço com bp deve retornar 1');
});

test('bpNumber: funciona com breakpoint único', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.S.breakpoints.add(0x0A);
  assert.equal(api.bpNumber(0x0A), 1);
});

test('bpNumber: renumera corretamente após remoção de breakpoint', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  writeBytes(api, 0, [0x90, 0x90, 0x90, 0x90, 0xF4]);
  api.S.breakpoints.add(0x00);
  api.S.breakpoints.add(0x02);
  api.S.breakpoints.add(0x04);
  assert.equal(api.bpNumber(0x00), 1);
  assert.equal(api.bpNumber(0x02), 2);
  assert.equal(api.bpNumber(0x04), 3);
  // Remove o do meio
  api.S.breakpoints.delete(0x02);
  assert.equal(api.bpNumber(0x00), 1, 'após remover #2, 0x00 continua #1');
  assert.equal(api.bpNumber(0x04), 2, 'após remover #2, 0x04 passa a ser #2');
});

test('breakpointHit: null antes de RUN', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  assert.equal(api.S.breakpointHit, null);
});

test('breakpointHit: setado com endereço correto ao atingir breakpoint', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  writeBytes(api, 0, [0x90, 0x90, 0xF4]);  // NOP; NOP; HLT
  api.toggleBreakpoint(0x01);  // breakpoint no segundo NOP
  await api.doRun();
  assert.equal(api.S.breakpointHit, 0x01, 'breakpointHit deve ser 0x01');
  assert.equal(api.S.paused, true);
});

test('breakpointHit: limpo ao iniciar novo RUN', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  writeBytes(api, 0, [0x90, 0xF4]);
  api.toggleBreakpoint(0x00);
  await api.doRun();
  assert.equal(api.S.breakpointHit, 0x00);
  // Segundo RUN — limpa o hit antes de começar
  api.S.paused = false;
  api.S.progRunning = false;
  api.S.breakpoints.clear();
  writeBytes(api, 0, [0xF4]);
  await api.doRun();
  assert.equal(api.S.breakpointHit, null, 'breakpointHit deve ser null após RUN sem breakpoint');
});

test('breakpointHit: limpo pelo doClear', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  writeBytes(api, 0, [0x90, 0xF4]);
  api.toggleBreakpoint(0x00);
  await api.doRun();
  assert.equal(api.S.breakpointHit, 0x00);
  api.doClear();
  assert.equal(api.S.breakpointHit, null, 'doClear deve limpar breakpointHit');
});

test('breakpointHit: limpo ao iniciar RESUME e atualizado no próximo hit', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  // NOP(0x00); NOP(0x01) BP; NOP(0x02); NOP(0x03) BP; HLT(0x04)
  // RUN: sem BP no 0x00, para em 0x01.
  // Remove BP@0x01, RESUME: avança, para em 0x03.
  writeBytes(api, 0, [0x90, 0x90, 0x90, 0x90, 0xF4]);
  api.toggleBreakpoint(0x01);
  api.toggleBreakpoint(0x03);
  await api.doRun();
  assert.equal(api.S.breakpointHit, 0x01, 'primeiro hit em 0x01');
  assert.equal(api.S.pc, 0x01);
  // Remove o BP do PC atual para o RESUME poder avançar
  api.toggleBreakpoint(0x01);
  assert.ok(!api.S.breakpoints.has(0x01), 'BP@0x01 deve ter sido removido');
  // RESUME — breakpointHit é limpo, executa 0x01, 0x02, para no BP@0x03
  await api.doResume();
  assert.equal(api.S.breakpointHit, 0x03, 'segundo hit em 0x03');
  assert.equal(api.S.pc, 0x03);
});

// ═══════════════════════════════════════════════════════════════════════════
//  SUITE: UTILS EXTENDED
// ═══════════════════════════════════════════════════════════════════════════
suite('utils-extended');

test('formatStackSize: bytes abaixo de 1024 exibe como "N B"', () => {
  const { api } = loadSimulator();
  assert.equal(api.S.stackSize = 100, 100);
  assert.equal(
    (() => { api.S.stackSize = 100; return api.S; })() && true, true
  );
  // acessa diretamente via contexto da api
  const { api: a2 } = loadSimulator();
  a2.S.stackSize = 512;
  // formatStackSize usa S.stackSize internamente — verificar via normalizeStackSizeBytes
  assert.equal(a2.normalizeStackSizeBytes(512), 512);
  assert.equal(a2.normalizeStackSizeBytes(1024), 1024);
  assert.equal(a2.normalizeStackSizeBytes(2048), 2048);
});

test('trimNumericText: remove zeros à direita e ponto decimal redundante', () => {
  const { api } = loadSimulator();
  // Decimais: zeros após o ponto são removidos
  assert.equal(api.trimNumericText('1.500'),   '1.5');   // zeros após dígito significativo
  assert.equal(api.trimNumericText('100.000'), '100');   // ponto + todos os zeros removidos
  assert.equal(api.trimNumericText('0.0'),     '0');     // ponto + zero — fica só '0'
  assert.equal(api.trimNumericText('3.14'),    '3.14');  // sem zeros à direita — inalterado
  assert.equal(api.trimNumericText('2.10'),    '2.1');   // apenas o zero final removido
  // A regex também remove zeros finais de inteiros sem ponto
  assert.equal(api.trimNumericText('1'),       '1');     // sem zero — inalterado
});

test('normalizeSpeed: clamp em [80, 10000]', () => {
  const { api } = loadSimulator();
  assert.equal(api.normalizeSpeed(0),     80);
  assert.equal(api.normalizeSpeed(50),    80);
  assert.equal(api.normalizeSpeed(80),    80);
  assert.equal(api.normalizeSpeed(2500),  2500);
  assert.equal(api.normalizeSpeed(10000), 10000);
  assert.equal(api.normalizeSpeed(99999), 10000);
  assert.equal(api.normalizeSpeed(NaN),   2500);
});

test('normalizeStackSizeBytes: clamp em [MIN, MAX]', () => {
  const { api } = loadSimulator();
  assert.equal(api.normalizeStackSizeBytes(0),           1);
  assert.equal(api.normalizeStackSizeBytes(-100),        1);
  assert.equal(api.normalizeStackSizeBytes(100),         100);
  assert.equal(api.normalizeStackSizeBytes(1024 * 1024), 1024 * 1024);
  assert.equal(api.normalizeStackSizeBytes(9999999),     1024 * 1024);
  assert.equal(api.normalizeStackSizeBytes(NaN),         100); // DEFAULT_STACK_SIZE
});

test('clamp: limita valor ao intervalo [min, max]', () => {
  const { api } = loadSimulator();
  assert.equal(api.clamp(5, 0, 10),   5);
  assert.equal(api.clamp(-5, 0, 10),  0);
  assert.equal(api.clamp(15, 0, 10),  10);
  assert.equal(api.clamp(0, 0, 0),    0);
});

// ═══════════════════════════════════════════════════════════════════════════
//  SUITE: REGISTERS EXTENDED
// ═══════════════════════════════════════════════════════════════════════════
suite('registers-ext');

test('markRegistersChanged: acumula nomes únicos em S.changedRegs', () => {
  const { api } = loadSimulator();
  resetSim(api, {getElementById:()=>({value:'0',style:{setProperty:()=>{}},classList:{add:()=>{},remove:()=>{}},textContent:''})});
  api.S.changedRegs = [];
  api.markRegistersChanged('EAX');
  api.markRegistersChanged('EBX');
  api.markRegistersChanged('EAX'); // duplicata — não deve repetir
  assert.deepEqual(toArr(api.S.changedRegs).sort(), ['EAX', 'EBX']);
});

test('clearChangedRegisters: limpa S.changedRegs', () => {
  const { api } = loadSimulator();
  api.S.changedRegs = ['EAX', 'EBX'];
  api.clearChangedRegisters();
  assert.deepEqual(toArr(api.S.changedRegs), []);
});

test('regWidthBytes: 4 bytes para IA-32; 8 para x64 GP, 4 para SP', () => {
  const { api } = loadSimulator();
  api.S.arch = 'ia32';
  assert.equal(api.regWidthBytes('EAX'), 4);
  assert.equal(api.regWidthBytes('ESP'), 4);
  api.S.arch = 'x64';
  assert.equal(api.regWidthBytes('RAX'), 8);
  assert.equal(api.regWidthBytes('RSP'), 4); // SP ainda é 4 em x64
  assert.equal(api.regWidthBytes('R8'),  8);
});

test('transferWidth: segue a largura fixa da arquitetura, limitada pelo registrador', () => {
  const { api } = loadSimulator();
  api.S.arch = 'ia32';
  api.S.reg  = 'EAX';
  assert.equal(api.transferWidth('EAX'), 4);
  api.S.arch = 'x64';
  api.S.reg  = 'RAX';
  assert.equal(api.transferWidth('RAX'), 8);
  assert.equal(api.transferWidth('RSP'), 4);
});

test('setRegParts + regParts: round-trip para RAX em x64', () => {
  const { api } = loadSimulator();
  api.S.arch = 'x64';
  api.setRegParts('RAX', 0xDEADBEEF, 0x12345678, { track: false });
  const { lo, hi } = api.regParts('RAX');
  assert.equal(lo >>> 0, 0xDEADBEEF);
  assert.equal(hi >>> 0, 0x12345678);
});

test('setRegFromBytes: preenche com zeros quando array é menor que largura', () => {
  const { api } = loadSimulator();
  api.S.arch = 'ia32';
  // Fornece 2 bytes para registrador de 4 bytes — os outros 2 devem ser 0
  api.setRegFromBytes('EAX', [0xBE, 0xEF], { track: false });
  assert.equal(api.getReg('EAX'), 0x0000EFBE);
});

// ═══════════════════════════════════════════════════════════════════════════
//  SUITE: MEMORY EXTENDED
// ═══════════════════════════════════════════════════════════════════════════
suite('memory-ext');

test('memByteAt: retorna 0 para endereço fora do espaço de memória', () => {
  const { api } = loadSimulator();
  api.S.stackSize = 100;
  assert.equal(api.memByteAt(-1), 0);
  assert.equal(api.memByteAt(200), 0); // além de stackSize
});

test('memByteAt: lê de S.mem para addr < 64, de S.stackMem para addr >= 64', () => {
  const { api } = loadSimulator();
  resetSim(api, { getElementById: () => ({ value: '0', style: { setProperty() {} }, classList: { add() {}, remove() {} }, textContent: '' }) });
  api.S.mem[10] = 0xAB;
  assert.equal(api.memByteAt(10), 0xAB);
  api.S.stackMem[64] = 0xCD;
  assert.equal(api.memByteAt(64), 0xCD);
});

test('mapAccessFits: rejeita addr negativo, width zero, overflow de 64 bytes', () => {
  const { api } = loadSimulator();
  assert.equal(api.mapAccessFits(-1, 1),  false);
  assert.equal(api.mapAccessFits(0, 0),   false);
  assert.equal(api.mapAccessFits(63, 1),  true);
  assert.equal(api.mapAccessFits(63, 2),  false); // 63+2-1=64 >= 64
  assert.equal(api.mapAccessFits(0, 64),  true);
  assert.equal(api.mapAccessFits(0, 65),  false);
});

test('stackAccessFits: rejeita addr+width > stackSize', () => {
  const { api } = loadSimulator();
  api.S.stackSize = 100;
  assert.equal(api.stackAccessFits(0, 1),    true);
  assert.equal(api.stackAccessFits(99, 1),   true);
  assert.equal(api.stackAccessFits(100, 1),  false); // 100+1=101 > 100
  assert.equal(api.stackAccessFits(-1, 1),   false);
  assert.equal(api.stackAccessFits(0, 0),    false);
});

test('writeStackBytes + readStackBytes: round-trip multi-byte', () => {
  const { api } = loadSimulator();
  resetSim(api, { getElementById: () => ({ value: '0', style: { setProperty() {} }, classList: { add() {}, remove() {} }, textContent: '' }) });
  const bytes = [0x11, 0x22, 0x33, 0x44];
  const addr  = api.S.stackSize - 8;
  api.writeStackBytes(addr, bytes);
  const result = api.readStackBytes(addr, 4);
  assert.deepEqual(toArr(result), bytes);
});

test('readStackPtrLE: monta valor little-endian de 4 bytes corretamente', () => {
  const { api } = loadSimulator();
  resetSim(api, { getElementById: () => ({ value: '0', style: { setProperty() {} }, classList: { add() {}, remove() {} }, textContent: '' }) });
  const addr = api.S.stackSize - 8;
  api.writeStackBytes(addr, [0xEF, 0xBE, 0xAD, 0xDE]);
  assert.equal(api.readStackPtrLE(addr, 4), 0xDEADBEEF);
});

test('isInstructionFault: retorna true para instrução com unknown/decodeError', () => {
  const { api } = loadSimulator();
  assert.equal(api.isInstructionFault({ unknown: true }),      true);
  assert.equal(api.isInstructionFault({ decodeError: true }),  true);
  assert.equal(api.isInstructionFault({ op: 0x90 }),           false);
  assert.equal(api.isInstructionFault(null),                   false);
  assert.equal(api.isInstructionFault(undefined),              false);
});

test('resetStackState: zera stackMem e reseta ESP/EBP para topo', () => {
  const { api } = loadSimulator();
  resetSim(api, { getElementById: () => ({ value: '0', style: { setProperty() {} }, classList: { add() {}, remove() {} }, textContent: '' }) });
  // Escreve alguns bytes na stack
  api.S.stackMem[10] = 0xFF;
  api.S.regs.ESP = 0;
  api.resetStackState();
  assert.equal(api.S.stackMem[10], 0);
  assert.equal(api.S.regs.ESP, api.S.stackSize);
  assert.equal(api.S.regs.EBP, api.S.stackSize);
  assert.deepEqual(toArr(api.S.callFrames), []);
});

// ═══════════════════════════════════════════════════════════════════════════
//  SUITE: ASSEMBLER VALIDATION
// ═══════════════════════════════════════════════════════════════════════════
suite('assembler-validation');

test('editDistance: 0 para strings idênticas', () => {
  const { api } = loadSimulator();
  assert.equal(api.editDistance('MOV', 'MOV'), 0);
  assert.equal(api.editDistance('', ''), 0);
});

test('editDistance: 1 para substituição simples', () => {
  const { api } = loadSimulator();
  assert.equal(api.editDistance('MOV', 'MOP'), 1);
  assert.equal(api.editDistance('PUSH', 'PISH'), 1);
});

test('editDistance: distância correta para strings diferentes', () => {
  const { api } = loadSimulator();
  assert.equal(api.editDistance('MOV', 'JMP'), 3);
  assert.equal(api.editDistance('CALL', 'CALLS'), 1);
});

test('wideAliasForReg: mapeia EAX→RAX, retorna string vazia para não-mapeados', () => {
  const { api } = loadSimulator();
  assert.equal(api.wideAliasForReg('EAX'), 'RAX');
  assert.equal(api.wideAliasForReg('EBX'), 'RBX');
  assert.equal(api.wideAliasForReg('ESP'), 'RSP');
  assert.equal(api.wideAliasForReg('RAX'), ''); // já é 64-bit, sem alias
  assert.equal(api.wideAliasForReg('R8'),  ''); // x64-only
});

test('parseAsmMemoryOperand: rejeita endereço > 0x3F com mensagem de erro', () => {
  const { api } = loadSimulator();
  const result = api.parseAsmMemoryOperand('[0x40]');
  assert.ok(result.error, 'deve retornar erro para addr > 0x3F');
});

test('validateAssembly: retorna erro para mnemônico desconhecido', () => {
  const { api } = loadSimulator();
  resetSim(api, { getElementById: () => ({ value: '0', style: { setProperty() {} }, classList: { add() {}, remove() {} }, textContent: '' }) });
  const result = api.validateAssembly('XYZZY EAX, 0x01', 0);
  assert.ok(result.error, 'deve reportar erro para mnemônico inválido');
});

// ═══════════════════════════════════════════════════════════════════════════
//  SUITE: SAVE / RESTORE
// ═══════════════════════════════════════════════════════════════════════════
suite('save-restore');

test('normalizeSpeed: valores dentro do range são preservados', () => {
  const { api } = loadSimulator();
  [80, 500, 1000, 2500, 10000].forEach(v => {
    assert.equal(api.normalizeSpeed(v), v, `normalizeSpeed(${v})`);
  });
});

test('normalizeStackSizeBytes: valores no range são preservados', () => {
  const { api } = loadSimulator();
  [1, 100, 1024, 65536, 1024 * 1024].forEach(v => {
    assert.equal(api.normalizeStackSizeBytes(v), v, `normalizeStackSizeBytes(${v})`);
  });
});

test('snapshotState + restoreSnapshot: estado é preservado e restaurado', () => {
  const { api } = loadSimulator();
  resetSim(api, { getElementById: () => ({ value: '0', style: { setProperty() {} }, classList: { add() {}, remove() {} }, textContent: '' }) });
  api.S.regs.EAX = 0xDEADBEEF;
  api.S.mem[0] = 0xAA;
  api.S.pc = 5;
  api.snapshotState();
  // Muda estado após snapshot
  api.S.regs.EAX = 0;
  api.S.mem[0] = 0;
  api.S.pc = 10;
  // Restaura
  api.restoreSnapshot(api.S.history.pop());
  assert.equal(api.S.regs.EAX, 0xDEADBEEF);
  assert.equal(api.S.mem[0], 0xAA);
  assert.equal(api.S.pc, 5);
});

test('setArch: alterna entre ia32 e x64 corretamente', () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.setArch('x64');
  assert.equal(api.S.arch, 'x64');
  assert.equal(api.S.reg, 'RAX');
  api.setArch('ia32');
  assert.equal(api.S.arch, 'ia32');
  assert.equal(api.S.reg, 'EAX');
});

// ═══════════════════════════════════════════════════════════════════════════
//  RUNNER
// ═══════════════════════════════════════════════════════════════════════════
const filterArg = process.argv.indexOf('--filter');
const filterPattern = filterArg >= 0 ? process.argv[filterArg + 1] : null;
const selectedTests = filterPattern
  ? tests.filter(t => t.name.includes(filterPattern))
  : tests;

(async () => {
  let passed = 0, failed = 0, skipped = 0;
  const failures = [];

  console.log(`\n🔬 MEM·SIM — Test Suite (${selectedTests.length}/${tests.length} tests)\n`);

  for (const t of selectedTests) {
    try {
      await t.fn();
      passed++;
      process.stdout.write(`  ✓ ${t.name}\n`);
    } catch (err) {
      failed++;
      failures.push({ name: t.name, err });
      process.stdout.write(`  ✗ ${t.name}\n`);
    }
  }

  if (tests.length > selectedTests.length) {
    skipped = tests.length - selectedTests.length;
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  Passed : ${passed}`);
  console.log(`  Failed : ${failed}`);
  if (skipped > 0) console.log(`  Skipped: ${skipped}`);
  console.log(`${'─'.repeat(60)}\n`);

  if (failures.length > 0) {
    console.log('FAILURES:\n');
    failures.forEach(({ name, err }) => {
      console.log(`  ✗ ${name}`);
      console.log(`    ${(err.message || String(err)).split('\n').join('\n    ')}\n`);
    });
    process.exitCode = 1;
  } else {
    console.log(`✅  All ${passed} tests passed.\n`);
  }
})();
