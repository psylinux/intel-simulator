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

async function _executeOne(opts = {}) {
  const traceMode = opts.traceMode || 'run';
  const isStepTrace = traceMode === 'step';
  if (S.halt) return;
  const addr = S.pc;
  const instr = decodeAt(addr);
  if (isStepTrace) {
    lg('step', t('log.sys.step_start', fmtA(addr)));
  }

  // ── FASE 1: FETCH ──────────────────────────────────────
  // Lê bytes da memória → IR; IP incrementa imediatamente (Intel SDM §6.3)
  const np_seq = (addr + instr.size) & 0x3F;   // PC sequencial (pode ser sobrescrito por JMP)
  const fetchPrevStates = [];
  setStatus(t('status.fetch_short', fmtA(addr), instr.size), 'lbl-fetch', { log: false });
  for (let i = 0; i < instr.size; i++) {
    const ma = (addr + i) & 0x3F;
    fetchPrevStates.push(memStateAt(ma));
    setMemSt(ma, 'mc-pc');
  }
  if (isStepTrace) {
    lg('info', t('log.info.fetch_desc', instr.size, fmtA(addr)), asmForOp('fetch', { addr, newPC: np_seq }), { indent: 1, kindLabel: 'FETCH' });
  } else {
    lg('info', t('log.info.fetch1', fmtA(addr), hex8(instr.op), instr.size));
  }
  await sleep(S.speed * 0.25);

  // IP avança durante o fetch
  setPC(np_seq, { traceAutoScroll: true });
  if (isStepTrace) {
    lg('info', t('log.info.fetch_ip', ipReg(), fmtA(np_seq)), null, { indent: 1, kindLabel: 'FETCH' });
  }
  await sleep(S.speed * 0.1);

  // ── FASE 2: DECODE ─────────────────────────────────────
  setStatus(t('status.decode', instr.mnem), 'lbl-fetch', { log: false });
  if (isStepTrace) {
    lg('info', t('log.info.decode_desc', instr.mnem), instr.asm, { indent: 1, kindLabel: 'DECODE' });
  } else {
    lg('info', t('log.info.decode', instr.mnem), instr.asm);
  }
  if (isInstructionFault(instr)) {
    const prevIndent = S.logIndent;
    if (isStepTrace) S.logIndent = 2;
    try {
      reportMemoryError(
        instr.errorAddrs || [addr],
        instr.errorDetail || t('log.error.decode_fail', fmtA(addr)),
        instr.asm,
        { halt: true, pc: addr }
      );
    } finally {
      S.logIndent = prevIndent;
    }
    syncPicker(); refreshStats(); refreshPreview(); refreshBreakdown();
    return;
  }
  await sleep(S.speed * 0.2);

  // ── FASE 3: EXECUTE ────────────────────────────────────
  clearChangedRegisters();
  setStatus(t('status.execute', instr.mnem), 'lbl-load', { log: false });
  if (isStepTrace) {
    lg('info', t('log.info.execute_desc', ipReg()), instr.asm, { indent: 1, kindLabel: 'EXECUTE' });
  }
  const prevIndent = S.logIndent;
  if (isStepTrace) S.logIndent = 2;
  try {
    instr.exec();
  } finally {
    S.logIndent = prevIndent;
  }
  for (let i = 0; i < instr.size; i++) {
    const ma = (addr + i) & 0x3F;
    setMemSt(ma, fetchPrevStates[i] || '');
  }
  if (S.faulted) {
    syncPicker(); refreshStats(); refreshPreview(); refreshBreakdown();
    return;
  }

  // JMP sobrescreve o IP que foi incrementado durante o fetch
  if (instr.jmpTarget !== undefined) setPC(instr.jmpTarget, { traceAutoScroll: true });

  await sleep(S.speed * 0.2);

  if (isStepTrace) {
    lg('sys', t('log.sys.step_done', ipReg(), fmtA(S.pc)), null, { indent: 1, kindLabel: 'RESULTADO' });
  } else {
    lg('store', t('log.store.exec_ok', instr.mnem), instr.asm);
  }

  if (S.halt) {
    setStatus(t('status.hlt'), 'lbl-error', { log: false });
    if (isStepTrace) lg('error', t('log.error.hlt'), null, { indent: 1, kindLabel: 'HALT' });
    else lg('error', t('log.error.hlt'));
  } else {
    setStatus(t('status.execute_done', fmtA(S.pc)), 'lbl-done', { log: false });
  }

  renderStackView();
  syncPicker(); refreshStats(); refreshPreview(); refreshBreakdown();
}

