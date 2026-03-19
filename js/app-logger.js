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
// PC / STATUS / LOG / STATS
// ─────────────────────────────────────────────────────────
function setPC(addr, opts = {}) {
  const prevPC = S.pc & 0x3F;
  S.pc = addr & 0x3F;
  syncMemCellDom(prevPC);
  if (S.pc !== prevPC) syncMemCellDom(S.pc);
  const syncTrace = opts.trace !== false;
  const traceAutoScroll = opts.traceAutoScroll === true;
  const revealMem = opts.revealMem === true;
  const pd = $('pcDisplay');
  if (pd && document.activeElement !== pd) pd.value = fmtA(S.pc);
  const ai = $('addrInput');
  if (ai && document.activeElement !== ai) {
    ai.value = fmtA(S.pc);
    if (revealMem) revealMemAddr(S.pc, { select: true, scroll: true });
    refreshBreakdown();
  }
  if (syncTrace) {
    renderAsmTrace({ autoScroll: traceAutoScroll });
    refreshAsmValidation();
  }
}
function statusLogType(cls) {
  if (cls === 'lbl-error') return 'error';
  if (cls === 'lbl-store') return 'store';
  if (cls === 'lbl-load') return 'load';
  if (cls === 'lbl-fetch') return 'info';
  return 'sys';
}
function setStatus(msg, cls, opts = {}) {
  if (!msg || opts.log === false) return;
  const key = `${cls || ''}|${msg}`;
  if (key === lastStatusLog) return;
  lastStatusLog = key;
  lg(statusLogType(cls), msg);
}

function ipReg() { return is64() ? 'RIP' : 'EIP'; }

function asmForOp(type, ctx) {
  // ctx: { reg, addr, val, byteAddr, byteVal, byteIdx, byteCount, newPC }
  switch (type) {
    case 'store-start':
      return `MOV ${widthPtr(transferWidth(ctx.reg))} [0x${fmtA(ctx.addr)}], ${ctx.reg}`;
    case 'store-byte':
      return `MOV BYTE PTR [0x${fmtA(ctx.byteAddr)}], 0x${hex8(ctx.byteVal)}  ; byte ${ctx.byteIdx + 1}/${ctx.byteCount}`;
    case 'load-start':
      return `MOV ${ctx.reg}, ${widthPtr(transferWidth(ctx.reg))} [0x${fmtA(ctx.addr)}]`;
    case 'load-byte':
      return `; [0x${fmtA(ctx.byteAddr)}] → ${ctx.reg}[byte ${ctx.byteIdx}]  (parcial: 0x${ctx.partial})`;
    case 'fetch':
      return `; ${ipReg()} = 0x${fmtA(ctx.addr)}  →  fetch  →  ${ipReg()} = 0x${fmtA(ctx.newPC)}`;
    case 'clear':
      return is64() ? `XOR RAX, RAX  ; (padrão: reinicia regs e memória)` : `XOR EAX, EAX  ; (padrão: reinicia regs e memória)`;
    default:
      return null;
  }
}

function logKindLabel(type, overrideLabel = '') {
  if (overrideLabel) return overrideLabel;
  if (type === 'step') return t('log.kind.step');
  if (type === 'store') return t('log.kind.store');
  if (type === 'load') return t('log.kind.load');
  if (type === 'info') return t('log.kind.info');
  if (type === 'error') return t('log.kind.error');
  return t('log.kind.sys');
}

function lg(type, msg, asm, opts = {}) {
  const out = $('logOutput'); if (!out) return;
  const d = document.createElement('div');
  const indent = Math.max(0, Number.isFinite(opts.indent) ? opts.indent : (S.logIndent || 0));
  d.className = 'le le-' + type + (indent ? ` le-indent-${Math.min(indent, 3)}` : '');
  d.dataset.type = type;
  d.dataset.kindOverride = opts.kindLabel || '';
  if (indent > 0) {
    const offset = indent * 20;
    d.style.marginLeft = `${offset}px`;
    d.style.maxWidth = `calc(100% - ${offset}px)`;
  }
  const ts = new Date().toTimeString().slice(0, 8);
  const tsEl = document.createElement('span');
  tsEl.className = 'le-ts';
  tsEl.textContent = `[${ts}]`;

  const kindEl = document.createElement('span');
  kindEl.className = 'le-kind';
  kindEl.textContent = logKindLabel(type, opts.kindLabel || '');

  const msgEl = document.createElement('span');
  msgEl.className = 'le-msg';
  msgEl.textContent = msg;

  d.append(tsEl, kindEl, msgEl);

  if (asm) {
    const asmEl = document.createElement('div');
    asmEl.className = 'le-asm';
    const asmLbl = document.createElement('span');
    asmLbl.className = 'le-asm-lbl';
    asmLbl.textContent = t('log.asm.label');
    const code = document.createElement('code');
    code.textContent = asm;
    asmEl.append(asmLbl, code);
    d.appendChild(asmEl);
  }
  out.appendChild(d); out.scrollTop = out.scrollHeight;
}
function relocalizeLogOutput() {
  const out = $('logOutput');
  if (!out) return;
  out.querySelectorAll('.le').forEach(entry => {
    const kindEl = entry.querySelector('.le-kind');
    if (kindEl) kindEl.textContent = logKindLabel(entry.dataset.type || 'sys', entry.dataset.kindOverride || '');
    const asmLbl = entry.querySelector('.le-asm-lbl');
    if (asmLbl) asmLbl.textContent = t('log.asm.label');
  });
}
function clearLog() {
  const o = $('logOutput');
  if (o) o.innerHTML = '';
  lastStatusLog = '';
  scheduleCenterPaneLayout();
}

function recOp(type, ms) {
  S.stats.ops++; S.stats.totalTime += ms;
  if (type === 'load') { S.stats.loads++; S.stats.loadTimes.push(ms); }
  if (type === 'store') { S.stats.stores++; S.stats.storeTimes.push(ms); }
  S.endian === 'little' ? S.stats.littleOps++ : S.stats.bigOps++;
  $('clockDisplay').textContent = ms + 'ms';
  $('opsDisplay').textContent = S.stats.ops;
}

function refreshStats() {
  const st = S.stats;
  if (!$('st-ops')) return;
  $('st-ops').textContent = st.ops;
  $('st-time').textContent = st.totalTime + 'ms';
  $('st-loads').textContent = st.loads;
  $('st-stores').textContent = st.stores;
  const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null;
  const al = avg(st.loadTimes), as = avg(st.storeTimes);
  $('st-avgl').textContent = al !== null ? al + 'ms' : '—';
  $('st-avgs').textContent = as !== null ? as + 'ms' : '—';
  const tot = st.littleOps + st.bigOps, pL = tot ? Math.round(st.littleOps / tot * 100) : 50;
  $('pfl').style.width = pL + '%'; $('pfb').style.width = (100 - pL) + '%';
  $('pc-l').textContent = st.littleOps; $('pc-b').textContent = st.bigOps;
}

function setBusy(on) { ['opStore', 'opLoad', 'opClear', 'opStep', 'opRun', 'opPush', 'opPop'].forEach(id => { const b = $(id); if (b) b.disabled = on; }); }
function readAddr() { return parseInt($('addrInput').value || '0', 16) & 0x3F; }
