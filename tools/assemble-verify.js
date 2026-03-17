#!/usr/bin/env node
/**
 * assemble-verify.js
 *
 * Assembles two small x86 programs (IA-32 and x64) from scratch,
 * patches all CALL rel32 and JMP rel8 offsets, then verifies:
 *   - every encoded offset matches the expected arithmetic value
 *   - total byte count fits within 64 bytes
 *
 * IA-32 encoding rules used
 * ─────────────────────────
 *  MOV r32, imm32     0xB8+rd  imm32-LE              (5 B)
 *  MOV r/m32, r32     0x89     ModRM=0xC0|(src<<3)|dst (2 B)
 *  PUSH r/m32         0xFF     ModRM=0xF0|reg          (2 B)
 *  POP  r/m32         0x8F     ModRM=0xC0|reg          (2 B)
 *  CALL rel32         0xE8     rel32-LE                (5 B)
 *  JMP  rel8          0xEB     rel8                    (2 B)
 *  RET                0xC3                             (1 B)
 *  HLT                0xF4                             (1 B)
 *
 * x64 additions
 * ─────────────
 *  MOV r64, imm64     REX.W(0x48) 0xB8+rd imm64-LE   (10 B)
 *  MOV r/m64, r64     REX.W(0x48) 0x89    ModRM       (3 B)
 *  PUSH/POP r64       same opcodes as IA-32, 64-bit default mode (2 B each)
 *
 * Register indices (shared by both modes)
 *   RAX/EAX=0  RCX/ECX=1  RDX/EDX=2  RBX/EBX=3
 *   RSP/ESP=4  RBP/EBP=5  RSI/ESI=6  RDI/EDI=7
 *
 * ── Program layouts ──────────────────────────────────────────────────────
 *
 * IA-32 (63 bytes, fits in 64)
 * ────────────────────────────
 *  main:
 *   0000  MOV EAX, 0xAABBCCDD        (5)
 *   0005  MOV EBX, 0x11223344        (5)
 *   000A  CALL sub1                  (5)  → sub1 @ 0x001C  offset=0x0D
 *   000F  PUSH EAX                   (2)
 *   0011  MOV EAX, EBX               (2)  89 D8
 *   0013  CALL sub2                  (5)  → sub2 @ 0x0027  offset=0x0F
 *   0018  POP ECX                    (2)
 *   001A  JMP sub3                   (2)  → sub3 @ 0x0036  offset=0x1A
 *
 *  sub1 @ 001C  (11 bytes)
 *   001C  PUSH EBP                   (2)
 *   001E  MOV EBP, ESP               (2)  89 E5
 *   0020  PUSH EAX                   (2)
 *   0022  POP ECX                    (2)
 *   0024  POP EBP                    (2)
 *   0026  RET                        (1)
 *
 *  sub2 @ 0027  (15 bytes)
 *   0027  PUSH EBP                   (2)
 *   0029  MOV EBP, ESP               (2)
 *   002B  PUSH EAX                   (2)
 *   002D  PUSH EBX                   (2)
 *   002F  POP EDX                    (2)
 *   0031  POP ECX                    (2)
 *   0033  POP EBP                    (2)
 *   0035  RET                        (1)
 *
 *  sub3 @ 0036  (9 bytes, ends with HLT)
 *   0036  PUSH EBP                   (2)
 *   0038  MOV EBP, ESP               (2)
 *   003A  PUSH ECX                   (2)
 *   003C  POP EDX                    (2)
 *   003E  HLT                        (1)
 *
 * x64 (63 bytes, fits in 64)
 * ──────────────────────────
 *  main:
 *   0000  MOV RCX, 0x00000000AABBCCDD (10)
 *   000A  CALL sub1                   (5)  → sub1 @ 0x001D  offset=0x0E
 *   000F  PUSH RAX                    (2)
 *   0011  MOV RAX, RCX               (3)  48 89 C8
 *   0014  CALL sub2                   (5)  → sub2 @ 0x0029  offset=0x10
 *   0019  POP RBX                     (2)
 *   001B  JMP sub3                    (2)  → sub3 @ 0x0035  offset=0x18
 *
 *  sub1 @ 001D  (12 bytes)
 *   001D  PUSH RBP                   (2)
 *   001F  MOV RBP, RSP               (3)  48 89 E5
 *   0022  PUSH RCX                   (2)
 *   0024  POP RAX                    (2)
 *   0026  POP RBP                    (2)
 *   0028  RET                        (1)
 *
 *  sub2 @ 0029  (12 bytes)
 *   0029  PUSH RBP                   (2)
 *   002B  MOV RBP, RSP               (3)
 *   002E  PUSH RAX                   (2)
 *   0030  POP RSI                    (2)
 *   0032  POP RBP                    (2)
 *   0034  RET                        (1)
 *
 *  sub3 @ 0035  (10 bytes, ends with HLT)
 *   0035  PUSH RBP                   (2)
 *   0037  MOV RBP, RSP               (3)
 *   003A  PUSH RBX                   (2)
 *   003C  POP RDI                    (2)
 *   003E  HLT                        (1)
 */