function snapshotState() {
  const snap = {
    regs: { ...S.regs },
    mem: S.mem.slice(),
    stackMem: S.stackMem.slice(),
    stackState: new Map(S.stackState),
    memState: [...S.memState],
    pc: S.pc,
    callFrames: S.callFrames.map(f => ({ ...f })),
  };
  S.history.push(snap);
  if (S.history.length > S.historyMax) S.history.shift();
}

function restoreSnapshot(snap) {
  // Calcula quais registradores efetivamente mudaram antes de restaurar
  const prevRegs = S.regs;
  const actuallyChanged = Object.keys(snap.regs).filter(k => snap.regs[k] !== prevRegs[k]);

  S.regs = { ...snap.regs };
  S.mem = snap.mem.slice();
  S.stackMem = snap.stackMem.slice();
  S.stackState = new Map(snap.stackState);
  S.memState = [...snap.memState];
  S.callFrames = snap.callFrames.map(f => ({ ...f }));
  S.halt = false;
  if (actuallyChanged.length > 0) markRegistersChanged(actuallyChanged);
  else clearChangedRegisters();
  renderMemGrid();
  renderStackView();
  syncPicker();
  refreshStats();
  refreshPreview();
  refreshBreakdown();
  setPC(snap.pc, { traceAutoScroll: true });
}

function toggleBreakpoint(addr) {
  const a = instrStartFor(addr);
  if (S.breakpoints.has(a)) S.breakpoints.delete(a);
  else S.breakpoints.add(a);
  renderAsmTrace();
  renderMemGrid();
}

// Retorna o número 1-based do breakpoint em addr (ordenado por endereço), ou 0 se não existe.
function bpNumber(addr) {
  const sorted = [...S.breakpoints].sort((a, b) => a - b);
  const idx = sorted.indexOf(addr & 0x3F);
  return idx < 0 ? 0 : idx + 1;
}

async function doExecute(opts = {}) {
  if (S.busy) return;
  clearFaultLatch();
  if (S.halt) { lg('error', t('log.error.cpu_halted')); return; }
  S.busy = true; setBusy(true);
  await _executeOne(opts);
  S.busy = false; setBusy(false);
}

// ─────────────────────────────────────────────────────────
// PROGRAMA — RUN / STEP
// ─────────────────────────────────────────────────────────
async function doStep() { await doExecute({ traceMode: 'step' }); }

async function doRun() {
  if (S.busy || S.progRunning) return;
  clearFaultLatch();
  S.halt = false; S.paused = false; S.stopped = false; S.progRunning = true;
  S.breakpointHit = null;
  S.busy = true;
  setCpuState('running');

  while (!S.halt && !S.paused && !S.stopped) {
    if (S.breakpoints.has(S.pc & 0x3F)) {
      S.paused = true;
      S.breakpointHit = S.pc & 0x3F;
      lg('sys', t('log.sys.bp_hit', bpNumber(S.pc), fmtA(S.pc & 0x3F)));
      break;
    }
    snapshotState();
    await _executeOne({ traceMode: 'run' });
    if (S.halt || S.paused || S.stopped) break;
    await sleep(S.speed * 0.1);
  }

  S.busy = false;
  setBusy(false);
  if (S.paused) {
    setCpuState('paused');
    renderMemGrid();
    renderAsmTrace({ autoScroll: true });
  } else {
    S.progRunning = false;
    setCpuState('idle');
  }
}

function doPause() {
  if (!S.progRunning || S.paused) return;
  S.paused = true;
  // O loop doRun() detecta S.paused e chama setCpuState('paused')
}

async function doResume() {
  if (!S.progRunning || !S.paused) return;
  let skipBreakpointOnce = S.breakpointHit === (S.pc & 0x3F)
    ? (S.pc & 0x3F)
    : null;
  S.paused = false;
  S.stopped = false;
  S.breakpointHit = null;
  S.busy = true;
  setCpuState('running');
  renderMemGrid();

  while (!S.halt && !S.paused && !S.stopped) {
    const pc = S.pc & 0x3F;
    const shouldPauseOnBreakpoint = S.breakpoints.has(pc) && pc !== skipBreakpointOnce;
    skipBreakpointOnce = null;
    if (shouldPauseOnBreakpoint) {
      S.paused = true;
      S.breakpointHit = pc;
      lg('sys', t('log.sys.bp_hit', bpNumber(S.pc), fmtA(S.pc & 0x3F)));
      break;
    }
    snapshotState();
    await _executeOne({ traceMode: 'run' });
    if (S.halt || S.paused || S.stopped) break;
    await sleep(S.speed * 0.1);
  }

  S.busy = false;
  setBusy(false);
  if (S.paused) {
    setCpuState('paused');
    renderMemGrid();
    renderAsmTrace({ autoScroll: true });
  } else {
    S.progRunning = false;
    setCpuState('idle');
  }
}

