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

function scheduleCenterPaneLayout() {
  if (typeof requestAnimationFrame !== 'function') {
    applyCenterPaneHeights();
    return;
  }
  if (centerPaneLayoutFrame) return;
  centerPaneLayoutFrame = requestAnimationFrame(() => {
    centerPaneLayoutFrame = 0;
    applyCenterPaneHeights();
  });
}

function loadStackPanelWidth() {
  try {
    const manual = localStorage.getItem('memsim.stackPanelManual') === '1';
    const saved = parseInt(localStorage.getItem('memsim.stackPanelWidth') || '', 10);
    if (manual && Number.isFinite(saved)) {
      S.stackPanelManual = true;
      S.stackPanelWidth = clamp(saved, 220, 520);
    } else {
      S.stackPanelManual = false;
    }
  } catch (_) { }
}

function loadCodeMemSplit() {
  try {
    const manual = localStorage.getItem('memsim.codeMemSplitManual') === '1';
    const saved = parseInt(localStorage.getItem('memsim.codeMemSplitWidth') || '', 10);
    if (manual && Number.isFinite(saved)) {
      S.codeMemSplitManual = true;
      S.codeMemSplitWidth = saved;
    } else {
      S.codeMemSplitManual = false;
      S.codeMemSplitWidth = 0;
    }
  } catch (_) { }
}

function loadSidebarPanelWidth() {
  try {
    const manual = localStorage.getItem('memsim.sidebarPanelManual') === '1';
    const saved = parseInt(localStorage.getItem('memsim.sidebarPanelWidth') || '', 10);
    if (manual && Number.isFinite(saved)) {
      S.sidebarPanelManual = true;
      S.sidebarPanelWidth = clamp(saved, 220, 420);
    } else {
      S.sidebarPanelManual = false;
    }
  } catch (_) { }
}

function loadCenterPaneHeights() {
  try {
    const raw = localStorage.getItem('memsim.centerPaneHeights');
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') return;
    Object.keys(CENTER_PANE_CONFIG).forEach(key => {
      const height = parseInt(saved[key], 10);
      if (Number.isFinite(height)) S.centerPaneHeights[key] = height;
    });
  } catch (_) { }
}

function loadCollapsedSections() {
  try {
    const raw = localStorage.getItem('memsim.collapsedSections');
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved && typeof saved === 'object') S.collapsedSections = { ...saved };
  } catch (_) { }
}

function codeMemSplitMinPane(totalWidth) {
  const usable = Math.max((Number.isFinite(totalWidth) ? totalWidth : 0) - 10, 0);
  return clamp(Math.floor(usable / 2) - 24, 180, 320);
}

function applyCodeMemSplit() {
  const split = $('codeMemSplit');
  const handle = $('codeMemSplitHandle');
  const memPane = $('memSection');
  const asmPane = $('asmTraceSection');
  if (!split || !handle || !memPane || !asmPane) return;

  const total = Math.round(split.getBoundingClientRect().width || split.clientWidth || 0);
  if (!total) return;

  const handleW = Math.max(handle.getBoundingClientRect().width || 0, 10);
  const minPane = codeMemSplitMinPane(total);
  const memCollapsed = !!S.collapsedSections[sectionStateId(memPane)];
  const asmCollapsed = !!S.collapsedSections[sectionStateId(asmPane)];

  memPane.classList.toggle('is-collapsed', memCollapsed);
  asmPane.classList.toggle('is-collapsed', asmCollapsed);

  if (memCollapsed && asmCollapsed) {
    handle.hidden = true;
    split.style.gridTemplateColumns = 'minmax(0, 1fr) 0px minmax(0, 1fr)';
    return;
  }

  if (memCollapsed) {
    handle.hidden = true;
    const collapsed = clamp(Math.round(total * 0.28), 210, 320);
    split.style.gridTemplateColumns = `${collapsed}px 0px minmax(0, 1fr)`;
    return;
  }

  if (asmCollapsed) {
    handle.hidden = true;
    const collapsed = clamp(Math.round(total * 0.28), 210, 320);
    split.style.gridTemplateColumns = `minmax(0, 1fr) 0px ${collapsed}px`;
    return;
  }

  handle.hidden = false;
  if (!S.codeMemSplitManual) {
    // Painel de memória usa largura natural (fit-content); listagem ocupa o resto
    split.style.gridTemplateColumns = `auto ${handleW}px minmax(${minPane}px, 1fr)`;
    return;
  }

  const maxLeft = Math.max(minPane, total - handleW - minPane);
  const left = clamp(S.codeMemSplitWidth || Math.round((total - handleW) / 2), minPane, maxLeft);
  S.codeMemSplitWidth = left;
  split.style.gridTemplateColumns = `${left}px ${handleW}px minmax(${minPane}px, 1fr)`;
}

