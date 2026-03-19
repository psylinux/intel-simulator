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
// CONSTANTS
// ─────────────────────────────────────────────────────────
const DEFAULT_STACK_SIZE = 100;
const MIN_STACK_SIZE = 1;
const MAX_STACK_SIZE = 1024 * 1024;

// ─────────────────────────────────────────────────────────
// GLOBAL STATE
// ─────────────────────────────────────────────────────────
const S = {
  endian: 'little',
  reg: 'EAX',
  stackMode: 'full',
  stackGranularity: 'dword', // 'byte' | 'word' | 'dword' | 'qword'
  stackSize: DEFAULT_STACK_SIZE,
  stackSizeInputUnit: 'B',
  changedRegs: [],
  lastTouchedReg: null,
  trackRegAccess: false,
  sidebarPanelWidth: 240,
  sidebarPanelManual: false,
  stackPanelWidth: 280,
  stackPanelManual: false,
  codeMemSplitWidth: 0,
  codeMemSplitManual: false,
  centerPaneHeights: {},
  collapsedSections: {},
  speed: 2500,
  memViewBase: 0,
  busy: false,
  logIndent: 0,
  arch: 'ia32',   // 'ia32' | 'x64'
  regs: {
    // IA-32 / x64 general-purpose (low 32-bit names always present)
    EAX: 0xDEADBEEF, EBX: 0xCAFEBABE, ECX: 0x12345678, EDX: 0xABCD1234,
    ESI: 0x00000000, EDI: 0x00000000,
    // 64-bit extensions (upper 32 bits; value = full 64-bit hi word)
    RAX_hi: 0, RBX_hi: 0, RCX_hi: 0, RDX_hi: 0,
    RSI_hi: 0, RDI_hi: 0,
    // x64-only registers R8-R15 (stored as two 32-bit halves)
    R8: 0x00000000, R8_hi: 0,
    R9: 0x00000000, R9_hi: 0,
    R10: 0x00000000, R10_hi: 0,
    R11: 0x00000000, R11_hi: 0,
    R12: 0x00000000, R12_hi: 0,
    R13: 0x00000000, R13_hi: 0,
    R14: 0x00000000, R14_hi: 0,
    R15: 0x00000000, R15_hi: 0,
    // Stack pointers
    ESP: DEFAULT_STACK_SIZE,
    EBP: DEFAULT_STACK_SIZE,
  },
  stackMem: new Uint8Array(DEFAULT_STACK_SIZE),
  stackState: new Map(),
  mem: new Uint8Array(64),
  memState: new Array(64).fill(''),
  stats: {
    ops: 0, totalTime: 0, loads: 0, stores: 0,
    loadTimes: [], storeTimes: [], littleOps: 0, bigOps: 0,
  },
  pc: 0,
  halt: false,    // HLT foi executado (instrução HLT)
  stopped: false, // STOP pressionado pelo usuário (não bloqueia STEP)
  faulted: false,
  progRunning: false,
  paused: false,
  callFrames: [],
  history: [],
  historyMax: 100,
  breakpoints: new Set(),
  breakpointHit: null,   // endereço do último breakpoint atingido (null = nenhum)
};

// ─────────────────────────────────────────────────────────
// CENTER PANE LAYOUT CONFIGURATION
// ─────────────────────────────────────────────────────────
const CENTER_PANE_CONFIG = {
  codeMemRow: { initial: 360, min: 220, max: 680 },
  logSection: { initial: 242, min: 170, max: 520 },
};