function doStop() {
  S.stopped = true;
  S.paused = false;
  S.progRunning = false;
  S.busy = false;
  S.history = [];
  setBusy(false);
  setCpuState('idle');
}

async function doStepForward() {
  if (!S.paused) return;
  if (S.halt) { lg('error', t('log.error.cpu_halted')); return; }
  clearFaultLatch();
  snapshotState();
  S.busy = true; setBusy(true);
  await _executeOne({ traceMode: 'step' });
  S.busy = false; setBusy(false);
}

async function _executeOneReverse(fromAddr) {
  const instr = decodeAt(fromAddr);
  const fetchPrevStates = [];
  // EXECUTE → DECODE → FETCH (ordem inversa)
  setStatus(t('status.execute_revert', instr.mnem), 'lbl-load', { log: false });
  await sleep(S.speed * 0.2);
  setStatus(t('status.decode_revert', instr.mnem), 'lbl-fetch', { log: false });
  await sleep(S.speed * 0.2);
  setStatus(t('status.fetch_revert', fmtA(fromAddr)), 'lbl-fetch', { log: false });
  for (let i = 0; i < instr.size; i++) {
    const ma = (fromAddr + i) & 0x3F;
    fetchPrevStates.push(memStateAt(ma));
    setMemSt(ma, 'mc-pc');
  }
  await sleep(S.speed * 0.25);
  for (let i = 0; i < instr.size; i++) {
    const ma = (fromAddr + i) & 0x3F;
    setMemSt(ma, fetchPrevStates[i] || '');
  }
  setStatus(t('status.back_done', fmtA(fromAddr)), 'lbl-done', { log: false });
}

async function doStepBack() {
  if (!S.paused) return;
  if (S.history.length === 0) return;
  const snap = S.history.pop();
  S.busy = true; setBusy(true);
  await _executeOneReverse(snap.pc);
  restoreSnapshot(snap);
  S.busy = false; setBusy(false);
}

// ─────────────────────────────────────────────────────────
// PUSH / POP (standalone, usa ESP)
// ─────────────────────────────────────────────────────────
async function doPush() {
  if (S.busy) return;
  clearFaultLatch();
  S.busy = true; setBusy(true);
  const reg = S.reg, width = ptrSize();
  const spName = is64() ? 'RSP' : 'ESP';
  const nextSp = S.regs.ESP - width;
  if (!stackAccessFits(nextSp, width)) {
    reportStackBoundsError(`PUSH ${reg}`, nextSp, width, `PUSH ${reg}`, { halt: true });
    S.busy = false; setBusy(false);
    return;
  }
  S.regs.ESP = nextSp;
  const sp = S.regs.ESP;
  revealMemRange(sp, width, { select: true });
  renderStackView();
  lg('store', t('log.push', reg, regHex(reg), spName, fmtMemA(sp)), `PUSH ${reg}`);
  setStatus(t('status.push_start', reg, fmtMemA(sp)), 'lbl-store');
  const bs = regBytes(reg, width);
  for (let i = 0; i < width; i++) {
    const ma = sp + i;
    const hexPos = displayPosForTransferByte(reg, i, width);
    storeHighlight(reg, hexPos, width, i);
    setMemSt(ma, 'mc-active');
    await animPacket('store', bs[i], ma, { surface: 'stack', regName: reg, byteIdx: i, transferCount: width });
    writeMem(ma, bs[i], 'mc-active');
    await sleep(S.speed * 0.12);
    setMemSt(ma, 'mc-written');
  }
  updatePickerVal(reg); updatePickerBytes(reg);
  updatePickerVal(spName);
  markRegistersChanged(spName);
  setStatus(t('status.push_done', spName, fmtMemA(sp)), 'lbl-done');
  renderStackView();
  refreshStats(); refreshBreakdown();
  S.busy = false; setBusy(false);
}