function applySidebarPanelWidth() {
  const shell = $('appShell');
  if (!shell) return;
  if (S.sidebarPanelManual) shell.style.setProperty('--sidebar-w', `${clamp(S.sidebarPanelWidth, 220, 420)}px`);
  else shell.style.removeProperty('--sidebar-w');
  applyCodeMemSplit();
}

function persistSidebarPanelWidth() {
  try {
    if (S.sidebarPanelManual) {
      localStorage.setItem('memsim.sidebarPanelManual', '1');
      localStorage.setItem('memsim.sidebarPanelWidth', String(clamp(S.sidebarPanelWidth, 220, 420)));
    } else {
      localStorage.removeItem('memsim.sidebarPanelManual');
      localStorage.removeItem('memsim.sidebarPanelWidth');
    }
  } catch (_) { }
}

function applyStackPanelWidth() {
  const shell = $('appShell');
  if (!shell) return;
  if (S.stackPanelManual) shell.style.setProperty('--stack-panel-w', `${clamp(S.stackPanelWidth, 220, 520)}px`);
  else shell.style.removeProperty('--stack-panel-w');
  applyCodeMemSplit();
}

function persistStackPanelWidth() {
  try {
    if (S.stackPanelManual) {
      localStorage.setItem('memsim.stackPanelManual', '1');
      localStorage.setItem('memsim.stackPanelWidth', String(clamp(S.stackPanelWidth, 220, 520)));
    } else {
      localStorage.removeItem('memsim.stackPanelManual');
      localStorage.removeItem('memsim.stackPanelWidth');
    }
  } catch (_) { }
}

function persistCodeMemSplit() {
  try {
    if (S.codeMemSplitManual) {
      localStorage.setItem('memsim.codeMemSplitManual', '1');
      localStorage.setItem('memsim.codeMemSplitWidth', String(Math.max(0, Math.round(S.codeMemSplitWidth || 0))));
    } else {
      localStorage.removeItem('memsim.codeMemSplitManual');
      localStorage.removeItem('memsim.codeMemSplitWidth');
    }
  } catch (_) { }
}

function applyCenterPaneHeights() {
  Object.entries(CENTER_PANE_CONFIG).forEach(([key, cfg]) => {
    const pane = $(key);
    if (!pane) return;
    if (S.collapsedSections[key]) {
      pane.classList.remove('pane-manual');
      pane.style.flex = '0 0 auto';
      pane.style.flexBasis = 'auto';
      pane.style.height = 'auto';
      return;
    }
    const hasManual = Number.isFinite(S.centerPaneHeights[key]);
    pane.classList.toggle('pane-manual', hasManual);
    if (!hasManual) {
      pane.style.flex = '0 0 auto';
      pane.style.flexBasis = 'auto';
      pane.style.height = 'auto';
      return;
    }
    const next = clamp(S.centerPaneHeights[key], cfg.min, cfg.max);
    pane.style.flex = '0 0 auto';
    pane.style.flexBasis = `${next}px`;
    pane.style.height = `${next}px`;
  });
  applyCodeMemSplit();
}

function persistCenterPaneHeights() {
  try {
    localStorage.setItem('memsim.centerPaneHeights', JSON.stringify(S.centerPaneHeights || {}));
  } catch (_) { }
}

