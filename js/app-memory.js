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
// MEMORY SPACE SIZE
// ─────────────────────────────────────────────────────────
function memSpaceSize() {
  return Math.max(64, S.stackSize);
}

function memWindowRows() {
  return Math.max(1, Math.ceil(memSpaceSize() / 8));
}

function memCellPx() {
  const total = memSpaceSize();
  if (total <= 512) return 24;
  if (total <= 4096) return 20;
  if (total <= 16384) return 16;
  if (total <= 65536) return 12;
  if (total <= 262144) return 9;
  return 7;
}

// ─────────────────────────────────────────────────────────
// MEMORY READ / WRITE
// ─────────────────────────────────────────────────────────
function memByteAt(addr) {
  if (addr < 0 || addr >= memSpaceSize()) return 0;
  if (addr < 64) return S.mem[addr] & 0xFF;
  return S.stackMem[addr] & 0xFF;
}

function memStateAt(addr) {
  if (addr < 0 || addr >= memSpaceSize()) return '';
  if (addr < 64) return S.memState[addr] || '';
  return S.stackState.get(addr) || '';
}

function setByteState(addr, st = '') {
  if (addr < 0 || addr >= memSpaceSize()) return;
  if (addr < 64) {
    S.memState[addr] = st || '';
    syncMemCellDom(addr);
    return;
  }
  if (st) S.stackState.set(addr, st);
  else S.stackState.delete(addr);
  syncMemCellDom(addr);
}

const MEM_STATE_CLASSES = ['mc-active', 'mc-written', 'mc-pc', 'mc-error'];

function syncMemCellDom(addr) {
  const cell = memEl(addr);
  if (!cell || cell.classList?.contains('is-editing')) return;
  cell.textContent = hex8(memByteAt(addr));
  cell.classList.remove(...MEM_STATE_CLASSES);
  const st = memStateAt(addr);
  if (st) cell.classList.add(st);
}

function writeMem(addr, val, st = '') {
  if (addr < 0) return;
  if (addr < 64) {
    S.mem[addr] = val & 0xFF;
    S.memState[addr] = st || '';
    S.stackMem[addr] = val & 0xFF; // mirror to stack space
  } else if (addr < S.stackSize) {
    S.stackMem[addr] = val & 0xFF;
    if (st) S.stackState.set(addr, st);
    else S.stackState.delete(addr);
  }
  syncMemCellDom(addr);
}

function setMemSt(addr, st = '') {
  setByteState(addr, st);
}

// Resolve a DOM element for a memory cell by address
const memEl = addr => memCellRefs?.[addr] || document.querySelector(`[data-addr="${addr}"]`);

// ─────────────────────────────────────────────────────────
// MEMORY VIEW
// ─────────────────────────────────────────────────────────
function revealMemAddr(addr, opts = {}) {
  const target = clamp(Math.trunc(Number.isFinite(addr) ? addr : 0), 0, Math.max(memSpaceSize() - 1, 0));
  if (opts.scroll) memEl(target)?.scrollIntoView({ block: 'center', inline: 'nearest' });
}

function revealMemRange(addr, width = 1, opts = {}) {
  const first = clamp(Math.trunc(Number.isFinite(addr) ? addr : 0), 0, Math.max(memSpaceSize() - 1, 0));
  if (opts.scroll) memEl(first)?.scrollIntoView({ block: 'center', inline: 'nearest' });
}

function mapVisibleRange(addr, width) {
  const out = [];
  for (let i = 0; i < width; i++) {
    const ma = addr + i;
    if (ma >= 0 && ma < 64) out.push(ma);
  }
  return out;
}

// ─────────────────────────────────────────────────────────
// BOUNDS CHECKS
// ─────────────────────────────────────────────────────────
function mapAccessFits(addr, width) {
  return Number.isInteger(addr) && Number.isInteger(width) && width > 0 &&
    addr >= 0 && (addr + width - 1) < 64;
}

function stackAccessFits(addr, width) {
  return Number.isInteger(addr) && Number.isInteger(width) && width > 0 &&
    addr >= 0 && (addr + width) <= S.stackSize;
}

// ─────────────────────────────────────────────────────────
// STACK READ / WRITE
// ─────────────────────────────────────────────────────────
function readStackBytes(addr, width) {
  if (!stackAccessFits(addr, width)) return [];
  return Array.from(S.stackMem.slice(addr, addr + width));
}