'use strict';

// ── low-level byte helpers ────────────────────────────────────────────────────

/** Little-endian 32-bit integer → 4-byte array */
function le32(n) {
  const u = n >>> 0;
  return [u & 0xFF, (u >> 8) & 0xFF, (u >> 16) & 0xFF, (u >> 24) & 0xFF];
}

/**
 * Little-endian 64-bit integer → 8-byte array.
 * Accepts a JS Number; upper 32 bits are assumed zero (values ≤ 0xFFFFFFFF).
 */
function le64(n) {
  const lo = n >>> 0;
  return [
    lo & 0xFF, (lo >> 8) & 0xFF, (lo >> 16) & 0xFF, (lo >> 24) & 0xFF,
    0, 0, 0, 0,
  ];
}

/** Read a signed little-endian 32-bit integer from a byte array at pos */
function readLE32(bytes, pos) {
  return (bytes[pos]
        | (bytes[pos + 1] << 8)
        | (bytes[pos + 2] << 16)
        | (bytes[pos + 3] << 24)) | 0;   // keep sign
}

// ── IA-32 assembler ───────────────────────────────────────────────────────────

/**
 * Assembles the IA-32 program described in the file header.
 * Returns { bytes, patchPoints } where patchPoints maps symbolic names to the
 * byte positions of their encoded offsets (so verify() can read them back).
 */
