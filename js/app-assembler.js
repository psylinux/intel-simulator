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
// X86 SUBSET — opcode table, decoder, assembler, executor
// ─────────────────────────────────────────────────────────

// Reg encoding: index → name
const REG32 = ['EAX', 'ECX', 'EDX', 'EBX', 'ESP', 'EBP', 'ESI', 'EDI'];
const REG64 = ['RAX', 'RCX', 'RDX', 'RBX', 'RSP', 'RBP', 'RSI', 'RDI'];
// R8-R15 (REX.B/REX.R extension)
const REG64X = ['R8', 'R9', 'R10', 'R11', 'R12', 'R13', 'R14', 'R15'];

// Current reg table for decoder/assembler
function regName(idx, rex_ext) {
  if (is64()) return rex_ext ? REG64X[idx & 7] : REG64[idx & 7];
  return REG32[idx & 7];
}
function operandRegName(idx, rex_ext, wide) {
  if (!is64()) return REG32[idx & 7];
  if (rex_ext) return REG64X[idx & 7];
  return wide ? REG64[idx & 7] : REG32[idx & 7];
}

// Opcode table: byte → { mnem, size (bytes total), decode(mem, pc) }
// Supported subset:
//   0x90        NOP
//   0xF4        HLT
//   0xC3        RET
//   0xE8 rel32  CALL near
//   0xB8+r imm32  MOV r32, imm32   (B8..BF)
//   0x89 /r     MOV r/m32, r32    (ModRM: mod=11 → reg-reg; mod=00 disp=addr8 → [addr], reg)
//   0x8B /r     MOV r32, r/m32
//   0xFF /6     PUSH r/m32        (ModRM mod=11)
//   0x8F /0     POP r/m32         (ModRM mod=11)
//   0xEB rel8   JMP short
//   0xEB 0x00   used as NOP-jump (rel=0 → pc+2)
const OPMAP = {
  0x90: { mnem: 'NOP', size: 1 },
  0xF4: { mnem: 'HLT', size: 1 },
  0xC3: { mnem: 'RET', size: 1 },
  0xE8: { mnem: 'CALL', size: 5 },
  0x89: { mnem: 'MOV', size: 3 },   // MOV [r/m32], r32  (mod=11 or mod=00+addr)
  0x8B: { mnem: 'MOV', size: 3 },   // MOV r32, [r/m32]
  0xFF: { mnem: 'PUSH', size: 2 },   // PUSH r/m32 (mod=11)
  0x8F: { mnem: 'POP', size: 2 },   // POP r/m32 (mod=11)
  0xEB: { mnem: 'JMP SHORT', size: 2 },
};
// B8..BF: MOV r32, imm32
for (let i = 0; i < 8; i++) OPMAP[0xB8 + i] = { mnem: 'MOV', size: 5, regIdx: i };