// ─────────────────────────────────────────────────────────
// DEMO PROGRAMS
// ─────────────────────────────────────────────────────────
const DEMO_PROGRAMS = {
  // ─── IA-32 — 63 bytes ────────────────────────────────────────────────────
  // main (0x0000):
  //   MOV EAX, 0xAABBCCDD  — carrega arg1
  //   MOV EBX, 0x11223344  — carrega arg2
  //   CALL sub1            — sub-rotina com prologue/epilogue de frame
  //   PUSH EAX             — preserva resultado de sub1 na stack
  //   MOV EAX, EBX         — prepara arg para sub2
  //   CALL sub2            — sub-rotina com 2× PUSH antes do RET
  //   POP ECX              — recupera resultado de sub1 da stack
  //   JMP sub3             — tail-jump: frame final, termina com HLT
  ia32: {
    name: 'demo_stack_calls_ia32',
    entry: 0x0000,
    bytes: new Uint8Array([
      // ── main ──────────────────────────────────────────────────────
      0xB8, 0xDD, 0xCC, 0xBB, 0xAA,       // 0000  MOV EAX, 0xAABBCCDD
      0xBB, 0x44, 0x33, 0x22, 0x11,       // 0005  MOV EBX, 0x11223344
      0xE8, 0x0D, 0x00, 0x00, 0x00,       // 000A  CALL 0x001C  (off=+0x0D)
      0xFF, 0xF0,                         // 000F  PUSH EAX
      0x89, 0xD8,                         // 0011  MOV EAX, EBX
      0xE8, 0x0F, 0x00, 0x00, 0x00,       // 0013  CALL 0x0027  (off=+0x0F)
      0x8F, 0xC1,                         // 0018  POP ECX
      0xEB, 0x1A,                         // 001A  JMP 0x0036   (off=+0x1A)
      // ── sub1 @ 0x001C ─────────────────────────────────────────────
      0xFF, 0xF5,                         // 001C  PUSH EBP
      0x89, 0xE5,                         // 001E  MOV EBP, ESP
      0xFF, 0xF0,                         // 0020  PUSH EAX
      0x8F, 0xC1,                         // 0022  POP ECX
      0x8F, 0xC5,                         // 0024  POP EBP
      0xC3,                               // 0026  RET
      // ── sub2 @ 0x0027 ─────────────────────────────────────────────
      0xFF, 0xF5,                         // 0027  PUSH EBP
      0x89, 0xE5,                         // 0029  MOV EBP, ESP
      0xFF, 0xF0,                         // 002B  PUSH EAX
      0xFF, 0xF3,                         // 002D  PUSH EBX
      0x8F, 0xC2,                         // 002F  POP EDX
      0x8F, 0xC1,                         // 0031  POP ECX
      0x8F, 0xC5,                         // 0033  POP EBP
      0xC3,                               // 0035  RET
      // ── sub3 @ 0x0036 (via JMP — sem RET, termina com HLT) ────────
      0xFF, 0xF5,                         // 0036  PUSH EBP
      0x89, 0xE5,                         // 0038  MOV EBP, ESP
      0xFF, 0xF1,                         // 003A  PUSH ECX
      0x8F, 0xC2,                         // 003C  POP EDX
      0xF4,                               // 003E  HLT
    ]),
    listing: [
      '0000: MOV EAX, 0xAABBCCDD',
      '0005: MOV EBX, 0x11223344',
      '000A: CALL sub1 (0x001C)',
      '000F: PUSH EAX',
      '0011: MOV EAX, EBX',
      '0013: CALL sub2 (0x0027)',
      '0018: POP ECX',
      '001A: JMP sub3 (0x0036)',
      '001C: [sub1] PUSH EBP / MOV EBP,ESP / PUSH EAX / POP ECX / POP EBP / RET',
      '0027: [sub2] PUSH EBP / MOV EBP,ESP / PUSH EAX / PUSH EBX / POP EDX / POP ECX / POP EBP / RET',
      '0036: [sub3] PUSH EBP / MOV EBP,ESP / PUSH ECX / POP EDX / HLT',
    ],
  },

  // ─── x86-64 — 63 bytes ──────────────────────────────────────────────────
  // main (0x0000):
  //   MOV RCX, 0xAABBCCDD  — carrega arg (imm64, 10 bytes)
  //   CALL sub1            — sub-rotina com prologue/epilogue de frame
  //   PUSH RAX             — preserva resultado de sub1 na stack
  //   MOV RAX, RCX         — prepara arg para sub2 (REX.W + 89, 3 bytes)
  //   CALL sub2            — sub-rotina com PUSH/POP dentro do frame
  //   POP RBX              — recupera resultado de sub1 da stack
  //   JMP sub3             — tail-jump: frame final, termina com HLT
  x64: {
    name: 'demo_stack_calls_x64',
    entry: 0x0000,
    bytes: new Uint8Array([
      // ── main ──────────────────────────────────────────────────────
      0x48, 0xB9, 0xDD, 0xCC, 0xBB, 0xAA, 0x00, 0x00, 0x00, 0x00, // 0000  MOV RCX, 0xAABBCCDD
      0xE8, 0x0E, 0x00, 0x00, 0x00,                               // 000A  CALL 0x001D  (off=+0x0E)
      0xFF, 0xF0,                                                 // 000F  PUSH RAX
      0x48, 0x89, 0xC8,                                           // 0011  MOV RAX, RCX
      0xE8, 0x10, 0x00, 0x00, 0x00,                               // 0014  CALL 0x0029  (off=+0x10)
      0x8F, 0xC3,                                                 // 0019  POP RBX
      0xEB, 0x18,                                                 // 001B  JMP 0x0035   (off=+0x18)
      // ── sub1 @ 0x001D ─────────────────────────────────────────────
      0xFF, 0xF5,                                                 // 001D  PUSH RBP
      0x48, 0x89, 0xE5,                                           // 001F  MOV RBP, RSP
      0xFF, 0xF1,                                                 // 0022  PUSH RCX
      0x8F, 0xC0,                                                 // 0024  POP RAX
      0x8F, 0xC5,                                                 // 0026  POP RBP
      0xC3,                                                       // 0028  RET
      // ── sub2 @ 0x0029 ─────────────────────────────────────────────
      0xFF, 0xF5,                                                 // 0029  PUSH RBP
      0x48, 0x89, 0xE5,                                           // 002B  MOV RBP, RSP
      0xFF, 0xF0,                                                 // 002E  PUSH RAX
      0x8F, 0xC6,                                                 // 0030  POP RSI
      0x8F, 0xC5,                                                 // 0032  POP RBP
      0xC3,                                                       // 0034  RET
      // ── sub3 @ 0x0035 (via JMP — sem RET, termina com HLT) ────────
      0xFF, 0xF5,                                                 // 0035  PUSH RBP
      0x48, 0x89, 0xE5,                                           // 0037  MOV RBP, RSP
      0xFF, 0xF3,                                                 // 003A  PUSH RBX
      0x8F, 0xC7,                                                 // 003C  POP RDI
      0xF4,                                                       // 003E  HLT
    ]),
    listing: [
      '0000: MOV RCX, 0x00000000AABBCCDD',
      '000A: CALL sub1 (0x001D)',
      '000F: PUSH RAX',
      '0011: MOV RAX, RCX',
      '0014: CALL sub2 (0x0029)',
      '0019: POP RBX',
      '001B: JMP sub3 (0x0035)',
      '001D: [sub1] PUSH RBP / MOV RBP,RSP / PUSH RCX / POP RAX / POP RBP / RET',
      '0029: [sub2] PUSH RBP / MOV RBP,RSP / PUSH RAX / POP RSI / POP RBP / RET',
      '0035: [sub3] PUSH RBP / MOV RBP,RSP / PUSH RBX / POP RDI / HLT',
    ],
  },
};

// Retorna o programa demo para a arquitetura atual (ou a especificada)
const demoProgramForArch = (arch = S.arch) => DEMO_PROGRAMS[arch === 'x64' ? 'x64' : 'ia32'];
