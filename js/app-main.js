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

// ─────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────
function init() {
  if (window.APP_VERSION) {
    const vEl = document.getElementById('appVersion');
    if (vEl) vEl.textContent = window.APP_VERSION;
    document.title = `${t('page.title')} ${window.APP_VERSION}`;
  }
  loadSidebarPanelWidth();
  loadStackPanelWidth();
  loadCodeMemSplit();
  initCollapsibleSections();
  applySidebarPanelWidth();
  applyStackPanelWidth();
  applyCenterPaneHeights();
  initSidebarResize();
  initStackResize();
  initCodeMemSplitResize();
  initCenterPaneResize();
  // Set initial arch button state
  $('archIA32')?.classList.add('active');
  $('archX64')?.classList.remove('active');
  syncSpeedUI();

  $('speedSlider').addEventListener('input', e => {
    S.speed = normalizeSpeed(+e.target.value);
    syncSpeedUI();
  });
  $('asmInput')?.addEventListener('input', refreshAsmValidation);
  $('asmInput')?.addEventListener('blur', refreshAsmValidation);
  $('stackSizeInput')?.addEventListener('change', applyStackSize);
  $('stackSizeInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyStackSize();
    }
  });
  $('stackSizeUnitSelect')?.addEventListener('change', e => {
    doSetStackSizeUnit(e.target.value);
  });

  // Bloqueia a seleção de texto que o browser inicia ao Shift+Click
  $('memGrid').addEventListener('mousedown', e => {
    if (e.shiftKey && e.target.closest('.mem-cell')) e.preventDefault();
  });

  $('memGrid').addEventListener('click', e => {
    const c = e.target.closest('.mem-cell');
    if (!c) return;
    if (c.classList.contains('is-editing') || e.target.closest('.mem-edit-input')) return;
    const addr = +c.dataset.addr;
    if (e.shiftKey) {
      e.preventDefault();
      window.getSelection()?.removeAllRanges();
      toggleBreakpoint(addr);
      return;
    }
    // Resolve para o início da instrução que contém este byte
    const instrAddr = addr < 64 ? instrStartFor(addr) : addr;
    if (addr < 64) {
      setPC(instrAddr, { traceAutoScroll: true });
    }
    refreshBreakdown();
    renderStackView();
  });
  $('memGrid').addEventListener('dblclick', e => {
    const c = e.target.closest('.mem-cell');
    if (!c || c.classList.contains('is-editing') || e.target.closest('.mem-edit-input')) return;
    editMemCell(+c.dataset.addr);
  });
  $('stackView')?.addEventListener('click', e => {
    const row = e.target.closest('.stack-row');
    if (!row) return;
    const addr = parseInt(row.dataset.stackAddr || '0', 10);
    revealMemAddr(addr, { select: true, scroll: true });
    lg('sys', t('log.sys.stack_located', fmtStackA(addr)));
  });
  $('stackView')?.addEventListener('dblclick', e => {
    const row = e.target.closest('.stack-row');
    if (!row) return;
    const addr = parseInt(row.dataset.stackAddr || '0', 10);
    revealMemAddr(addr, { select: true, scroll: true });
    editMemCell(addr);
  });
  $('asmTrace')?.addEventListener('mousedown', e => {
    if (e.target.closest('.bp-dot')) e.preventDefault();
  });

  $('asmTrace')?.addEventListener('click', e => {
    if (e.target.closest('.asm-edit-input')) return;
    const bpDot = e.target.closest('.bp-dot');
    if (bpDot) {
      const addr = parseInt(bpDot.dataset.addr || '0', 16) & 0x3F;
      toggleBreakpoint(addr);
      return;
    }
    const line = e.target.closest('.asm-line, .c-line');
    if (!line) return;
    const addr = parseInt(line.dataset.addr || '0', 16) & 0x3F;
    if (asmTraceClickTimer) clearTimeout(asmTraceClickTimer);
    asmTraceClickTimer = setTimeout(() => {
      asmTraceClickTimer = 0;
      setPC(addr, { revealMem: true });
      renderStackView();
      lg('sys', t('log.sys.pc_moved', ipReg(), fmtA(addr)));
    }, 220);
  });
  $('asmTrace')?.addEventListener('dblclick', e => {
    const line = e.target.closest('.asm-line');
    if (!line || e.target.closest('.asm-edit-input')) return;
    if (asmTraceClickTimer) {
      clearTimeout(asmTraceClickTimer);
      asmTraceClickTimer = 0;
    }
    editAsmLine(line);
  });

  $('btnHelp').onclick = () => { $('helpBg').classList.add('open'); showHelp('intro', $$('.htab')[0]); };
  $('btnSave').onclick = saveSim;
  $('btnLoad').onclick = () => $('fileInput').click();
  $('fileInput').onchange = loadSim;

  loadDefaultProgram(false);
  renderRegPicker();
  renderMemGrid();
  setPC(demoProgramForArch().entry, { traceAutoScroll: false });
  renderStackView();
  syncInstructionPointerUI();
  syncEndianHint();
  syncPicker();
  refreshAsmValidation();
  refreshBreakdown();
  refreshPreview();
  refreshStats();
  setStatus(t('status.demo_loaded'), 'lbl-done');
  lg('sys', t('log.sys.demo_loaded', is64() ? 'x86-64' : 'IA-32'));
  lg('sys', demoProgramForArch().listing.join(' | '));
  applyCollapsedSections();
  applyCenterPaneHeights();
  applyCodeMemSplit();
  if (typeof window !== 'undefined') window.addEventListener('resize', () => {
    applyCenterPaneHeights();
    applyCodeMemSplit();
    syncAsmTraceHeight();
  });
}

// ─────────────────────────────────────────────────────────
// PUBLIC API  (called from HTML onclick="App.xxx()")
// ─────────────────────────────────────────────────────────
const App = {
  setEndian,
  setArch,
  selectReg,
  doStore,
  doLoad,
  clearSim,
  doExecute,
  doStep,
  doRun,
  doPause,
  doResume,
  doStop,
  doStepForward,
  doStepBack,
  doPush,
  doPop,
  assembleInput,
  toggleStackMode,
  setStackMode,
  setStackGranularity,
  toggleStackCfg,
  applyStackSize,
  clearLog: clearLog,
  clearBreakpoints,
  showHelp,
  closeHelp,
  _applyI18n: function () {
    const asmPh = $('asmInput');
    if (asmPh) asmPh.placeholder = t(S.arch === 'x64' ? 'asm.hint.placeholder.x64' : 'asm.hint.placeholder.ia32');
    const stackLbl = $('stackArchLbl');
    if (stackLbl) stackLbl.textContent = t(is64() ? 'stack.label.x64' : 'stack.label.ia32');
    syncInstructionPointerUI();
    syncEndianHint();
    refreshAsmValidation();
    renderStackView();
    renderAsmTrace();
    renderMemGrid();
    relocalizeLogOutput();
    const helpBody = $('helpBody');
    if (helpBody?.dataset.page) showHelp(helpBody.dataset.page, document.querySelector('.htab.active'));
  },
};

if (typeof globalThis !== 'undefined') globalThis.App = App;

document.addEventListener('DOMContentLoaded', init);