function decodeAt(pc) {
  let off = 0;
  let rex = 0;
  const byte0 = S.mem[pc & 0x3F];

  // REX prefix (0x40–0x4F) — only meaningful in x64 mode
  if (is64() && byte0 >= 0x40 && byte0 <= 0x4F) {
    rex = byte0;
    off = 1;
  }
  const rex_w = !!(rex & 0x08);  // 64-bit operand size (unused in our 32-bit sim, but decoded)
  const rex_r = !!(rex & 0x04);  // extends ModRM.reg field
  const rex_b = !!(rex & 0x01);  // extends ModRM.rm or opcode reg field

  const op = S.mem[(pc + off) & 0x3F];
  const rexPfx = rex ? `REX.${rex_w ? 'W' : ''}${rex_r ? 'R' : ''}${rex_b ? 'B' : ''} ` : '';

  // Helpers
  const spName = is64() ? 'RSP' : 'ESP';
  const spKey = 'ESP';  // S.regs key is always ESP
  const faultInstr = (size, detail, asmText = null, opts = {}) => {
    const total = Math.max(off + size, 1);
    return {
      op,
      mnem: opts.mnem || 'DECODE ERROR',
      size: total,
      asm: asmText || `; ${detail}`,
      exec: () => { },
      unknown: !!opts.unknown,
      decodeError: !opts.unknown,
      errorDetail: detail,
      errorAddrs: Array.from({ length: total }, (_, i) => (pc + i) & 0x3F),
    };
  };
  const unknownOpcodeInstr = () => faultInstr(
    1,
    `Opcode invalido em 0x${fmtA(pc)}: 0x${hex8(op)} nao pertence ao subset Intel implementado pelo simulador.`,
    `; 0x${hex8(op)} (opcode nao reconhecido)`,
    { mnem: `DB 0x${hex8(op)}`, unknown: true }
  );

  // B8..BF: MOV r32/r64, imm32
  if (op >= 0xB8 && op <= 0xBF) {
    const regIdx = (op - 0xB8) + (rex_b ? 8 : 0);
    const reg = operandRegName(regIdx & 7, rex_b, rex_w);
    const base = pc + off + 1;
    if (rex_w) {
      const bytes = [];
      for (let i = 0; i < 8; i++) bytes.push(S.mem[(base + i) & 0x3F]);
      let lo = 0;
      let hi = 0;
      for (let i = 0; i < 4; i++) lo |= bytes[i] << (i * 8);
      for (let i = 4; i < 8; i++) hi |= bytes[i] << ((i - 4) * 8);
      return {
        op, mnem: `${rexPfx}MOV ${reg}, 0x${hex64(hi >>> 0, lo >>> 0)}`, size: off + 9,
        asm: `MOV ${reg}, 0x${hex64(hi >>> 0, lo >>> 0)}`,
        exec: () => { setRegParts(reg, lo >>> 0, hi >>> 0); updateRegCard(reg); updatePickerVal(reg); updatePickerBytes(reg); }
      };
    }
    const imm = (S.mem[base & 0x3F]) | (S.mem[(base + 1) & 0x3F] << 8) | (S.mem[(base + 2) & 0x3F] << 16) | (S.mem[(base + 3) & 0x3F] << 24);
    const immU = imm >>> 0;
    return {
      op, mnem: `${rexPfx}MOV ${reg}, 0x${hex32(immU)}`, size: off + 5,
      asm: `MOV ${reg}, 0x${hex32(immU)}`,
      exec: () => { setReg(reg, immU); updateRegCard(reg); updatePickerVal(reg); updatePickerBytes(reg); }
    };
  }
  if (op === 0x90) return { op, mnem: 'NOP', size: off + 1, asm: 'NOP', exec: () => { } };
  if (op === 0xF4) return { op, mnem: 'HLT', size: off + 1, asm: 'HLT', exec: () => { S.halt = true; } };
  if (op === 0xC3) return {
    op, mnem: 'RET', size: off + 1, asm: 'RET',
    exec: () => {
      const width = ptrSize();
      const sp = S.regs[spKey] >>> 0;
      if (!stackAccessFits(sp, width)) {
        reportStackBoundsError(`RET em 0x${fmtA(pc)}`, sp, width, 'RET', { halt: true, pc });
        return;
      }
      const bytes = readStackBytes(sp, width);
      let target = 0;
      for (let i = 0; i < Math.min(4, width); i++) target |= (bytes[i] & 0xFF) << (i * 8);
      const expected = S.callFrames[S.callFrames.length - 1];
      const highGarbage = width > 4 && bytes.slice(4).some(b => b !== 0);
      if (expected) {
        const issues = [];
        if (expected.slot !== sp) issues.push(`o topo da pilha esta em 0x${fmtStackA(sp)}, mas o CALL mais recente gravou o retorno em 0x${fmtStackA(expected.slot)}`);
        if ((expected.returnTo & 0x3F) !== (target & 0x3F)) issues.push(`o endereco lido foi 0x${fmtA(target & 0x3F)}, mas o CALL mais recente esperava 0x${fmtA(expected.returnTo & 0x3F)}`);
        if (expected.width !== width) issues.push(`a largura esperada para o retorno era ${expected.width} byte(s), mas o RET leu ${width}`);
        if (highGarbage) issues.push('os bytes altos do endereco de retorno nao estao zerados');
        if (issues.length) {
          reportStackError(`RET corrompido em 0x${fmtA(pc)}: ${issues.join('; ')}.`, 'RET', { halt: true, pc });
          return;
        }
        S.callFrames.pop();
      }
      S.regs[spKey] = S.regs[spKey] + width;
      revealMemRange(sp, width, { select: true });
      updateRegCard(spName);
      updatePickerVal(spName);
      markRegistersChanged(spName);
      setPC(target & 0x3F);
    }
  };
  if (op === 0xE8) {
    const base = pc + off + 1;
    const rel = (
      (S.mem[base & 0x3F]) |
      (S.mem[(base + 1) & 0x3F] << 8) |
      (S.mem[(base + 2) & 0x3F] << 16) |
      (S.mem[(base + 3) & 0x3F] << 24)
    ) >> 0;
    const nextIp = (pc + off + 5) & 0x3F;
    const target = (pc + off + 5 + rel) & 0x3F;
    return {
      op, mnem: `CALL 0x${fmtA(target)}`, size: off + 5, asm: `CALL 0x${fmtA(target)}`,
      exec: () => {
        const width = ptrSize();
        const targetInstr = decodeAt(target);
        if (isInstructionFault(targetInstr)) {
          reportMemoryError(
            [target],
            `CALL corrompido em 0x${fmtA(pc)}: o destino 0x${fmtA(target)} nao aponta para uma instrucao valida no subset atual.`,
            `CALL 0x${fmtA(target)}`,
            { halt: true, pc }
          );
          return;
        }
        const nextSp = S.regs[spKey] - width;
        if (!stackAccessFits(nextSp, width)) {
          reportStackBoundsError(`CALL 0x${fmtA(target)}`, nextSp, width, `CALL 0x${fmtA(target)}`, { halt: true, pc });
          return;
        }
        S.regs[spKey] = nextSp;
        const sp = S.regs[spKey] >>> 0;
        const retBytes = [];
        for (let i = 0; i < width; i++) {
          const byte = i < 4 ? ((nextIp >>> (i * 8)) & 0xFF) : 0;
          retBytes.push(byte);
        }
        writeStackBytes(sp, retBytes);
        revealMemRange(sp, width, { select: true });
        S.callFrames.push({ slot: sp, width, returnTo: nextIp & 0x3F, callSite: pc & 0x3F, target });
        updateRegCard(spName);
        updatePickerVal(spName);
        markRegistersChanged(spName);
        setPC(target);
      }
    };
  }
  if (op === 0xEB) {
    const rel = ((S.mem[(pc + off + 1) & 0x3F]) << 24 >> 24); // signed byte
    const target = (pc + off + 2 + rel) & 0x3F;
    return {
      op, mnem: `JMP SHORT +${rel} → 0x${fmtA(target)}`, size: off + 2, asm: `JMP SHORT 0x${fmtA(target)}`,
      exec: () => { }, jmpTarget: target
    };
  }
  if (op === 0x89 || op === 0x8B) {
    const modrm = S.mem[(pc + off + 1) & 0x3F];
    const mod = (modrm >> 6) & 3, regIdx = (modrm >> 3) & 7, rmIdx = modrm & 7;
    const width = rex_w ? 8 : 4;
    const rName = operandRegName(regIdx, rex_r, rex_w), rmName = operandRegName(rmIdx, rex_b, rex_w);
    const dPtr = width === 8 ? 'QWORD PTR' : 'DWORD PTR';
    if (mod === 3) {
      if (op === 0x89) return {
        op, mnem: `${rexPfx}MOV ${rmName}, ${rName}`, size: off + 2, asm: `MOV ${rmName}, ${rName}`,
        exec: () => {
          if (width === 8) {
            const { lo, hi } = regParts(rName);
            setRegParts(rmName, lo, hi);
          } else {
            setReg(rmName, getReg(rName));
          }
          updateRegCard(rmName); updatePickerVal(rmName); updatePickerBytes(rmName);
        }
      };
      else return {
        op, mnem: `${rexPfx}MOV ${rName}, ${rmName}`, size: off + 2, asm: `MOV ${rName}, ${rmName}`,
        exec: () => {
          if (width === 8) {
            const { lo, hi } = regParts(rmName);
            setRegParts(rName, lo, hi);
          } else {
            setReg(rName, getReg(rmName));
          }
          updateRegCard(rName); updatePickerVal(rName); updatePickerBytes(rName);
        }
      };
    }
    if (mod === 0) {
      if (rmIdx !== 0) {
        return faultInstr(
          3,
          `DECODE inconsistente em 0x${fmtA(pc)}: o subset atual aceita MOV com memoria apenas no formato absoluto [disp8], codificado com rm=000. Foi lido rm=${rmIdx}.`,
          `; MOV /r com rm=${rmIdx} nao suportado`
        );
      }
      const addr = S.mem[(pc + off + 2) & 0x3F] & 0x3F;
      if (op === 0x89) return {
        op, mnem: `${rexPfx}MOV [0x${fmtA(addr)}], ${rName}`, size: off + 3, asm: `MOV ${dPtr} [0x${fmtA(addr)}], ${rName}`,
        exec: () => {
          if (!mapAccessFits(addr, width)) {
            reportWidthOverflow(`MOV [0x${fmtA(addr)}], ${rName}`, addr, width, `MOV ${dPtr} [0x${fmtA(addr)}], ${rName}`, { halt: true, pc });
            return;
          }
          regBytes(rName, width).forEach((b, i) => writeMem((addr + i) & 0x3F, b, 'mc-written'));
        }
      };
      else return {
        op, mnem: `${rexPfx}MOV ${rName}, [0x${fmtA(addr)}]`, size: off + 3, asm: `MOV ${rName}, ${dPtr} [0x${fmtA(addr)}]`,
        exec: () => {
          if (!mapAccessFits(addr, width)) {
            reportWidthOverflow(`MOV ${rName}, [0x${fmtA(addr)}]`, addr, width, `MOV ${rName}, ${dPtr} [0x${fmtA(addr)}]`, { halt: true, pc });
            return;
          }
          const bytes = []; for (let i = 0; i < width; i++) bytes.push(S.mem[(addr + i) & 0x3F]); setRegFromBytes(rName, bytes); updateRegCard(rName); updatePickerVal(rName); updatePickerBytes(rName);
        }
      };
    }
    return faultInstr(
      2,
      `DECODE inconsistente em 0x${fmtA(pc)}: opcode 0x${hex8(op)} com ModRM mod=${mod} nao e suportado pelo subset atual.`,
      `; MOV /r com mod=${mod} nao suportado`
    );
  }
  if (op === 0xFF) { // PUSH
    const modrm = S.mem[(pc + off + 1) & 0x3F];
    const mod = (modrm >> 6) & 3, subop = (modrm >> 3) & 7, rmIdx = modrm & 7;
    if (subop !== 6) {
      return faultInstr(
        2,
        `DECODE inconsistente em 0x${fmtA(pc)}: opcode 0xFF exige ModRM /6 para PUSH, mas foi lido /${subop}.`,
        `; FF /${subop} nao corresponde a PUSH`
      );
    }
    if (mod === 3) {
      const rn = regName(rmIdx, rex_b); return {
        op, mnem: `${rexPfx}PUSH ${rn}`, size: off + 2, asm: `PUSH ${rn}`,
        exec: () => {
          const width = ptrSize();
          const nextSp = S.regs[spKey] - width;
          if (!stackAccessFits(nextSp, width)) {
            reportStackBoundsError(`PUSH ${rn}`, nextSp, width, `PUSH ${rn}`, { halt: true, pc });
            return;
          }
          S.regs[spKey] = nextSp;
          writeStackBytes(S.regs[spKey], regBytes(rn, width));
          revealMemRange(S.regs[spKey], width, { select: true });
          updateRegCard(spName); updatePickerVal(spName);
          markRegistersChanged(spName);
        }
      };
    }
    return faultInstr(
      2,
      `DECODE inconsistente em 0x${fmtA(pc)}: o subset atual aceita PUSH apenas com registrador (ModRM mod=11), mas foi lido mod=${mod}.`,
      `; PUSH com mod=${mod} nao suportado`
    );
  }
  if (op === 0x8F) { // POP
    const modrm = S.mem[(pc + off + 1) & 0x3F];
    const mod = (modrm >> 6) & 3, subop = (modrm >> 3) & 7, rmIdx = modrm & 7;
    if (subop !== 0) {
      return faultInstr(
        2,
        `DECODE inconsistente em 0x${fmtA(pc)}: opcode 0x8F exige ModRM /0 para POP, mas foi lido /${subop}.`,
        `; 8F /${subop} nao corresponde a POP`
      );
    }
    if (mod === 3) {
      const rn = regName(rmIdx, rex_b); return {
        op, mnem: `${rexPfx}POP ${rn}`, size: off + 2, asm: `POP ${rn}`,
        exec: () => {
          const width = ptrSize();
          const sp = S.regs[spKey] >>> 0;
          if (!stackAccessFits(sp, width)) {
            reportStackBoundsError(`POP ${rn}`, sp, width, `POP ${rn}`, { halt: true, pc });
            return;
          }
          const bytes = readStackBytes(sp, width);
          revealMemRange(sp, width, { select: true });
          setRegFromBytes(rn, bytes);
          S.regs[spKey] = S.regs[spKey] + width;
          updateRegCard(rn); updateRegCard(spName); updatePickerVal(rn); updatePickerVal(spName); updatePickerBytes(rn);
          markRegistersChanged([rn, spName]);
        }
      };
    }
    return faultInstr(
      2,
      `DECODE inconsistente em 0x${fmtA(pc)}: o subset atual aceita POP apenas com registrador (ModRM mod=11), mas foi lido mod=${mod}.`,
      `; POP com mod=${mod} nao suportado`
    );
  }
  return unknownOpcodeInstr();
}