function assembleIA32() {
  const bytes = [];

  // push arbitrary bytes
  const emit = (...bs) => bs.forEach(b => bytes.push(b & 0xFF));

  // ── encoding helpers ──────────────────────────────────────────────────────

  /** MOV r32, imm32  (opcode 0xB8+rd) */
  const movReg32Imm32 = (reg, imm) => emit(0xB8 | reg, ...le32(imm));

  /** MOV r/m32, r32  (89 /r, mod=11) */
  const movRM32R32 = (dst, reg) => emit(0x89, 0xC0 | (reg << 3) | dst);

  /** PUSH r/m32  (FF /6) */
  const pushReg32 = (reg) => emit(0xFF, 0xF0 | reg);

  /** POP r/m32  (8F /0) */
  const popReg32 = (reg) => emit(0x8F, 0xC0 | reg);

  /**
   * CALL rel32  (E8 id)
   * Emits a placeholder offset of 0; caller must patch afterwards.
   * Returns the byte position of the 4-byte offset field.
   */
  const callRel32Placeholder = () => {
    const offsetPos = bytes.length + 1; // offset field starts after opcode
    emit(0xE8, 0, 0, 0, 0);
    return offsetPos;
  };

  /**
   * JMP rel8  (EB cb)
   * Emits placeholder; returns byte position of the offset byte.
   */
  const jmpRel8Placeholder = () => {
    const offsetPos = bytes.length + 1;
    emit(0xEB, 0);
    return offsetPos;
  };

  const ret = () => emit(0xC3);
  const hlt = () => emit(0xF4);

  // Register indices
  const EAX = 0, ECX = 1, EDX = 2, EBX = 3, ESP = 4, EBP = 5;

  // ── main (0x0000) ─────────────────────────────────────────────────────────

  movReg32Imm32(EAX, 0xAABBCCDD);           // 0000  B8 DD CC BB AA
  movReg32Imm32(EBX, 0x11223344);           // 0005  BB 44 33 22 11

  const call1InstrPos = bytes.length;       // 000A
  const call1OffPos   = callRel32Placeholder();  // E8 ?? ?? ?? ??

  pushReg32(EAX);                           // 000F  FF F0
  movRM32R32(EAX, EBX);                     // 0011  89 D8  (src=EBX=3, dst=EAX=0)

  const call2InstrPos = bytes.length;       // 0013
  const call2OffPos   = callRel32Placeholder();

  popReg32(ECX);                            // 0018  8F C1

  const jmpInstrPos = bytes.length;         // 001A
  const jmpOffPos   = jmpRel8Placeholder();

  // ── sub1 (0x001C) ─────────────────────────────────────────────────────────

  const sub1 = bytes.length;               // expected: 0x001C
  pushReg32(EBP);                           // FF F5
  movRM32R32(EBP, ESP);                     // 89 E5  (src=ESP=4, dst=EBP=5)
  pushReg32(EAX);                           // FF F0
  popReg32(ECX);                            // 8F C1
  popReg32(EBP);                            // 8F C5
  ret();                                    // C3

  // ── sub2 (0x0027) ─────────────────────────────────────────────────────────

  const sub2 = bytes.length;               // expected: 0x0027
  pushReg32(EBP);
  movRM32R32(EBP, ESP);
  pushReg32(EAX);
  pushReg32(EBX);
  popReg32(EDX);                            // 8F C2  (stack-top = last pushed = EBX value)
  popReg32(ECX);                            // 8F C1  (next = EAX value)
  popReg32(EBP);                            // epilogue
  ret();

  // ── sub3 (0x0036) ─────────────────────────────────────────────────────────

  const sub3 = bytes.length;               // expected: 0x0036
  pushReg32(EBP);
  movRM32R32(EBP, ESP);
  pushReg32(ECX);
  popReg32(EDX);
  hlt();                                    // no epilogue needed before HLT

  // ── patch CALL/JMP offsets ────────────────────────────────────────────────

  // CALL rel32: offset = target - (instrAddr + 5)
  const off1 = sub1 - (call1InstrPos + 5);
  const off2 = sub2 - (call2InstrPos + 5);
  le32(off1).forEach((b, i) => { bytes[call1OffPos + i] = b; });
  le32(off2).forEach((b, i) => { bytes[call2OffPos + i] = b; });

  // JMP rel8: offset = target - (instrAddr + 2), must fit in signed byte
  const offJ = sub3 - (jmpInstrPos + 2);
  if (offJ < -128 || offJ > 127) {
    throw new Error(`IA-32 JMP rel8 offset ${offJ} does not fit in a signed byte`);
  }
  bytes[jmpOffPos] = offJ & 0xFF;

  return {
    bytes,
    sub1, sub2, sub3,
    call1InstrPos, call1OffPos,
    call2InstrPos, call2OffPos,
    jmpInstrPos,   jmpOffPos,
  };
}

// ── x64 assembler ─────────────────────────────────────────────────────────────

/**
 * Assembles the x64 program described in the file header.
 *
 * Trimming strategy to stay inside 64 bytes:
 *   The naive layout (one 10-byte MOV + three subs with full prologue/body)
 *   totals 67 bytes.  The three cuts that bring it to 63 bytes:
 *     1. sub2 body: use a single PUSH RAX / POP RSI pair instead of two pairs
 *        (saves 4 bytes: removes PUSH RCX + POP RSI from the original sub2).
 *   This keeps the structure representative while fitting the constraint.
 */