function persistCollapsedSections() {
  try {
    localStorage.setItem('memsim.collapsedSections', JSON.stringify(S.collapsedSections || {}));
  } catch (_) { }
}

function sectionStateId(el, fallbackPrefix = 'section') {
  if (!el) return '';
  if (el.id) return el.id;
  if (el.dataset.sectionId) return el.dataset.sectionId;
  const header = el.querySelector('.ctrl-label, .section-badge');
  const label = (header?.textContent || `${fallbackPrefix}`).trim().replace(/\s+/g, '-').toLowerCase();
  const id = `${fallbackPrefix}-${label}`;
  el.dataset.sectionId = id;
  return id;
}

function createCollapseButton(target, sectionId) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'section-collapse-btn';
  btn.dataset.sectionToggle = sectionId;
  btn.setAttribute('aria-expanded', 'true');
  btn.title = t('ui.section.collapse');
  btn.textContent = '−';
  btn.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    toggleSectionCollapsed(sectionId);
  });
  target.appendChild(btn);
  return btn;
}

function setSectionHeaderText(el, text) {
  if (!el) return;
  [...el.childNodes].forEach(node => {
    if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) node.remove();
  });
  let textNode = el.querySelector(':scope > .section-header-text');
  if (!textNode) {
    textNode = document.createElement('span');
    textNode.className = 'section-header-text';
    const collapseBtn = el.querySelector(':scope > .section-collapse-btn');
    el.insertBefore(textNode, collapseBtn || el.firstChild);
  }
  textNode.textContent = text;
}

function setToggleVisual(btn, collapsed) {
  if (!btn) return;
  btn.textContent = collapsed ? '+' : '−';
  btn.title = collapsed ? t('ui.section.expand') : t('ui.section.collapse');
  btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
}

function ensureCtrlSectionBodies() {
  $$('#sidebar .ctrl-section, #rightPanel .ctrl-section').forEach((section, idx) => {
    const label = section.querySelector(':scope > .ctrl-label');
    if (!label) return;
    if (!section.dataset.sectionId) {
      section.dataset.sectionId = section.closest('#sidebar') ? `sidebar-${idx}` : `right-${idx}`;
    }
    const sectionId = sectionStateId(section, section.closest('#sidebar') ? 'sidebar' : 'right');
    if (!label.querySelector('.section-collapse-btn')) createCollapseButton(label, sectionId);
    let body = section.querySelector(':scope > .ctrl-section-body');
    if (!body) {
      body = document.createElement('div');
      body.className = 'ctrl-section-body';
      const nodes = [...section.children].filter(node => node !== label);
      nodes.forEach(node => body.appendChild(node));
      section.appendChild(body);
    }
  });
}

function ensureCanvasPaneHeads() {
  $$('.canvas-pane').forEach((pane, idx) => {
    const body = pane.querySelector(':scope > .canvas-pane-body');
    if (!body) return;
    const paneId = sectionStateId(pane, `canvas-${idx}`);
    let head = pane.querySelector(':scope > .section-badge');
    if (!head) {
      head = body.querySelector(':scope > .section-badge');
      if (head) pane.insertBefore(head, body);
    }
    if (!head) return;
    if (!head.querySelector('.section-collapse-btn')) createCollapseButton(head, paneId);
  });
}

function ensureSplitPaneHeads() {
  $$('.split-pane').forEach((pane, idx) => {
    const body = pane.querySelector(':scope > .split-pane-body');
    if (!body) return;
    const paneId = sectionStateId(pane, `split-${idx}`);
    let head = pane.querySelector(':scope > .section-badge');
    if (!head) {
      head = body.querySelector(':scope > .section-badge');
      if (head) pane.insertBefore(head, body);
    }
    if (!head) return;
    if (!head.querySelector('.section-collapse-btn')) createCollapseButton(head, paneId);
  });
}