// ─────────────────────────────────────────────────────────
// FETCH + DECODE (novo — mostra opcode e mnemônico)
// ─────────────────────────────────────────────────────────
async function doFetch() {
  if (S.busy) return;
  clearFaultLatch();
  S.busy = true; setBusy(true);
  const addr = S.pc;                    // IP aponta para a instrução
  const instr = decodeAt(addr);

  // ── FASE 1: FETCH ──────────────────────────────────────
  // Lê bytes da memória → Instruction Register (IR)
  // O IP é incrementado IMEDIATAMENTE para além dos bytes lidos
  // (Intel SDM Vol.1 §6.3: "The EIP register is incremented after each
  //  instruction fetch to point to the next sequential instruction")
  const np = (addr + instr.size) & 0x3F;   // novo PC = endereço pós-instrução
  setStatus(t('status.fetch1', fmtA(addr), instr.size), 'lbl-fetch');
  for (let i = 0; i < instr.size; i++) { const ma = (addr + i) & 0x3F; setMemSt(ma, 'mc-pc'); }
  lg('info', t('log.info.fetch1', fmtA(addr), hex8(instr.op), instr.size));
  await sleep(S.speed * 0.4);

  // IP avança durante o fetch (antes do decode/execute)
  setPC(np, { traceAutoScroll: true });
  setStatus(t('status.fetch2', fmtA(np)), 'lbl-fetch');
  lg('info', t('log.info.fetch2', fmtA(np)));
  await sleep(S.speed * 0.25);

  // ── FASE 2: DECODE ─────────────────────────────────────
  // Decodifica o conteúdo do IR
  setStatus(t('status.decode', instr.mnem), 'lbl-fetch');
  lg('info', t('log.info.decode', instr.mnem), instr.asm);
  if (isInstructionFault(instr)) {
    reportMemoryError(
      instr.errorAddrs || [addr],
      instr.errorDetail || `Falha de decode em 0x${fmtA(addr)}.`,
      instr.asm,
      { pc: addr }
    );
    S.busy = false; setBusy(false);
    return;
  }
  await sleep(S.speed * 0.35);

  for (let i = 0; i < instr.size; i++) { const ma = (addr + i) & 0x3F; setMemSt(ma, S.memState[ma] || ''); }
  setStatus(t('status.fetch_decode_done', fmtA(np)), 'lbl-done');
  renderStackView();
  S.busy = false; setBusy(false);
}