function assembleX64() {
  const bytes = [];
  const emit  = (...bs) => bs.forEach(b => bytes.push(b & 0xFF));

  // ── encoding helpers ──────────────────────────────────────────────────────

  /** MOV r64, imm64  (REX.W 0xB8+rd imm64-LE, 10 bytes) */
  const movReg64Imm64 = (reg, imm) => emit(0x48, 0xB8 | reg, ...le64(imm));

  /** MOV r/m64, r64  (REX.W 0x89 ModRM, 3 bytes) */
  const movRM64R64 = (dst, reg) => emit(0x48, 0x89, 0xC0 | (reg << 3) | dst);

  /** PUSH r64  (FF /6, 2 bytes — 64-bit default operand size in 64-bit mode) */
  const pushReg64 = (reg) => emit(0xFF, 0xF0 | reg);

  /** POP r64  (8F /0, 2 bytes) */
  const popReg64 = (reg) => emit(0x8F, 0xC0 | reg);

  const callRel32Placeholder = () => {
    const offsetPos = bytes.length + 1;
    emit(0xE8, 0, 0, 0, 0);
    return offsetPos;
  };

  const jmpRel8Placeholder = () => {
    const offsetPos = bytes.length + 1;
    emit(0xEB, 0);
    return offsetPos;
  };

  const ret = () => emit(0xC3);
  const hlt = () => emit(0xF4);

  // Register indices (same numbering as IA-32)
  const RAX = 0, RCX = 1, RDX = 2, RBX = 3, RSP = 4, RBP = 5, RSI = 6, RDI = 7;

  // ── main (0x0000) ─────────────────────────────────────────────────────────

  movReg64Imm64(RCX, 0xAABBCCDD);           // 0000  48 B9 DD CC BB AA 00 00 00 00

  const call1InstrPos = bytes.length;        // 000A
  const call1OffPos   = callRel32Placeholder();

  pushReg64(RAX);                            // 000F  FF F0
  movRM64R64(RAX, RCX);                     // 0011  48 89 C8

  const call2InstrPos = bytes.length;        // 0014
  const call2OffPos   = callRel32Placeholder();

  popReg64(RBX);                             // 0019  8F C3

  const jmpInstrPos = bytes.length;          // 001B
  const jmpOffPos   = jmpRel8Placeholder();

  // ── sub1 (0x001D) ─────────────────────────────────────────────────────────

  const sub1 = bytes.length;                // expected: 0x001D
  pushReg64(RBP);                           // FF F5
  movRM64R64(RBP, RSP);                    // 48 89 E5
  pushReg64(RCX);                           // FF F1
  popReg64(RAX);                            // 8F C0
  popReg64(RBP);                            // 8F C5
  ret();                                    // C3

  // ── sub2 (0x0029) ─────────────────────────────────────────────────────────

  const sub2 = bytes.length;               // expected: 0x0029
  pushReg64(RBP);
  movRM64R64(RBP, RSP);
  pushReg64(RAX);
  popReg64(RSI);                           // 8F C6
  popReg64(RBP);
  ret();

  // ── sub3 (0x0035) ─────────────────────────────────────────────────────────

  const sub3 = bytes.length;               // expected: 0x0035
  pushReg64(RBP);
  movRM64R64(RBP, RSP);
  pushReg64(RBX);                          // FF F3
  popReg64(RDI);                           // 8F C7
  hlt();

  // ── patch ────────────────────────────────────────────────────────────────

  const off1 = sub1 - (call1InstrPos + 5);
  const off2 = sub2 - (call2InstrPos + 5);
  le32(off1).forEach((b, i) => { bytes[call1OffPos + i] = b; });
  le32(off2).forEach((b, i) => { bytes[call2OffPos + i] = b; });

  const offJ = sub3 - (jmpInstrPos + 2);
  if (offJ < -128 || offJ > 127) {
    throw new Error(`x64 JMP rel8 offset ${offJ} does not fit in a signed byte`);
  }
  bytes[jmpOffPos] = offJ & 0xFF;

  return {
    bytes,
    sub1, sub2, sub3,
    call1InstrPos, call1OffPos,
    call2InstrPos, call2OffPos,
    jmpInstrPos,   jmpOffPos,
  };
}

// ── verification ──────────────────────────────────────────────────────────────

/**
 * Verifies that:
 *   (a) all three encoded offsets match the expected arithmetic values
 *   (b) total size is at most 64 bytes
 *
 * Returns true if all checks pass.
 */