function applyCollapsedSections() {
  $$('.ctrl-section, .canvas-pane, .split-pane').forEach(section => {
    const sectionId = sectionStateId(section);
    const collapsed = !!S.collapsedSections[sectionId];
    section.classList.toggle('is-collapsed', collapsed);
    const body = section.querySelector(':scope > .ctrl-section-body, :scope > .canvas-pane-body, :scope > .split-pane-body');
    const handle = section.querySelector(':scope > .canvas-pane-handle, :scope > .split-pane-handle');
    if (body) body.hidden = collapsed;
    if (handle) handle.hidden = collapsed;
    setToggleVisual(section.querySelector('[data-section-toggle]'), collapsed);
  });
  applyCenterPaneHeights();
  applyCodeMemSplit();
}

function toggleSectionCollapsed(sectionId) {
  S.collapsedSections[sectionId] = !S.collapsedSections[sectionId];
  persistCollapsedSections();
  applyCollapsedSections();
}

function initCollapsibleSections() {
  ensureCtrlSectionBodies();
  ensureCanvasPaneHeads();
  ensureSplitPaneHeads();
  applyCollapsedSections();
}

function initStackResize() {
  const handle = $('stackResizeHandle');
  const shell = $('appShell');
  if (!handle || !shell) return;

  handle.addEventListener('mousedown', e => {
    if (window.innerWidth <= 1100) return;
    e.preventDefault();
    const shellRect = shell.getBoundingClientRect();
    document.body.classList.add('stack-resizing');

    function onMove(ev) {
      const next = clamp(Math.round(shellRect.right - ev.clientX), 220, 520);
      S.stackPanelManual = true;
      S.stackPanelWidth = next;
      applyStackPanelWidth();
    }

    function onUp() {
      document.body.classList.remove('stack-resizing');
      persistStackPanelWidth();
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}

function initSidebarResize() {
  const handle = $('sidebarResizeHandle');
  const shell = $('appShell');
  if (!handle || !shell) return;

  handle.addEventListener('mousedown', e => {
    if (window.innerWidth <= 760) return;
    e.preventDefault();
    const shellRect = shell.getBoundingClientRect();
    document.body.classList.add('sidebar-resizing');

    function onMove(ev) {
      const next = clamp(Math.round(ev.clientX - shellRect.left), 220, 420);
      S.sidebarPanelManual = true;
      S.sidebarPanelWidth = next;
      applySidebarPanelWidth();
    }

    function onUp() {
      document.body.classList.remove('sidebar-resizing');
      persistSidebarPanelWidth();
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}

function initCodeMemSplitResize() {
  const split = $('codeMemSplit');
  const handle = $('codeMemSplitHandle');
  if (!split || !handle) return;

  handle.addEventListener('mousedown', e => {
    if (handle.hidden) return;
    e.preventDefault();
    document.body.classList.add('code-mem-resizing');

    function onMove(ev) {
      const rect = split.getBoundingClientRect();
      const total = rect.width;
      const handleW = Math.max(handle.getBoundingClientRect().width || 0, 10);
      const minPane = codeMemSplitMinPane(total);
      const maxLeft = Math.max(minPane, total - handleW - minPane);
      S.codeMemSplitManual = true;
      S.codeMemSplitWidth = clamp(Math.round(ev.clientX - rect.left), minPane, maxLeft);
      applyCodeMemSplit();
    }

    function onUp() {
      document.body.classList.remove('code-mem-resizing');
      persistCodeMemSplit();
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}

function initCenterPaneResize() {
  $$('[data-pane-handle]').forEach(handle => {
    handle.addEventListener('mousedown', e => {
      const pane = e.currentTarget.closest('.canvas-pane');
      if (!pane) return;
      e.preventDefault();
      const paneKey = pane.id;
      const startHeight = Math.round(pane.getBoundingClientRect().height);
      const startY = e.clientY;
      const paneCfg = CENTER_PANE_CONFIG[paneKey] || { min: 160, max: 520 };
      document.body.classList.add('pane-resizing');

      function onMove(ev) {
        const next = clamp(Math.round(startHeight + (ev.clientY - startY)), paneCfg.min, paneCfg.max);
        S.centerPaneHeights[paneKey] = next;
        pane.style.height = `${next}px`;
      }

      function onUp() {
        document.body.classList.remove('pane-resizing');
        persistCenterPaneHeights();
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      }

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  });
}