async function doPop() {
  if (S.busy) return;
  clearFaultLatch();
  S.busy = true; setBusy(true);
  const reg = S.reg, spName = is64() ? 'RSP' : 'ESP', sp = S.regs.ESP >>> 0, width = ptrSize();
  if (!stackAccessFits(sp, width)) {
    reportStackBoundsError(`POP ${reg}`, sp, width, `POP ${reg}`, { halt: true });
    S.busy = false; setBusy(false);
    return;
  }
  lg('load', t('log.pop', fmtMemA(sp), reg, spName), `POP ${reg}`);
  setStatus(t('status.pop_start', fmtMemA(sp), reg), 'lbl-load');
  revealMemRange(sp, width, { select: true });
  renderStackView();
  const partialLittle = new Array(width).fill(0);
  setRegParts(reg, 0, 0); setLoading(reg, true);
  for (let i = 0; i < width; i++) {
    const ma = sp + i;
    setMemSt(ma, 'mc-active');
    await animPacket('load', S.stackMem[ma], ma, { surface: 'stack', regName: reg, byteIdx: i, transferCount: width });
    partialLittle[i] = S.stackMem[ma] & 0xFF;
    setRegFromBytes(reg, partialLittle);
    liveUpdate(reg, 0, i, width);
    await sleep(S.speed * 0.12);
    setMemSt(ma, 'mc-written');
  }
  setLoading(reg, false);
  S.regs.ESP = sp + width;
  updatePickerVal(spName);
  markRegistersChanged([reg, spName]);
  const finalHex = regHex(reg);
  $('valInput').value = finalHex.slice(-Math.min(sizeN() * 2, regWidthBytes(reg) * 2));
  setStatus(t('status.pop_done', reg, finalHex), 'lbl-done');
  renderStackView();
  refreshStats(); refreshPreview(); refreshBreakdown();
  S.busy = false; setBusy(false);
}

// ─────────────────────────────────────────────────────────
// ASSEMBLER EMBUTIDO
// Converte instrução Intel (subset) para bytes e grava na memória
// ─────────────────────────────────────────────────────────

async function assembleInput() {
  const inp = $('asmInput'); if (!inp) return;
  const src = inp.value.trim(); if (!src) return;
  const addr = S.pc;
  const validation = validateAssembly(src, addr);
  refreshAsmValidation();
  if (!validation.ok) {
    setStatus(t('status.asm_invalid_short', validation.error), 'lbl-error');
    lg('error', t('log.error.asm_invalid', fmtA(addr), validation.error));
    return;
  }
  const result = writeAssembledBytes(addr, validation.normalized, undefined, validation.bytes);
  if (!result) { lg('error', t('log.error.asm_unknown', src)); return; }
  lg('sys', t('log.sys.asm_encoded', src, result.bytes.map(b => '0x' + hex8(b)).join(', '), fmtA(addr)));
  setPC((addr + result.bytes.length) & 0x3F);
  lg('sys', t('log.sys.asm_written', result.bytes.length, fmtA(addr)));
  inp.value = '';
  refreshAsmValidation();
}

// ─────────────────────────────────────────────────────────
// CLEAR
// ─────────────────────────────────────────────────────────
function clearSim() {
  resetStatsState();
  resetCoreRegisters();
  S.halt = false; S.stopped = false; S.progRunning = false; S.breakpoints.clear(); S.breakpointHit = null;
  // Reset selected register to arch default
  S.reg = is64() ? 'RAX' : 'EAX';
  loadDefaultProgram(false);
  renderRegPicker(); renderMemGrid(); setPC(0);
  $('valInput').value = regHex(S.reg).slice(-Math.min(sizeN() * 2, regWidthBytes(S.reg) * 2));
  renderStackView();
  syncPicker(); refreshStats(); refreshPreview(); refreshBreakdown();
  setCpuState('idle');
  setStatus(t('status.demo_reset', ipReg()), 'lbl-done');
  lg('sys', t('log.sys.demo_reset'), asmForOp('clear', {}));
  lg('sys', demoProgramForArch().listing.join(' | '));
}

function clearBreakpoints() {
  S.breakpoints.clear();
  S.breakpointHit = null;
  renderAsmTrace();
  renderMemGrid();
}


// Backward-compatible aliases (for test harness)
const doClear = clearSim;
const doAssemble = assembleInput;