function verify(label, asm) {
  const {
    bytes,
    sub1, sub2, sub3,
    call1InstrPos, call1OffPos,
    call2InstrPos, call2OffPos,
    jmpInstrPos,   jmpOffPos,
  } = asm;

  let allPass = true;

  const check = (desc, encoded, expected) => {
    const pass = encoded === expected;
    if (!pass) allPass = false;
    const status = pass ? 'PASS' : `FAIL (got 0x${encoded.toString(16)}, want 0x${expected.toString(16)})`;
    console.log(`    ${desc.padEnd(48)} ${status}`);
  };

  console.log(`\n${'─'.repeat(66)}`);
  console.log(` ${label}`);
  console.log('─'.repeat(66));

  // size check
  const sizeOk = bytes.length <= 64;
  if (!sizeOk) allPass = false;
  console.log(`  Total size : ${bytes.length} bytes  ${sizeOk ? '(FITS in 64 B)' : '(EXCEEDS 64 B -- FAIL)'}`);

  // sub addresses
  console.log(`  sub1 addr  : 0x${sub1.toString(16).padStart(4, '0')}`);
  console.log(`  sub2 addr  : 0x${sub2.toString(16).padStart(4, '0')}`);
  console.log(`  sub3 addr  : 0x${sub3.toString(16).padStart(4, '0')}`);

  console.log('\n  Offset verification:');

  // CALL sub1
  const enc1 = readLE32(bytes, call1OffPos);
  const exp1 = (sub1 - (call1InstrPos + 5)) | 0;
  check(
    `CALL sub1 @ 0x${call1InstrPos.toString(16).padStart(4,'0')}  rel32=0x${(exp1>>>0).toString(16).padStart(8,'0')}`,
    enc1, exp1
  );

  // CALL sub2
  const enc2 = readLE32(bytes, call2OffPos);
  const exp2 = (sub2 - (call2InstrPos + 5)) | 0;
  check(
    `CALL sub2 @ 0x${call2InstrPos.toString(16).padStart(4,'0')}  rel32=0x${(exp2>>>0).toString(16).padStart(8,'0')}`,
    enc2, exp2
  );

  // JMP sub3
  const encJ = bytes[jmpOffPos];
  const expJ = (sub3 - (jmpInstrPos + 2)) & 0xFF;
  check(
    `JMP  sub3 @ 0x${jmpInstrPos.toString(16).padStart(4,'0')}  rel8 =0x${expJ.toString(16).padStart(2,'0')} (${sub3 - (jmpInstrPos + 2)})`,
    encJ, expJ
  );

  // hex dump with labels
  const symAt = {
    [0]:    'main',
    [sub1]: 'sub1',
    [sub2]: 'sub2',
    [sub3]: 'sub3',
  };

  console.log('\n  Hex dump (8 bytes per row):');
  for (let i = 0; i < bytes.length; i += 8) {
    const rowBytes = bytes.slice(i, i + 8);
    const hex      = rowBytes.map(b => b.toString(16).padStart(2, '0')).join(' ');
    const addr     = '0x' + i.toString(16).padStart(4, '0');
    const tag      = symAt[i] != null ? `  <-- ${symAt[i]}` : '';
    console.log(`    ${addr}:  ${hex.padEnd(23)}${tag}`);
  }

  console.log(`\n  Result: ${allPass ? 'ALL CHECKS PASSED' : 'ONE OR MORE CHECKS FAILED'}`);
  return allPass;
}

// ── main ──────────────────────────────────────────────────────────────────────

console.log('assemble-verify.js — IA-32 and x64 program layout checker');
console.log('='.repeat(66));

let exitCode = 0;

try {
  const ia32Result = assembleIA32();
  const passIA32   = verify('IA-32', ia32Result);
  if (!passIA32) exitCode = 1;
} catch (e) {
  console.error('\nIA-32 assembly error:', e.message);
  exitCode = 1;
}

try {
  const x64Result = assembleX64();
  const passX64   = verify('x64', x64Result);
  if (!passX64) exitCode = 1;
} catch (e) {
  console.error('\nx64 assembly error:', e.message);
  exitCode = 1;
}

console.log('\n' + '='.repeat(66));
console.log(exitCode === 0 ? 'Overall: PASS' : 'Overall: FAIL');
process.exit(exitCode);