function writeStackBytes(addr, bytes, st = 'mc-written') {
  if (!stackAccessFits(addr, bytes.length)) return;
  bytes.forEach((byte, idx) => writeMem(addr + idx, byte & 0xFF, st));
}

function readStackPtrLE(addr, width = ptrSize()) {
  let value = 0;
  const bytes = readStackBytes(addr, width);
  for (let i = 0; i < Math.min(4, bytes.length); i++) value |= (bytes[i] & 0xFF) << (i * 8);
  return value >>> 0;
}

// ─────────────────────────────────────────────────────────
// STACK INITIALIZATION
// ─────────────────────────────────────────────────────────
function stackTopInit() {
  return Math.max(S.stackSize, 0);
}

function ensureStackMem() {
  const nextSize = normalizeStackSizeBytes(S.stackSize);
  if (!(S.stackMem instanceof Uint8Array) || S.stackMem.length !== nextSize) {
    S.stackMem = new Uint8Array(nextSize);
  }
  if (!(S.stackState instanceof Map)) S.stackState = new Map();
  S.stackSize = nextSize;
}

function syncLowMemoryToStack() {
  const limit = Math.min(64, S.stackSize);
  for (let i = 0; i < limit; i++) S.stackMem[i] = S.mem[i] & 0xFF;
}

function resetStackState() {
  ensureStackMem();
  S.stackMem.fill(0);
  S.stackState.clear();
  syncLowMemoryToStack();
  S.regs.ESP = stackTopInit();
  S.regs.EBP = stackTopInit();
  S.callFrames = [];
}

// ─────────────────────────────────────────────────────────
// ERROR REPORTING
// ─────────────────────────────────────────────────────────
function reportStackBoundsError(kind, addr, width, asm = null, opts = {}) {
  const first = addr;
  const last = addr + width - 1;
  const message = `${kind}: o acesso exige ${width} byte(s), de 0x${fmtStackA(first)} até 0x${fmtStackA(last)}, mas a stack simulada vai de 0x0000 até 0x${fmtStackA(S.stackSize - 1)}.`;
  reportStackError(message, asm, opts);
}

function reportStackError(message, asm = null, opts = {}) {
  if (Number.isInteger(opts.pc)) setPC(opts.pc);
  if (opts.halt) { S.halt = true; S.faulted = true; }
  setStatus(message, 'lbl-error', { log: false });
  lg('error', message, asm);
  renderStackView();
}

function clearFaultLatch() {
  if (!S.faulted) return;
  S.faulted = false;
  S.halt = false;
}

function applyMemError(addrs) {
  addrs.forEach(a => setByteState(a, 'mc-error'));
}

function reportMemoryError(addrs, message, asm = null, opts = {}) {
  if (Number.isInteger(opts.pc)) setPC(opts.pc);
  if (opts.halt) { S.halt = true; S.faulted = true; }
  applyMemError(addrs);
  setStatus(message, 'lbl-error', { log: false });
  lg('error', message, asm);
}

function reportWidthOverflow(kind, addr, width, asm = null, opts = {}) {
  const addrs = [];
  const endAddr = addr + width - 1;
  for (let i = addr; i <= endAddr; i++) addrs.push(i & 0x3F);
  const msg = `${kind}: o acesso de ${width} byte(s) a partir de 0x${fmtMemA(addr)} ultrapassa o limite do mapa de memória (0x3F).`;
  reportMemoryError(addrs, msg, asm, opts);
}

function isInstructionFault(instr) {
  return !!(instr && (instr.unknown || instr.decodeError));
}

// ─────────────────────────────────────────────────────────
// PROGRAM LOADER
// ─────────────────────────────────────────────────────────
function loadDefaultProgram(announce = true, arch = S.arch) {
  const prog = demoProgramForArch(arch);
  S.mem.fill(0);
  S.memState.fill('');
  prog.bytes.forEach((b, i) => { S.mem[i] = b; S.memState[i] = 'mc-written'; });
  syncLowMemoryToStack();
  if (announce) {
    lg('sys', t('log.sys.demo_loaded', prog.name));
    setStatus(t('status.demo_loaded'), 'lbl-done');
  }
}
