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
// REGISTER SETS  (architecture-aware)
// ─────────────────────────────────────────────────────────
function gpRegs() { return is64() ? ['RAX', 'RBX', 'RCX', 'RDX', 'RSI', 'RDI'] : ['EAX', 'EBX', 'ECX', 'EDX', 'ESI', 'EDI']; }
function extRegs() { return is64() ? ['R8', 'R9', 'R10', 'R11', 'R12', 'R13', 'R14', 'R15'] : []; }
function spRegs() { return is64() ? ['RSP', 'RBP'] : ['ESP', 'EBP']; }

function ptrSize() { return is64() ? 8 : 4; }
function isSpReg(name) { return spRegs().includes(name); }
function isStackTopReg(name) { return name === 'ESP' || name === 'RSP'; }
function isStackBaseReg(name) { return name === 'EBP' || name === 'RBP'; }

function stackRoleClass(name) {
  if (isStackTopReg(name)) return 'esp';
  if (isStackBaseReg(name)) return 'ebp';
  return '';
}

function regWidthBytes(name) { return is64() && !isSpReg(name) ? 8 : 4; }
function transferWidth(name = S.reg) { return Math.min(sizeN(), regWidthBytes(name)); }

// ─────────────────────────────────────────────────────────
// REGISTER PARTS  (lo/hi 32-bit halves of a 64-bit register)
// ─────────────────────────────────────────────────────────
const REG64_PARTS = {
  RAX: { lo: 'EAX', hi: 'RAX_hi' },
  RBX: { lo: 'EBX', hi: 'RBX_hi' },
  RCX: { lo: 'ECX', hi: 'RCX_hi' },
  RDX: { lo: 'EDX', hi: 'RDX_hi' },
  RSI: { lo: 'ESI', hi: 'RSI_hi' },
  RDI: { lo: 'EDI', hi: 'RDI_hi' },
  R8: { lo: 'R8', hi: 'R8_hi' },
  R9: { lo: 'R9', hi: 'R9_hi' },
  R10: { lo: 'R10', hi: 'R10_hi' },
  R11: { lo: 'R11', hi: 'R11_hi' },
  R12: { lo: 'R12', hi: 'R12_hi' },
  R13: { lo: 'R13', hi: 'R13_hi' },
  R14: { lo: 'R14', hi: 'R14_hi' },
  R15: { lo: 'R15', hi: 'R15_hi' },
};

function regParts(name) {
  if (is64()) {
    if (name === 'RSP') return { lo: S.regs.ESP >>> 0, hi: 0 };
    if (name === 'RBP') return { lo: S.regs.EBP >>> 0, hi: 0 };
    const meta = REG64_PARTS[name];
    if (meta) return { lo: (S.regs[meta.lo] || 0) >>> 0, hi: (S.regs[meta.hi] || 0) >>> 0 };
  }
  return { lo: (S.regs[name] || 0) >>> 0, hi: 0 };
}

function setRegParts(name, lo, hi = 0, opts = {}) {
  lo >>>= 0;
  hi >>>= 0;
  const track = opts.track !== false;
  const stackLo = clamp(lo, 0, Math.max(S.stackSize, 0));
  if (is64()) {
    if (name === 'RSP') { S.regs.ESP = stackLo; if (track) markRegistersChanged(name); return; }
    if (name === 'RBP') { S.regs.EBP = stackLo; if (track) markRegistersChanged(name); return; }
    const meta = REG64_PARTS[name];
    if (meta) {
      S.regs[meta.lo] = lo;
      S.regs[meta.hi] = hi;
      if (track) markRegistersChanged(name);
      return;
    }
  }
  S.regs[name] = (name === 'ESP' || name === 'EBP') ? stackLo : lo;
  if (track) markRegistersChanged(name);
}

// ─────────────────────────────────────────────────────────
// REGISTER READ / WRITE
// ─────────────────────────────────────────────────────────
function getReg(name) {
  touchReg(name);
  if (is64()) {
    if (name === 'RSP') return S.regs.ESP;
    if (name === 'RBP') return S.regs.EBP;
    const meta = REG64_PARTS[name];
    if (meta) return S.regs[meta.lo]; // display only lo32
    if (/^R\d+$/.test(name)) return S.regs[name] || 0;
  }
  return S.regs[name] || 0;
}