// ─────────────────────────────────────────────────────────
// EXECUTE — núcleo interno (sem setBusy, para uso por doRun)
// ─────────────────────────────────────────────────────────


// Resolve qualquer byte de memória para o endereço de início
// da instrução que o contém. Se o byte não pertencer a nenhuma
// instrução conhecida do programa atual, retorna o próprio addr.
function instrStartFor(addr) {
  const target = addr & 0x3F;
  const lines = traceProgram(demoProgramForArch());
  for (const line of lines) {
    if (target >= line.addr && target < line.addr + line.size) return line.addr;
  }
  // Fora do programa principal: tenta traceBlock a partir do início
  const block = traceBlock(0, 64);
  for (const line of block) {
    if (target >= line.addr && target < line.addr + line.size) return line.addr;
  }
  return target;
}

function parseAsmSource(src) {
  const normalized = src.trim().toUpperCase().replace(/\s+/g, ' ').replace(/,\s*/g, ',');
  if (!normalized) return { normalized: '', mnem: '', ops: [] };
  const tok = normalized.split(' ');
  const mnem = tok[0];
  const tail = tok.slice(1).join(' ').trim();
  const ops = tail ? tail.split(',').map(x => x.trim()).filter(Boolean) : [];
  return { normalized, mnem, ops };
}

function parseAsmNumber(token) {
  const raw = token.trim().toUpperCase();
  if (!raw) return null;
  if (!/^0X[0-9A-F]+$/.test(raw) && !/^[0-9]+$/.test(raw)) return null;
  try {
    return { raw, big: BigInt(raw) };
  } catch (_) {
    return null;
  }
}

function fitsUnsigned(big, bits) {
  return big >= 0n && big <= ((1n << BigInt(bits)) - 1n);
}

function asmRegWidth(name) {
  return REG64.includes(name) || REG64X.includes(name) ? 64 : 32;
}

function parseAsmMemoryOperand(op) {
  const m = /^(?:(QWORD|DWORD|WORD|BYTE)\s+PTR\s+)?\[(0X[0-9A-F]+|[0-9]+)\]$/.exec(op.trim().toUpperCase());
  if (!m) return null;
  const num = parseAsmNumber(m[2]);
  if (!num) return { error: 'Endereco de memoria invalido.' };
  if (!fitsUnsigned(num.big, 16)) return { error: 'Endereco de memoria fora de 16 bits.' };
  if (num.big > 0x3Fn) return { error: 'Endereco de memoria fora do mapa 0x0000..0x003F.' };
  return {
    ptr: m[1] || '',
    addr: Number(num.big),
  };
}