function setReg(name, val32, opts = {}) {
  val32 = val32 >>> 0;
  const track = opts.track !== false;
  const stackVal = clamp(val32, 0, Math.max(S.stackSize, 0));
  if (is64()) {
    if (name === 'RSP') { S.regs.ESP = stackVal; if (track) markRegistersChanged(name); return; }
    if (name === 'RBP') { S.regs.EBP = stackVal; if (track) markRegistersChanged(name); return; }
    const meta = REG64_PARTS[name];
    if (meta) { setRegParts(name, val32, 0, opts); return; }
    if (/^R\d+$/.test(name)) { setRegParts(name, val32, 0, opts); return; }
  }
  S.regs[name] = (name === 'ESP' || name === 'EBP') ? stackVal : val32;
  if (track) markRegistersChanged(name);
}

function regHex(name) {
  const { lo, hi } = regParts(name);
  return regWidthBytes(name) === 8 ? hex64(hi, lo) : hex32(lo);
}

function regBytes(name, count = transferWidth(name)) {
  const { lo, hi } = regParts(name);
  const bytes = [];
  for (let i = 0; i < 4; i++) bytes.push((lo >>> (i * 8)) & 0xFF);
  for (let i = 0; i < 4; i++) bytes.push((hi >>> (i * 8)) & 0xFF);
  return bytes.slice(0, count);
}

function setRegFromBytes(name, littleBytes, opts = {}) {
  let lo = 0, hi = 0;
  const limit = Math.min(littleBytes.length, regWidthBytes(name));
  for (let i = 0; i < Math.min(limit, 4); i++) lo |= (littleBytes[i] & 0xFF) << (i * 8);
  for (let i = 4; i < Math.min(limit, 8); i++) hi |= (littleBytes[i] & 0xFF) << ((i - 4) * 8);
  setRegParts(name, lo >>> 0, hi >>> 0, opts);
}

// ─────────────────────────────────────────────────────────
// DISPLAY POSITIONING  (for byte-strip animation)
// ─────────────────────────────────────────────────────────
function displayTransferStart(name = S.reg, count = transferWidth(name)) {
  return regWidthBytes(name) - Math.min(count, regWidthBytes(name));
}

function displayPosForTransferByte(name, byteIdx, count = transferWidth(name)) {
  const total = regWidthBytes(name);
  const start = displayTransferStart(name, count);
  return S.endian === 'little' ? (total - 1 - byteIdx) : (start + byteIdx);
}

// ─────────────────────────────────────────────────────────
// CHANGE TRACKING  (CSS highlight for modified registers)
// ─────────────────────────────────────────────────────────
function touchReg(name) {
  if (!S.trackRegAccess) return;
  S.lastTouchedReg = name;
}

function markRegistersChanged(...names) {
  const flat = names.flat();
  S.changedRegs = [...new Set([...S.changedRegs, ...flat])];
  if (flat.length > 0) touchReg(flat[flat.length - 1]);
}

function clearChangedRegisters() {
  S.changedRegs = [];
}


// ─────────────────────────────────────────────────────────
// RESET
// ─────────────────────────────────────────────────────────
function resetCoreRegisters() {
  S.changedRegs = [];
  S.regs.EAX = 0; S.regs.EBX = 0; S.regs.ECX = 0; S.regs.EDX = 0;
  S.regs.ESI = 0; S.regs.EDI = 0;
  S.regs.RAX_hi = 0; S.regs.RBX_hi = 0; S.regs.RCX_hi = 0; S.regs.RDX_hi = 0;
  S.regs.RSI_hi = 0; S.regs.RDI_hi = 0;
  S.regs.R8 = 0; S.regs.R8_hi = 0;
  S.regs.R9 = 0; S.regs.R9_hi = 0;
  S.regs.R10 = 0; S.regs.R10_hi = 0;
  S.regs.R11 = 0; S.regs.R11_hi = 0;
  S.regs.R12 = 0; S.regs.R12_hi = 0;
  S.regs.R13 = 0; S.regs.R13_hi = 0;
  S.regs.R14 = 0; S.regs.R14_hi = 0;
  S.regs.R15 = 0; S.regs.R15_hi = 0;
}

function resetStatsState() {
  S.stats = {
    ops: 0, totalTime: 0, loads: 0, stores: 0,
    loadTimes: [], storeTimes: [], littleOps: 0, bigOps: 0
  };
}