const SUPPORTED_ASM_MNEMS = ['MOV', 'PUSH', 'POP', 'CALL', 'RET', 'JMP', 'NOP', 'HLT'];

function editDistance(a, b) {
  const aa = a.toUpperCase();
  const bb = b.toUpperCase();
  const rows = Array.from({ length: aa.length + 1 }, () => new Array(bb.length + 1).fill(0));
  for (let i = 0; i <= aa.length; i++) rows[i][0] = i;
  for (let j = 0; j <= bb.length; j++) rows[0][j] = j;
  for (let i = 1; i <= aa.length; i++) {
    for (let j = 1; j <= bb.length; j++) {
      const cost = aa[i - 1] === bb[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + cost
      );
    }
  }
  return rows[aa.length][bb.length];
}

function humanJoin(list) {
  const uniq = [...new Set(list.filter(Boolean))];
  if (!uniq.length) return '';
  if (uniq.length === 1) return uniq[0];
  if (uniq.length === 2) return `${uniq[0]} ou ${uniq[1]}`;
  return `${uniq.slice(0, -1).join(', ')} ou ${uniq[uniq.length - 1]}`;
}

function closestAsmNames(token, names, limit = 2, maxDistance = 2) {
  const raw = token.trim().toUpperCase();
  if (!raw) return [];
  return [...new Set(names)]
    .map(name => ({ name, dist: editDistance(raw, name) }))
    .filter(item => item.dist <= maxDistance)
    .sort((a, b) => a.dist - b.dist || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(item => item.name);
}

function asmValidRegistersForArch(opts = {}) {
  if (is64()) {
    if (opts.onlyWide) return [...REG64, ...REG64X];
    return [...REG32, ...REG64, ...REG64X];
  }
  return [...REG32];
}

function asmRegisterExamples(expectedRegs = null) {
  const regs = expectedRegs?.length ? expectedRegs : asmValidRegistersForArch();
  const preferred = is64()
    ? ['RAX', 'RBX', 'RCX', 'RDX', 'RSP', 'RBP', 'R8', 'R9', 'R10', 'EAX', 'EBX', 'ECX', 'EDX', 'ESP', 'EBP']
    : ['EAX', 'EBX', 'ECX', 'EDX', 'ESP', 'EBP', 'ESI', 'EDI'];
  const picks = [];
  for (const name of preferred) {
    if (regs.includes(name) && !picks.includes(name)) picks.push(name);
  }
  return humanJoin(picks.slice(0, is64() ? 5 : 4));
}

function wideAliasForReg(name) {
  const idx = REG32.indexOf(name);
  return idx >= 0 ? REG64[idx] : '';
}

function isAsmIdentifierToken(token) {
  return /^\$?[A-Z_][A-Z0-9_]*$/.test(token.trim().toUpperCase());
}

function instructionRuleHint(mnem, expectedRegs = null) {
  if (mnem === 'MOV') {
    return 'Formas aceitas: MOV REG,IMEDIATO; MOV REG,REG; MOV REG,[END]; MOV [END],REG.';
  }
  if (mnem === 'PUSH' || mnem === 'POP') {
    const ex = is64() ? 'RAX' : 'EAX';
    return `${mnem} no assembler deste simulador aceita apenas 1 registrador. Exemplo: ${mnem} ${ex}.`;
  }
  if (mnem === 'CALL') return 'Use um endereco do mapa, por exemplo CALL 0x0015.';
  if (mnem === 'JMP') return 'Use um endereco do mapa, por exemplo JMP 0x0010 ou JMP SHORT 0x0010.';
  if (['NOP', 'HLT', 'RET'].includes(mnem)) return `Escreva apenas ${mnem}, sem operandos.`;
  return `Use operandos validos, por exemplo ${asmRegisterExamples(expectedRegs)}.`;
}

function explainUnsupportedMnemonic(mnem) {
  if (/^[0-9]+/.test(mnem)) {
    const stripped = mnem.replace(/^[0-9]+/, '');
    if (SUPPORTED_ASM_MNEMS.includes(stripped)) {
      return `Instrucao nao suportada pelo assembler: ${mnem}. O nome da instrucao nao pode comecar com numero. Parece haver um caractere extra antes de ${stripped}.`;
    }
  }
  const suggestions = closestAsmNames(mnem, SUPPORTED_ASM_MNEMS);
  if (suggestions.length) {
    return `Instrucao nao suportada pelo assembler: ${mnem}. Esse mnemonico nao existe exatamente assim no subset atual. Talvez voce quis dizer ${humanJoin(suggestions)}.`;
  }
  return `Instrucao nao suportada pelo assembler: ${mnem}. O subset atual aceita apenas ${humanJoin(SUPPORTED_ASM_MNEMS)}.`;
}

function explainInvalidRegisterOperand(token, mnem = '', expectedRegs = null) {
  const raw = token.trim().toUpperCase();
  const regs = expectedRegs?.length ? expectedRegs : asmValidRegistersForArch();
  const ruleHint = instructionRuleHint(mnem, regs);

  if (!raw) return `Operando vazio. ${ruleHint}`;
  if (/^\$[A-Z0-9_]+$/.test(raw)) {
    const bare = raw.slice(1);
    if ([...REG32, ...REG64, ...REG64X, 'EIP', 'RIP', 'PC'].includes(bare)) {
      return `Registrador invalido: ${raw}. Na sintaxe Intel usada pelo simulador, registradores nao levam o prefixo "$". Escreva ${bare}.`;
    }
    return `Registrador invalido: ${raw}. O prefixo "$" nao faz parte da sintaxe Intel usada aqui. ${ruleHint}`;
  }
  if (raw === 'PC') {
    return 'Registrador invalido: PC. "PC" e apenas o nome didatico mostrado na interface. No assembler, altere o fluxo com JMP/CALL ou edite o PC pelos controles visuais.';
  }
  if (raw === 'EIP' || raw === 'RIP') {
    return `Registrador invalido: ${raw}. ${raw} e um ponteiro de instrucao especial da CPU, mas este assembler didatico nao aceita ${raw} como operando. Para mudar o fluxo, use JMP/CALL; a interface atualiza o PC automaticamente.`;
  }
  if (raw === 'FP') {
    return `Registrador invalido: ${raw}. "FP" nao e um registrador Intel x86/x86-64. Para a base do frame, use ${is64() ? 'RBP' : 'EBP'}.`;
  }
  if (raw === 'SP') {
    return `Registrador invalido: ${raw}. O nome correto do ponteiro de pilha nesta arquitetura e ${is64() ? 'RSP' : 'ESP'}.`;
  }
  if (raw === 'BP') {
    return `Registrador invalido: ${raw}. O nome correto do base pointer nesta arquitetura e ${is64() ? 'RBP' : 'EBP'}.`;
  }
  if (/^0X$/.test(raw)) {
    return `Registrador invalido: ${raw}. Isso parece um hexadecimal incompleto: faltam digitos apos 0x. ${ruleHint}`;
  }
  if (/^0X[0-9A-F]+$/.test(raw) || /^[0-9]+$/.test(raw)) {
    return `Registrador invalido: ${raw}. Isso e um valor imediato, nao um registrador. ${ruleHint}`;
  }
  if (/^\[.*\]$/.test(raw) || /\bPTR\b/.test(raw)) {
    return `Registrador invalido: ${raw}. Isso representa memoria, nao um registrador. ${ruleHint}`;
  }

  const suggestions = closestAsmNames(raw, regs);
  if (suggestions.length) {
    return `Registrador invalido: ${raw}. Esse nome nao existe exatamente como foi escrito. Talvez voce quis dizer ${humanJoin(suggestions)}.`;
  }
  return `Registrador invalido: ${raw}. Esse nome nao existe nos registradores aceitos pelo simulador nesta arquitetura. Use, por exemplo, ${asmRegisterExamples(regs)}.`;
}

function validateAssembly(src, baseAddr = S.pc) {
  const { normalized, mnem, ops } = parseAsmSource(src);
  if (!normalized) return { ok: false, error: 'Digite uma instrucao ASM.' };

  const allRegs = [...REG32, ...REG64, ...REG64X];
  const isReg = n => allRegs.includes(n);
  const regAllowedInArch = n => is64() || (!REG64.includes(n) && !REG64X.includes(n));
  const requireNoOps = name => {
    if (ops.length !== 0) return { ok: false, error: `${name} nao recebe operandos. ${instructionRuleHint(name)}` };
    return null;
  };
  const requireOneOp = name => {
    if (ops.length !== 1) return { ok: false, error: `${name} exige exatamente 1 operando. ${instructionRuleHint(name)}` };
    return null;
  };
  const requireTwoOps = name => {
    if (ops.length !== 2) return { ok: false, error: `${name} exige exatamente 2 operandos. ${instructionRuleHint(name)}` };
    return null;
  };

  if (['NOP', 'HLT', 'RET'].includes(mnem)) {
    const err = requireNoOps(mnem);
    if (err) return err;
  } else if (mnem === 'PUSH' || mnem === 'POP') {
    const err = requireOneOp(mnem);
    if (err) return err;
    const reg = ops[0];
    const expectedRegs = asmValidRegistersForArch({ onlyWide: is64() });
    if (!isReg(reg)) return { ok: false, error: explainInvalidRegisterOperand(reg, mnem, expectedRegs) };
    if (!regAllowedInArch(reg)) return { ok: false, error: `${reg} nao existe no modo IA-32.` };
    if (is64() && asmRegWidth(reg) !== 64) {
      const alias = wideAliasForReg(reg);
      return { ok: false, error: `Em x86-64, ${mnem} da simulacao aceita apenas registradores de 64 bits. ${reg} tem 32 bits${alias ? `; use ${alias}` : ''}.` };
    }
  } else if (mnem === 'JMP') {
    const err = requireOneOp('JMP');
    if (err) return err;
    const targetTok = ops[0].replace(/^SHORT\s+/, '').trim();
    const target = parseAsmNumber(targetTok);
    if (!target) return { ok: false, error: `Destino de JMP invalido: ${ops[0]}. ${instructionRuleHint('JMP')}` };
    if (target.big > 0x3Fn) return { ok: false, error: 'Destino de JMP fora do mapa 0x0000..0x003F.' };
  } else if (mnem === 'CALL') {
    const err = requireOneOp('CALL');
    if (err) return err;
    const target = parseAsmNumber(ops[0]);
    if (!target) return { ok: false, error: `Destino de CALL invalido: ${ops[0]}. ${instructionRuleHint('CALL')}` };
    if (target.big > 0x3Fn) return { ok: false, error: 'Destino de CALL fora do mapa 0x0000..0x003F.' };
  } else if (mnem === 'MOV') {
    const err = requireTwoOps('MOV');
    if (err) return err;
    const [dst, src2] = ops;
    const dstReg = isReg(dst) ? dst : null;
    const srcReg = isReg(src2) ? src2 : null;
    const dstMem = parseAsmMemoryOperand(dst);
    const srcMem = parseAsmMemoryOperand(src2);
    const imm = parseAsmNumber(src2);

    if (dstReg && !regAllowedInArch(dstReg)) return { ok: false, error: `${dstReg} nao existe no modo IA-32.` };
    if (srcReg && !regAllowedInArch(srcReg)) return { ok: false, error: `${srcReg} nao existe no modo IA-32.` };
    if (dstMem?.error) return { ok: false, error: dstMem.error };
    if (srcMem?.error) return { ok: false, error: srcMem.error };
    if (!dstReg && !dstMem) {
      const dstRaw = dst.trim().toUpperCase();
      if (parseAsmNumber(dstRaw) || /^0X$/.test(dstRaw) || /^[0-9]+$/.test(dstRaw)) {
        return { ok: false, error: `Operando de destino invalido: ${dst}. Em MOV, o destino nao pode ser um valor imediato. ${instructionRuleHint('MOV')}` };
      }
      if (/^\[/.test(dstRaw) || /\bPTR\b/.test(dstRaw)) {
        return { ok: false, error: `Operando de memoria invalido: ${dst}. Use [0x0010], DWORD PTR [0x0010] ou QWORD PTR [0x0010].` };
      }
      if (isAsmIdentifierToken(dstRaw)) {
        return { ok: false, error: explainInvalidRegisterOperand(dstRaw, 'MOV', asmValidRegistersForArch()) };
      }
    }
    if (!srcReg && !srcMem && !imm) {
      const srcRaw = src2.trim().toUpperCase();
      if (/^\[/.test(srcRaw) || /\bPTR\b/.test(srcRaw)) {
        return { ok: false, error: `Operando de memoria invalido: ${src2}. Use [0x0010], DWORD PTR [0x0010] ou QWORD PTR [0x0010].` };
      }
      if (isAsmIdentifierToken(srcRaw) || /^\$[A-Z0-9_]+$/.test(srcRaw) || /^0X$/.test(srcRaw) || /^[0-9]+$/.test(srcRaw)) {
        return { ok: false, error: explainInvalidRegisterOperand(srcRaw, 'MOV', asmValidRegistersForArch()) };
      }
    }

    if (dstReg && imm) {
      const bits = asmRegWidth(dstReg);
      if (bits === 64) {
        if (!is64()) return { ok: false, error: `${dstReg} nao existe no modo IA-32.` };
        if (!fitsUnsigned(imm.big, 64)) return { ok: false, error: 'Imediato nao cabe em 64 bits sem sinal.' };
      } else if (!fitsUnsigned(imm.big, 32)) {
        return { ok: false, error: 'Imediato nao cabe em 32 bits sem sinal.' };
      }
    } else if (dstReg && srcReg) {
      if (asmRegWidth(dstReg) !== asmRegWidth(srcReg)) {
        return { ok: false, error: 'MOV entre registradores exige operandos da mesma largura.' };
      }
    } else if (dstMem && srcReg) {
      const bits = asmRegWidth(srcReg);
      if (bits === 64 && !is64()) return { ok: false, error: `${srcReg} nao existe no modo IA-32.` };
      if (dstMem.ptr && !['DWORD', 'QWORD'].includes(dstMem.ptr)) {
        return { ok: false, error: 'A simulacao suporta apenas DWORD PTR e QWORD PTR para MOV.' };
      }
      if (bits === 64 && dstMem.ptr && dstMem.ptr !== 'QWORD') {
        return { ok: false, error: 'MOV com registrador de 64 bits requer QWORD PTR.' };
      }
      if (bits === 32 && dstMem.ptr && dstMem.ptr !== 'DWORD') {
        return { ok: false, error: 'MOV com registrador de 32 bits requer DWORD PTR.' };
      }
    } else if (dstReg && srcMem) {
      const bits = asmRegWidth(dstReg);
      if (bits === 64 && !is64()) return { ok: false, error: `${dstReg} nao existe no modo IA-32.` };
      if (srcMem.ptr && !['DWORD', 'QWORD'].includes(srcMem.ptr)) {
        return { ok: false, error: 'A simulacao suporta apenas DWORD PTR e QWORD PTR para MOV.' };
      }
      if (bits === 64 && srcMem.ptr && srcMem.ptr !== 'QWORD') {
        return { ok: false, error: 'MOV com registrador de 64 bits requer QWORD PTR.' };
      }
      if (bits === 32 && srcMem.ptr && srcMem.ptr !== 'DWORD') {
        return { ok: false, error: 'MOV com registrador de 32 bits requer DWORD PTR.' };
      }
    } else {
      return { ok: false, error: `Formato de MOV nao suportado neste simulador. ${instructionRuleHint('MOV')}` };
    }
  } else {
    return { ok: false, error: explainUnsupportedMnemonic(mnem) };
  }

  const bytes = assemble(normalized, baseAddr);
  if (!bytes) return { ok: false, error: 'Instrucao reconhecida, mas nao pode ser codificada pelo subset atual. Revise os operandos e os formatos aceitos por este simulador.' };
  return { ok: true, bytes, normalized };
}

function refreshAsmValidation() {
  const input = $('asmInput');
  const hint = $('asmHint');
  if (!input || !hint) return;

  const raw = input.value.trim();
  input.classList.remove('is-valid', 'is-invalid');
  hint.classList.remove('asm-hint-ok', 'asm-hint-error');

  if (!raw) {
    hint.textContent = 'Grava bytes no PC atual. Enter para confirmar.';
    return;
  }

  const check = validateAssembly(raw, S.pc);
  if (check.ok) {
    input.classList.add('is-valid');
    hint.classList.add('asm-hint-ok');
    hint.textContent = `Valido: ${check.bytes.length} byte(s) serao gravados em 0x${fmtA(S.pc)}.`;
  } else {
    input.classList.add('is-invalid');
    hint.classList.add('asm-hint-error');
    hint.textContent = `Invalido: ${check.error}`;
  }
}

function assemble(src, baseAddr = S.pc) {
  const { normalized, mnem, ops } = parseAsmSource(src);
  if (!normalized) return null;

  // Build full register lookup (IA-32 + x64 GP + R8-R15)
  const ALL_REGS = [...REG32, ...REG64, ...REG64X];
  const isReg = n => ALL_REGS.includes(n);
  const isWideAsmReg = n => REG64.includes(n) || REG64X.includes(n);
  const isImm = n => /^0X[0-9A-F]+$/.test(n) || /^[0-9]+$/.test(n);
  const parseImm = n => Number(parseAsmNumber(n).big & 0xFFFFFFFFn) >>> 0;
  const parseImm64Parts = n => {
    const big = BigInt.asUintN(64, parseAsmNumber(n).big);
    return {
      hi: Number((big >> 32n) & 0xFFFFFFFFn) >>> 0,
      lo: Number(big & 0xFFFFFFFFn) >>> 0,
    };
  };
  const modrm = (mod, reg, rm) => ((mod & 3) << 6) | ((reg & 7) << 3) | (rm & 7);

  // Resolve a register name to {idx, rex_b/rex_r}
  function resolveReg(name) {
    let idx = REG32.indexOf(name);
    if (idx >= 0) return { idx, ext: false };
    idx = REG64.indexOf(name);
    if (idx >= 0) return { idx, ext: false };
    idx = REG64X.indexOf(name);
    if (idx >= 0) return { idx, ext: true };
    return null;
  }

  // Build REX byte from flags
  function rexByte(w, r, x, b) {
    const v = 0x40 | (w ? 8 : 0) | (r ? 4 : 0) | (x ? 2 : 0) | (b ? 1 : 0);
    return v === 0x40 ? [] : [v]; // only emit if any flag is set
  }

  if (mnem === 'NOP') return [0x90];
  if (mnem === 'HLT') return [0xF4];
  if (mnem === 'RET') return [0xC3];

  if (mnem === 'PUSH' && ops.length === 1) {
    if (isReg(ops[0])) {
      const r = resolveReg(ops[0]); if (!r) return null;
      return [...rexByte(0, 0, 0, r.ext), 0xFF, modrm(3, 6, r.idx)];
    }
  }
  if (mnem === 'POP' && ops.length === 1) {
    if (isReg(ops[0])) {
      const r = resolveReg(ops[0]); if (!r) return null;
      return [...rexByte(0, 0, 0, r.ext), 0x8F, modrm(3, 0, r.idx)];
    }
  }

  if (mnem === 'JMP' && ops.length === 1) {
    const lbl = ops[0].replace('SHORT', '').trim();
    const target = lbl.startsWith('0X') ? parseInt(lbl, 16) : parseInt(lbl, 10);
    const rel = (target - (baseAddr + 2)) & 0xFF;
    return [0xEB, rel & 0xFF];
  }
  if (mnem === 'CALL' && ops.length === 1) {
    const target = ops[0].startsWith('0X') ? parseInt(ops[0], 16) : parseInt(ops[0], 10);
    const rel = (target - (baseAddr + 5)) >> 0;
    return [0xE8, rel & 0xFF, (rel >> 8) & 0xFF, (rel >> 16) & 0xFF, (rel >> 24) & 0xFF];
  }

  if (mnem === 'MOV' && ops.length === 2) {
    const [dst, src2] = ops;
    // MOV reg, imm32
    if (isReg(dst) && isImm(src2)) {
      const r = resolveReg(dst); if (!r) return null;
      if (isWideAsmReg(dst)) {
        const imm = parseImm64Parts(src2);
        return [
          ...rexByte(1, 0, 0, r.ext),
          0xB8 + r.idx,
          imm.lo & 0xFF, (imm.lo >> 8) & 0xFF, (imm.lo >> 16) & 0xFF, (imm.lo >> 24) & 0xFF,
          imm.hi & 0xFF, (imm.hi >> 8) & 0xFF, (imm.hi >> 16) & 0xFF, (imm.hi >> 24) & 0xFF,
        ];
      }
      const v = parseImm(src2);
      return [...rexByte(0, 0, 0, r.ext), 0xB8 + r.idx, v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >> 24) & 0xFF];
    }
    // MOV reg, reg
    if (isReg(dst) && isReg(src2)) {
      const rd = resolveReg(dst), rs = resolveReg(src2); if (!rd || !rs) return null;
      const wide = isWideAsmReg(dst) && isWideAsmReg(src2);
      return [...rexByte(wide, rs.ext, 0, rd.ext), 0x89, modrm(3, rs.idx, rd.idx)];
    }
    // MOV [addr], reg  (strip QWORD PTR / DWORD PTR if present)
    const dstClean = dst.replace(/(?:QWORD|DWORD|WORD|BYTE)\s*PTR\s*/, '');
    const src2Clean = src2.replace(/(?:QWORD|DWORD|WORD|BYTE)\s*PTR\s*/, '');
    const mAddr = /^\[(?:0X)?([0-9A-F]+)\]$/.exec(dstClean);
    if (mAddr && isReg(src2Clean)) {
      const rs = resolveReg(src2Clean); if (!rs) return null;
      const addr = parseInt(mAddr[1], 16) & 0x3F;
      const wide = /\bQWORD\b/.test(dst) || isWideAsmReg(src2Clean);
      return [...rexByte(wide, rs.ext, 0, 0), 0x89, modrm(0, rs.idx, 0), addr];
    }
    // MOV reg, [addr]
    const mAddr2 = /^\[(?:0X)?([0-9A-F]+)\]$/.exec(src2Clean);
    if (isReg(dstClean) && mAddr2) {
      const rd = resolveReg(dstClean); if (!rd) return null;
      const addr = parseInt(mAddr2[1], 16) & 0x3F;
      const wide = /\bQWORD\b/.test(src2) || isWideAsmReg(dstClean);
      return [...rexByte(wide, rd.ext, 0, 0), 0x8B, modrm(0, rd.idx, 0), addr];
    }
  }
  return null; // não reconhecido
}
