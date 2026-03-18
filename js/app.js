/* ═══════════════════════════════════════════════════════
   Intel x86/x64 Memory & Stack Lab
   ═══════════════════════════════════════════════════════ */
'use strict';

const DEFAULT_STACK_SIZE = 100;
const MIN_STACK_SIZE = 1;
const MAX_STACK_SIZE = 1024 * 1024;

// ─────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────
const S = {
  endian: 'little',
  size:   'dword',
  reg:    'EAX',
  stackMode: 'full',
  stackGranularity: 'dword', // 'byte' | 'word' | 'dword' | 'qword' — padrão IA-32
  stackSize: DEFAULT_STACK_SIZE,
  stackSizeInputUnit: 'B',
  changedRegs: [],
  sidebarPanelWidth: 240,
  sidebarPanelManual: false,
  stackPanelWidth: 280,
  stackPanelManual: false,
  codeMemSplitWidth: 0,
  codeMemSplitManual: false,
  centerPaneHeights: {},
  collapsedSections: {},
  speed:  2500,
  memViewBase: 0,
  busy:   false,
  logIndent: 0,
  arch:   'ia32',   // 'ia32' | 'x64'
  regs: {
    // IA-32 / x64 general-purpose (low 32-bit names always present)
    EAX: 0xDEADBEEF, EBX: 0xCAFEBABE, ECX: 0x12345678, EDX: 0xABCD1234,
    ESI: 0x00000000, EDI: 0x00000000,
    // 64-bit extensions (upper 32 bits; value = full 64-bit hi word)
    RAX_hi: 0, RBX_hi: 0, RCX_hi: 0, RDX_hi: 0,
    RSI_hi: 0, RDI_hi: 0,
    // x64-only registers R8-R15 (stored as two 32-bit halves)
    R8:  0x00000000, R8_hi:  0,
    R9:  0x00000000, R9_hi:  0,
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
  mem:      new Uint8Array(64),
  memState: new Array(64).fill(''),
  stats: {
    ops:0, totalTime:0, loads:0, stores:0,
    loadTimes:[], storeTimes:[], littleOps:0, bigOps:0,
  },
  pc:   0,
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

const CENTER_PANE_CONFIG = {
  regsRow: { initial: 332, min: 180, max: 520 },
  codeMemRow: { initial: 360, min: 220, max: 680 },
  logSection: { initial: 242, min: 170, max: 520 },
};

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

const HELP_PAGES = {
  intro: `
    <h3>Introdução</h3>
    <p>O simulador mostra como bytes, registradores, PC e stack mudam a cada instrução.</p>
    <p>Use <strong>STEP</strong> para acompanhar FETCH, DECODE e EXECUTE em detalhe, ou <strong>RUN</strong> para fluxo contínuo.</p>
  `,
  little: `
    <h3>Little Endian</h3>
    <p>No padrão Intel, o byte menos significativo fica no menor endereço.</p>
    <p>Ex.: 0x12345678 é armazenado como <code>78 56 34 12</code>.</p>
  `,
  big: `
    <h3>Big Endian</h3>
    <p>O modo BIG aqui é apenas visual/comparativo. A execução da CPU continua little-endian.</p>
    <p>Ele ajuda a comparar a ordem dos bytes na interface, não muda a semântica do processador.</p>
  `,
  ops: `
    <h3>Operações</h3>
    <p><strong>STORE</strong> grava bytes do registrador na memória, <strong>LOAD</strong> lê memória para o registrador e <strong>PUSH/POP</strong> operam sobre a stack.</p>
    <p><strong>RUN</strong>, <strong>PAUSE</strong>, <strong>RESUME</strong> e breakpoints controlam o fluxo do programa.</p>
  `,
};

const I18N_PT = {
  'asm.bp.remove': n => `BP #${n} - clique para remover`,
  'asm.bp.set': 'Clique para definir breakpoint',
  'asm.nav.title': 'Clique para mover o PC para esta instrucao',
  'asm.pseudocode.title': 'Pseudo-codigo correspondente a instrucao',
  'asm.hint.placeholder.ia32': 'Ex.: MOV EAX, 0x1234 | PUSH EAX | CALL 0x001C',
  'asm.hint.placeholder.x64': 'Ex.: MOV RAX, 0x1234 | PUSH RAX | CALL 0x001D',
  'help.intro': HELP_PAGES.intro,
  'help.little': HELP_PAGES.little,
  'help.big': HELP_PAGES.big,
  'help.ops': HELP_PAGES.ops,
  'log.error.addr_range': addr => `Endereco 0x${addr} fora do mapa de memoria.`,
  'log.error.asm_grew': (addr, oldSize, newSize) => `ASM em 0x${addr} cresceu de ${oldSize} para ${newSize} byte(s).`,
  'log.error.asm_invalid': (addr, err) => `ASM invalido em 0x${addr} - ${err}`,
  'log.error.asm_invalid_listing': (addr, err) => `ASM invalido em 0x${addr} - ${err}`,
  'log.error.cpu_halted': 'CPU halted. CLEAR para reiniciar.',
  'log.error.hlt': 'HLT executado. CPU parada.',
  'log.info.decode': mnem => `DECODE -> ${mnem}`,
  'log.info.decode_desc': mnem => `Os bytes buscados foram decodificados como ${mnem}.`,
  'log.info.execute_desc': 'Aplica os efeitos arquiteturais da instrucao sobre PC, registradores, memoria e stack.',
  'log.info.fetch1': (addr, op, size) => `FETCH  IP=0x${addr} | opcode=0x${op} | ${size} byte(s)`,
  'log.info.fetch2': np => `FETCH  IP <- 0x${np}`,
  'log.info.fetch_desc': (size, addr) => `Busca ${size} byte(s) em 0x${addr} e carrega a instrucao no IR.`,
  'log.info.fetch_ip': (ipName, np) => `${ipName} avanca para 0x${np} apos o FETCH.`,
  'log.kind.error': 'ERRO',
  'log.kind.info': 'INFO',
  'log.kind.load': 'LOAD',
  'log.kind.step': 'STEP',
  'log.kind.store': 'STORE',
  'log.kind.sys': 'SYS',
  'log.load.byte': (reg, idx, addr, value, cur) => `${reg}[${idx}] <- MEM[0x${addr}] = 0x${value} (agora ${cur})`,
  'log.load.done': (reg, value, ms) => `LOAD concluido: ${reg}=0x${value} - ${ms}ms`,
  'log.load.start': (addr, reg, size, endian) => `LOAD em [0x${addr}] -> ${reg} (${size}, ${endian})`,
  'log.pop': (addr, reg, spName) => `POP: topo [0x${addr}] -> ${reg} (${spName})`,
  'log.push': (reg, value, spName, addr) => `PUSH ${reg}=0x${value} -> ${spName}=0x${addr}`,
  'log.store.byte': (addr, value, idx, total) => `STORE byte ${idx}/${total} -> MEM[0x${addr}] = 0x${value}`,
  'log.store.done': ms => `STORE concluido - ${ms}ms`,
  'log.store.exec_ok': mnem => `EXEC OK: ${mnem}`,
  'log.store.start': (reg, value, addr, size, endian) => `STORE ${reg}=0x${value} -> [0x${addr}] (${size}, ${endian})`,
  'log.sys.arch': arch => `Arquitetura alterada para ${arch}.`,
  'log.sys.asm_edit': (addr, src) => `Linha ASM em 0x${addr} atualizada para: ${src}`,
  'log.sys.bp_hit': (num, addr) => `BP #${num} atingido em 0x${addr}.`,
  'log.sys.demo_arch': arch => `Programa demo ${arch} carregado para a arquitetura atual.`,
  'log.sys.demo_loaded': arch => `Programa demo ${arch} carregado.`,
  'log.sys.demo_reset': 'Programa demo restaurado - PC em 0x0000',
  'log.sys.format': fmt => `Formato visual ajustado para ${fmt}.`,
  'log.sys.mem_edit': (addr, value) => `Memoria em 0x${addr} editada para 0x${value}.`,
  'log.sys.nop_fill': (from, to) => `Bytes restantes preenchidos com NOP de 0x${from} ate 0x${to}.`,
  'log.sys.pc_manual': addr => `PC ajustado manualmente para 0x${addr}.`,
  'log.sys.pc_moved': addr => `PC movido para 0x${addr}.`,
  'log.sys.reg_selected': name => `Registrador ${name} selecionado.`,
  'log.sys.reg_set': (name, value) => `${name} ajustado para 0x${value}.`,
  'log.sys.size': (size, bits) => `Tamanho ajustado para ${size} (${bits} bits).`,
  'log.sys.stack_located': addr => `Stack 0x${addr} localizada no mapa de memoria.`,
  'log.sys.stack_size': (size, regs, top, last) => `Tamanho da stack ajustado para ${size}. ${regs} reiniciados em 0x${top}. Mapa de memoria agora cobre 0x0000..0x${last}.`,
  'log.sys.step_done': (ipName, addr) => `STEP concluido - ${ipName} agora aponta para 0x${addr}.`,
  'log.sys.step_start': addr => `STEP em 0x${addr}.`,
  'mem.cell.title': addr => `Endereco 0x${addr} - Shift+Clique para breakpoint`,
  'stack.label.ia32': 'STACK  ESP/EBP',
  'stack.label.x64': 'STACK  RSP/RBP',
  'status.asm_invalid': (addr, err) => `ASM invalido em 0x${addr} - ${err}`,
  'status.asm_invalid_short': err => `ASM invalido - ${err}`,
  'status.back_done': addr => `BACK concluido - IP = 0x${addr}`,
  'status.decode': mnem => `DECODE: ${mnem}`,
  'status.decode_revert': mnem => `DECODE: ${mnem} - revertendo`,
  'status.demo_arch': arch => `Programa demo ${arch} carregado - PC em 0x0000`,
  'status.demo_loaded': 'Programa demo carregado - main em 0x0000',
  'status.demo_reset': 'Programa demo restaurado - PC em 0x0000',
  'status.execute': mnem => `EXECUTE: ${mnem}`,
  'status.execute_done': addr => `EXECUTE concluido - IP = 0x${addr}`,
  'status.execute_revert': mnem => `EXECUTE: ${mnem} - revertendo`,
  'status.fetch1': (addr, size) => `FETCH: IP=0x${addr} -> lendo ${size} byte(s) -> IR`,
  'status.fetch2': np => `FETCH: IP atualizado -> 0x${np} (instrucao no IR)`,
  'status.fetch_decode_done': np => `FETCH+DECODE concluido - IP = 0x${np}`,
  'status.fetch_revert': addr => `FETCH  IP=0x${addr} - revertendo`,
  'status.fetch_short': (addr, size) => `FETCH  IP=0x${addr} | ${size}B -> IR`,
  'status.hlt': 'HLT - CPU parada',
  'status.load_done': (reg, value, ms) => `LOAD concluido: ${reg}=0x${value} - ${ms}ms`,
  'status.load_start': (n, addr) => `LOAD: lendo ${n} byte(s) de [0x${addr}]...`,
  'status.pop_done': (reg, value) => `POP concluido - ${reg}=0x${value}`,
  'status.pop_start': (addr, reg) => `POP: topo da pilha [0x${addr}] -> ${reg}`,
  'status.push_done': (spName, addr) => `PUSH concluido - ${spName}=0x${addr}`,
  'status.push_start': (reg, addr) => `PUSH: ${reg} -> topo da pilha [0x${addr}]`,
  'status.store_done': ms => `STORE concluido - ${ms}ms`,
  'status.store_start': (n, addr) => `STORE: gravando ${n} byte(s) em [0x${addr}]...`,
  'ui.asm.valid': bytes => `${bytes} byte(s) validos`,
  'ui.reg.edit.title': 'Clique duas vezes para editar',
  'ui.reg.picker.title': 'Clique para selecionar este registrador',
  'ui.section.collapse': 'Recolher secao',
  'ui.section.expand': 'Expandir secao',
  'ui.stack.row.title': 'Clique para localizar no mapa de memoria - 2x clique para editar',
};

// ─────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hex32  = v => ((v>>>0).toString(16).padStart(8,'0')).toUpperCase();
const hex64  = (hi,lo) => hex32(hi)+hex32(lo);
const hex8   = v => ((v&0xFF).toString(16).padStart(2,'0')).toUpperCase();
const fmtA   = n => n.toString(16).padStart(4,'0').toUpperCase();
const ease   = t => t<.5 ? 2*t*t : -1+(4-2*t)*t;
const sizeN  = () => S.size==='byte'?1 : S.size==='word'?2 : S.size==='qword'?8 : 4;
const is64   = () => S.arch==='x64';
const demoProgramForArch = (arch=S.arch) => DEMO_PROGRAMS[arch==='x64' ? 'x64' : 'ia32'];
let asmTraceClickTimer = 0;
let lastStatusLog = '';
const regPulseTimers = new Map();
let centerPaneLayoutFrame = 0;
let memCellRefs = [];

function t(key, ...args) {
  if(typeof key !== 'string' || !key) return '';
  const entry = I18N_PT[key];
  if(typeof entry === 'function') return entry(...args);
  if(typeof entry === 'string') return entry;
  if(key.startsWith('help.')) return HELP_PAGES[key.slice(5)] || '';
  return args.length ? [key, ...args].join(' ') : key;
}

// Current register name set based on arch
function gpRegs()  { return is64() ? ['RAX','RBX','RCX','RDX','RSI','RDI'] : ['EAX','EBX','ECX','EDX','ESI','EDI']; }
function extRegs() { return is64() ? ['R8','R9','R10','R11','R12','R13','R14','R15'] : []; }
function spRegs()  { return is64() ? ['RSP','RBP'] : ['ESP','EBP']; }
function ptrSize() { return is64() ? 8 : 4; }
function isSpReg(name) { return spRegs().includes(name); }
function isStackTopReg(name) { return name==='ESP' || name==='RSP'; }
function isStackBaseReg(name) { return name==='EBP' || name==='RBP'; }
function stackRoleClass(name) {
  if(isStackTopReg(name)) return 'esp';
  if(isStackBaseReg(name)) return 'ebp';
  return '';
}
function regWidthBytes(name) { return is64() && !isSpReg(name) ? 8 : 4; }
function transferWidth(name=S.reg) { return Math.min(sizeN(), regWidthBytes(name)); }

function scheduleCenterPaneLayout() {
  if(typeof requestAnimationFrame !== 'function') {
    applyCenterPaneHeights();
    return;
  }
  if(centerPaneLayoutFrame) return;
  centerPaneLayoutFrame = requestAnimationFrame(() => {
    centerPaneLayoutFrame = 0;
    applyCenterPaneHeights();
  });
}

function regParts(name) {
  if(is64()) {
    const map = {
      RAX:{lo:'EAX', hi:'RAX_hi'},
      RBX:{lo:'EBX', hi:'RBX_hi'},
      RCX:{lo:'ECX', hi:'RCX_hi'},
      RDX:{lo:'EDX', hi:'RDX_hi'},
      RSI:{lo:'ESI', hi:'RSI_hi'},
      RDI:{lo:'EDI', hi:'RDI_hi'},
      R8: {lo:'R8',  hi:'R8_hi'},
      R9: {lo:'R9',  hi:'R9_hi'},
      R10:{lo:'R10', hi:'R10_hi'},
      R11:{lo:'R11', hi:'R11_hi'},
      R12:{lo:'R12', hi:'R12_hi'},
      R13:{lo:'R13', hi:'R13_hi'},
      R14:{lo:'R14', hi:'R14_hi'},
      R15:{lo:'R15', hi:'R15_hi'},
    };
    if(name==='RSP') return {lo:S.regs.ESP>>>0, hi:0};
    if(name==='RBP') return {lo:S.regs.EBP>>>0, hi:0};
    const meta = map[name];
    if(meta) return {lo:(S.regs[meta.lo]||0)>>>0, hi:(S.regs[meta.hi]||0)>>>0};
  }
  return {lo:(S.regs[name]||0)>>>0, hi:0};
}

function setRegParts(name, lo, hi=0, opts={}) {
  lo >>>= 0;
  hi >>>= 0;
  const track = opts.track !== false;
  const stackLo = clamp(lo, 0, Math.max(S.stackSize, 0));
  if(is64()) {
    const map = {
      RAX:{lo:'EAX', hi:'RAX_hi'},
      RBX:{lo:'EBX', hi:'RBX_hi'},
      RCX:{lo:'ECX', hi:'RCX_hi'},
      RDX:{lo:'EDX', hi:'RDX_hi'},
      RSI:{lo:'ESI', hi:'RSI_hi'},
      RDI:{lo:'EDI', hi:'RDI_hi'},
      R8: {lo:'R8',  hi:'R8_hi'},
      R9: {lo:'R9',  hi:'R9_hi'},
      R10:{lo:'R10', hi:'R10_hi'},
      R11:{lo:'R11', hi:'R11_hi'},
      R12:{lo:'R12', hi:'R12_hi'},
      R13:{lo:'R13', hi:'R13_hi'},
      R14:{lo:'R14', hi:'R14_hi'},
      R15:{lo:'R15', hi:'R15_hi'},
    };
    if(name==='RSP') { S.regs.ESP=stackLo; if(track) markRegistersChanged(name); return; }
    if(name==='RBP') { S.regs.EBP=stackLo; if(track) markRegistersChanged(name); return; }
    const meta = map[name];
    if(meta) {
      S.regs[meta.lo]=lo;
      S.regs[meta.hi]=hi;
      if(track) markRegistersChanged(name);
      return;
    }
  }
  S.regs[name]=(name==='ESP' || name==='EBP') ? stackLo : lo;
  if(track) markRegistersChanged(name);
}

function regHex(name) {
  const {lo,hi} = regParts(name);
  return regWidthBytes(name)===8 ? hex64(hi,lo) : hex32(lo);
}

function regBytes(name, count=transferWidth(name)) {
  const {lo,hi} = regParts(name);
  const bytes = [];
  for(let i=0;i<4;i++) bytes.push((lo>>>(i*8))&0xFF);
  for(let i=0;i<4;i++) bytes.push((hi>>>(i*8))&0xFF);
  return bytes.slice(0, count);
}

function setRegFromBytes(name, littleBytes, opts={}) {
  let lo = 0;
  let hi = 0;
  const limit = Math.min(littleBytes.length, regWidthBytes(name));
  for(let i=0;i<Math.min(limit,4);i++) lo |= (littleBytes[i]&0xFF)<<(i*8);
  for(let i=4;i<Math.min(limit,8);i++) hi |= (littleBytes[i]&0xFF)<<((i-4)*8);
  setRegParts(name, lo>>>0, hi>>>0, opts);
}

function displayTransferStart(name=S.reg, count=transferWidth(name)) {
  return regWidthBytes(name) - Math.min(count, regWidthBytes(name));
}

function displayPosForTransferByte(name, byteIdx, count=transferWidth(name)) {
  const total = regWidthBytes(name);
  const start = displayTransferStart(name, count);
  return S.endian==='little' ? (total-1-byteIdx) : (start+byteIdx);
}

function displayPosSet(name) {
  const start = displayTransferStart(name);
  const set = new Set();
  for(let i=start;i<regWidthBytes(name);i++) set.add(i);
  return set;
}

// Get/set 64-bit value for a register name
function getReg(name) {
  if(is64()) {
    const lo32Map = {RAX:'EAX',RBX:'EBX',RCX:'ECX',RDX:'EDX',RSI:'ESI',RDI:'EDI',RSP:'ESP',RBP:'EBP'};
    if(name==='RSP') return S.regs.ESP;
    if(name==='RBP') return S.regs.EBP;
    const lo = lo32Map[name];
    if(lo) { return S.regs[lo]; /* display only lo32 */ }
    // R8-R15
    if(name.match(/^R\d+$/)) return S.regs[name]||0;
  }
  return S.regs[name]||0;
}
function setReg(name, val32, opts={}) {
  val32 = val32>>>0;
  const track = opts.track !== false;
  const stackVal = clamp(val32, 0, Math.max(S.stackSize, 0));
  if(is64()) {
    const lo32Map = {RAX:'EAX',RBX:'EBX',RCX:'ECX',RDX:'EDX',RSI:'ESI',RDI:'EDI',RSP:'ESP',RBP:'EBP'};
    if(name==='RSP'){ S.regs.ESP=stackVal; if(track) markRegistersChanged(name); return; }
    if(name==='RBP'){ S.regs.EBP=stackVal; if(track) markRegistersChanged(name); return; }
    const lo = lo32Map[name];
    if(lo){ setRegParts(name, val32, 0, opts); return; }
    if(name.match(/^R\d+$/)) { setRegParts(name, val32, 0, opts); return; }
  }
  S.regs[name]=(name==='ESP' || name==='EBP') ? stackVal : val32;
  if(track) markRegistersChanged(name);
}

function getBytes(v32, n) {
  const b=[];
  for(let i=0;i<n;i++) b.push((v32>>>(i*8))&0xFF);
  return b; // [LSB,...,MSB]
}
function ordered(v32, n, end) {
  const b=getBytes(v32,n);
  return end==='little' ? b : [...b].reverse();
}
function orderedBytes(bytes, end) {
  return end==='little' ? [...bytes] : [...bytes].reverse();
}
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function normalizeSpeed(speed) {
  const raw = Number.isFinite(speed) ? speed : 2500;
  return clamp(Math.round(raw), 80, 10000);
}

function normalizeStackSizeBytes(size) {
  const raw = Number.isFinite(size) ? size : DEFAULT_STACK_SIZE;
  return clamp(Math.round(raw), MIN_STACK_SIZE, MAX_STACK_SIZE);
}

function normalizeStackSizeUnit(unit) {
  return unit === 'KB' ? 'KB' : 'B';
}

function preferredStackSizeUnit(size=S.stackSize) {
  const safe = normalizeStackSizeBytes(size);
  return safe >= 1024 && safe % 1024 === 0 ? 'KB' : 'B';
}

function stackSizeUnitFactor(unit=S.stackSizeInputUnit) {
  return normalizeStackSizeUnit(unit) === 'KB' ? 1024 : 1;
}

function trimNumericText(text) {
  return String(text).replace(/\.?0+$/,'');
}

function formatStackSizeInputValue(bytes=S.stackSize, unit=S.stackSizeInputUnit) {
  const safeBytes = normalizeStackSizeBytes(bytes);
  const safeUnit = normalizeStackSizeUnit(unit);
  if(safeUnit === 'KB') {
    const kb = safeBytes / 1024;
    if(Number.isInteger(kb)) return String(kb);
    return trimNumericText(kb.toFixed(kb < 10 ? 3 : 2));
  }
  return String(safeBytes);
}

function formatStackSize(bytes=S.stackSize) {
  const safeBytes = normalizeStackSizeBytes(bytes);
  if(safeBytes < 1024) return `${safeBytes} B`;
  const kb = safeBytes / 1024;
  if(Number.isInteger(kb)) return `${kb} KB`;
  return `${trimNumericText(kb.toFixed(kb < 10 ? 3 : 2))} KB`;
}

function stackHexWidth() {
  return Math.max(4, Math.max(S.stackSize - 1, 0).toString(16).length);
}

function fmtMemA(n) {
  const safe = Math.max(0, Math.trunc(Number.isFinite(n) ? n : 0));
  return safe.toString(16).padStart(Math.max(4, stackHexWidth()), '0').toUpperCase();
}

function fmtStackA(n) {
  return fmtMemA(n);
}

function stackTopInit() {
  return Math.max(S.stackSize, 0);
}

function ensureStackMem() {
  const nextSize = normalizeStackSizeBytes(S.stackSize);
  if(!(S.stackMem instanceof Uint8Array) || S.stackMem.length !== nextSize) {
    S.stackMem = new Uint8Array(nextSize);
  }
  if(!(S.stackState instanceof Map)) S.stackState = new Map();
  S.stackSize = nextSize;
}

function syncLowMemoryToStack() {
  const limit = Math.min(64, S.stackSize);
  for(let i=0;i<limit;i++) S.stackMem[i] = S.mem[i] & 0xFF;
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

function memSpaceSize() {
  return Math.max(64, S.stackSize);
}

function memWindowBytes() {
  return memSpaceSize();
}

function memWindowRows() {
  return Math.max(1, Math.ceil(memWindowBytes() / 8));
}

function memCellPx() {
  const total = memSpaceSize();
  if(total <= 512) return 24;
  if(total <= 4096) return 20;
  if(total <= 16384) return 16;
  if(total <= 65536) return 12;
  if(total <= 262144) return 9;
  return 7;
}

function normalizeMemViewBase(base) {
  void base;
  return 0;
}

function memViewContains(addr) {
  return addr >= 0 && addr < memSpaceSize();
}

function memByteAt(addr) {
  if(addr < 0 || addr >= memSpaceSize()) return 0;
  if(addr < 64) return S.mem[addr] & 0xFF;
  return S.stackMem[addr] & 0xFF;
}

function memStateAt(addr) {
  if(addr < 0 || addr >= memSpaceSize()) return '';
  if(addr < 64) return S.memState[addr] || '';
  return S.stackState.get(addr) || '';
}

function setByteState(addr, st='') {
  if(addr < 0 || addr >= memSpaceSize()) return;
  if(addr < 64) S.memState[addr] = st || '';
  if(addr >= 64) {
    if(st) S.stackState.set(addr, st);
    else S.stackState.delete(addr);
  }
}

function revealMemAddr(addr, opts={}) {
  const target = clamp(Math.trunc(Number.isFinite(addr) ? addr : 0), 0, Math.max(memSpaceSize() - 1, 0));
  if(opts.scroll) memEl(target)?.scrollIntoView({ block:'center', inline:'nearest' });
}

function revealMemRange(addr, width=1, opts={}) {
  const first = clamp(Math.trunc(Number.isFinite(addr) ? addr : 0), 0, Math.max(memSpaceSize() - 1, 0));
  if(opts.scroll) memEl(first)?.scrollIntoView({ block:'center', inline:'nearest' });
}

function stackAccessFits(addr, width) {
  return Number.isInteger(addr) && Number.isInteger(width) && width > 0 && addr >= 0 && (addr + width) <= S.stackSize;
}

function readStackBytes(addr, width) {
  if(!stackAccessFits(addr, width)) return [];
  return Array.from(S.stackMem.slice(addr, addr + width));
}

function writeStackBytes(addr, bytes, st='mc-written') {
  if(!stackAccessFits(addr, bytes.length)) return;
  bytes.forEach((byte, idx) => {
    writeMem(addr + idx, byte & 0xFF, st);
  });
}

function readStackPtrLE(addr, width=ptrSize()) {
  let value = 0;
  const bytes = readStackBytes(addr, width);
  for(let i=0;i<Math.min(4, bytes.length);i++) value |= (bytes[i] & 0xFF) << (i*8);
  return value >>> 0;
}

function reportStackBoundsError(kind, addr, width, asm=null, opts={}) {
  const first = addr;
  const last = addr + width - 1;
  const message = `${kind}: o acesso exige ${width} byte(s), de 0x${fmtStackA(first)} até 0x${fmtStackA(last)}, mas a stack simulada vai de 0x0000 até 0x${fmtStackA(S.stackSize - 1)}.`;
  reportStackError(message, asm, opts);
}

function reportStackError(message, asm=null, opts={}) {
  if(Number.isInteger(opts.pc)) setPC(opts.pc);
  if(opts.halt) {
    S.halt = true;
    S.faulted = true;
  }
  setStatus(message, 'lbl-error', { log:false });
  lg('error', message, asm);
  buildStackView();
}

function clearFaultLatch() {
  if(!S.faulted) return;
  S.faulted = false;
  S.halt = false;
}

function mapAccessFits(addr, width) {
  return Number.isInteger(addr) && Number.isInteger(width) && width > 0 && addr >= 0 && (addr + width - 1) < 64;
}

function mapVisibleRange(addr, width) {
  const out = [];
  for(let i=0;i<width;i++) {
    const ma = addr + i;
    if(ma>=0 && ma<64) out.push(ma);
  }
  return out;
}

function applyMemError(addrs) {
  [...new Set(addrs.filter(idx => idx>=0 && idx<64))].forEach(idx => {
    S.memState[idx] = 'mc-error';
    setMemSt(idx, 'mc-error');
  });
}

function reportMemoryError(addrs, message, asm=null, opts={}) {
  const faultAddrs = [...new Set((addrs || []).filter(idx => idx>=0 && idx<64))];
  if(faultAddrs.length) applyMemError(faultAddrs);
  if(Number.isInteger(opts.pc)) setPC(opts.pc);
  if(opts.halt) {
    S.halt = true;
    S.faulted = true;
  }
  setStatus(message, 'lbl-error', { log:false });
  lg('error', message, asm);
  buildStackView();
  refreshBreakdown();
}

function reportWidthOverflow(kind, addr, width, asm=null, opts={}) {
  const first = addr;
  const last = addr + width - 1;
  const addrs = mapVisibleRange(addr, width);
  reportMemoryError(
    addrs.length ? addrs : [clamp(addr, 0, 63)],
    `${kind}: o acesso exige ${width} byte(s), de 0x${fmtA(first)} até 0x${fmtA(last)}, mas o mapa termina em 0x003F.`,
    asm,
    opts
  );
}

function isInstructionFault(instr) {
  return !!(instr && (instr.unknown || instr.decodeError));
}

function syncSpeedUI() {
  S.speed = normalizeSpeed(S.speed);
  const slider = $('speedSlider');
  const label = $('speedVal');
  if(slider) slider.value = String(S.speed);
  if(label) label.textContent = `${S.speed}ms`;
}

function syncStackSizeUI(displayBytes=S.stackSize) {
  const input = $('stackSizeInput');
  const unitSel = $('stackSizeUnitSelect');
  S.stackSizeInputUnit = normalizeStackSizeUnit(S.stackSizeInputUnit || preferredStackSizeUnit(displayBytes));
  if(unitSel && document.activeElement!==unitSel) unitSel.value = S.stackSizeInputUnit;
  if(input) {
    input.min = S.stackSizeInputUnit === 'KB' ? '0.001' : '1';
    input.max = S.stackSizeInputUnit === 'KB' ? String(MAX_STACK_SIZE / 1024) : String(MAX_STACK_SIZE);
    input.step = S.stackSizeInputUnit === 'KB' ? '0.001' : '1';
    if(document.activeElement!==input) input.value = formatStackSizeInputValue(displayBytes, S.stackSizeInputUnit);
  }
}

function doSetStackSizeUnit(nextUnit) {
  const input = $('stackSizeInput');
  const prevUnit = normalizeStackSizeUnit(S.stackSizeInputUnit || 'B');
  const normalized = normalizeStackSizeUnit(nextUnit);
  let previewBytes = S.stackSize;

  if(input) {
    const raw = parseFloat(input.value || '');
    if(Number.isFinite(raw)) previewBytes = normalizeStackSizeBytes(raw * stackSizeUnitFactor(prevUnit));
  }

  S.stackSizeInputUnit = normalized;
  syncStackSizeUI(previewBytes);
}

function setRunButtonMode(mode='run') {
  setCpuState(mode === 'stop' ? 'running' : 'idle');
}

// idle | running | paused
function setCpuState(state) {
  const grid = $('cpuOpsGrid');
  if(grid) grid.dataset.cpuState = state;
  // Botões de operação fora da CPU (desabilitar durante running/paused)
  const frozen = (state === 'running' || state === 'paused');
  ['opStore','opLoad','opPush','opPop'].forEach(id=>{
    const b=$(id); if(b) b.disabled = frozen;
  });
}

function applyStackSize() {
  const input = $('stackSizeInput');
  const unit = normalizeStackSizeUnit($('stackSizeUnitSelect')?.value || S.stackSizeInputUnit);
  const requested = parseFloat(input?.value || '');
  const fallback = S.stackSize / stackSizeUnitFactor(unit);
  const nextSize = normalizeStackSizeBytes((Number.isFinite(requested) ? requested : fallback) * stackSizeUnitFactor(unit));
  S.stackSizeInputUnit = unit;
  S.stackSize = nextSize;
  resetStackState();
  const stackViewAddr = clamp(Math.max(S.stackSize - ptrSize(), 0), 0, Math.max(memSpaceSize() - 1, 0));
  S.memViewBase = 0;
  markRegistersChanged(spRegs());
  buildRegCards();
  buildRegPicker();
  buildMemGrid();
  syncPicker();
  if(isSpReg(S.reg)) $('valInput').value = fmtA(getReg(S.reg));
  buildStackView();
  refreshPreview();
  refreshBreakdown();
  syncStackSizeUI();
  lg('sys', t('log.sys.stack_size', formatStackSize(nextSize), is64()?'RSP/RBP':'ESP/EBP', fmtStackA(stackTopInit()), fmtMemA(Math.max(memSpaceSize()-1,0))));
}

// ─────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────
function init() {
  if(window.APP_VERSION) {
    const vEl = document.getElementById('appVersion');
    if(vEl) vEl.textContent = window.APP_VERSION;
    document.title = `Intel x86/x64 Memory & Stack Lab ${window.APP_VERSION}`;
  }
  loadSidebarPanelWidth();
  loadStackPanelWidth();
  loadCodeMemSplit();
  initCollapsibleSections();
  applySidebarPanelWidth();
  applyStackPanelWidth();
  applyCenterPaneHeights();
  buildRegCards();
  buildRegPicker();
  buildMemGrid();
  buildStackView();
  initSidebarResize();
  initStackResize();
  initCodeMemSplitResize();
  initCenterPaneResize();
  syncPicker();
  refreshPreview();
  refreshBreakdown();
  refreshStats();
  // Set initial arch button state
  $('archIA32')?.classList.add('active');
  $('archX64') ?.classList.remove('active');
  // Hide QWORD button initially (IA-32 mode)
  $('sQword')?.setAttribute('style','display:none');
  syncSpeedUI();

  $('speedSlider').addEventListener('input', e => {
    S.speed = normalizeSpeed(+e.target.value);
    syncSpeedUI();
  });
  $('asmInput')?.addEventListener('input', refreshAsmValidation);
  $('asmInput')?.addEventListener('blur', refreshAsmValidation);
  $('stackSizeInput')?.addEventListener('change', applyStackSize);
  $('stackSizeInput')?.addEventListener('keydown', e => {
    if(e.key==='Enter') {
      e.preventDefault();
      applyStackSize();
    }
  });
  $('stackSizeUnitSelect')?.addEventListener('change', e => {
    doSetStackSizeUnit(e.target.value);
  });

  // PC input — manual editing
  $('pcDisplay').addEventListener('input', e => {
    const raw = e.target.value.replace(/[^0-9a-fA-F]/g,'').toUpperCase();
    e.target.value = raw;
  });
  $('pcDisplay').addEventListener('change', e => {
    const addr = parseInt(e.target.value||'0',16)&0x3F;
    e.target.value = fmtA(addr);
    setPC(addr, { revealMem:true });
    refreshBreakdown();
    buildStackView();
    lg('sys', t('log.sys.pc_manual', fmtA(addr)));
  });
  $('pcDisplay').addEventListener('keydown', e => {
    if(e.key==='Enter') e.target.blur();
  });

  // Bloqueia a seleção de texto que o browser inicia ao Shift+Click
  $('memGrid').addEventListener('mousedown', e => {
    if(e.shiftKey && e.target.closest('.mem-cell')) e.preventDefault();
  });

  $('memGrid').addEventListener('click', e => {
    const c = e.target.closest('.mem-cell');
    if(!c) return;
    if(c.classList.contains('is-editing') || e.target.closest('.mem-edit-input')) return;
    const addr = +c.dataset.addr;
    if(e.shiftKey) {
      e.preventDefault();
      window.getSelection()?.removeAllRanges();
      toggleBreakpoint(addr);
      return;
    }
    // Resolve para o início da instrução que contém este byte
    const instrAddr = addr < 64 ? instrStartFor(addr) : addr;
    if(addr < 64) {
      setPC(instrAddr, { traceAutoScroll: true });
    }
    refreshBreakdown();
    buildStackView();
  });
  $('memGrid').addEventListener('dblclick', e => {
    const c = e.target.closest('.mem-cell');
    if(!c || c.classList.contains('is-editing') || e.target.closest('.mem-edit-input')) return;
    editMemCell(+c.dataset.addr);
  });
  $('stackView')?.addEventListener('click', e => {
    const row = e.target.closest('.stack-row');
    if(!row) return;
    const addr = parseInt(row.dataset.stackAddr || '0', 10);
    revealMemAddr(addr, { select:true, scroll:true });
    lg('sys', t('log.sys.stack_located', fmtStackA(addr)));
  });
  $('stackView')?.addEventListener('dblclick', e => {
    const row = e.target.closest('.stack-row');
    if(!row) return;
    const addr = parseInt(row.dataset.stackAddr || '0', 10);
    revealMemAddr(addr, { select:true, scroll:true });
    editMemCell(addr);
  });
  $('asmTrace')?.addEventListener('mousedown', e => {
    if(e.target.closest('.bp-dot')) e.preventDefault();
  });

  $('asmTrace')?.addEventListener('click', e => {
    if(e.target.closest('.asm-edit-input')) return;
    const bpDot = e.target.closest('.bp-dot');
    if(bpDot) {
      const addr = parseInt(bpDot.dataset.addr || '0', 16) & 0x3F;
      toggleBreakpoint(addr);
      return;
    }
    const line = e.target.closest('.asm-line, .c-line');
    if(!line) return;
    const addr = parseInt(line.dataset.addr || '0', 16) & 0x3F;
    if(asmTraceClickTimer) clearTimeout(asmTraceClickTimer);
    asmTraceClickTimer = setTimeout(() => {
      asmTraceClickTimer = 0;
      setPC(addr, { revealMem:true });
      buildStackView();
      lg('sys', t('log.sys.pc_moved', fmtA(addr)));
    }, 220);
  });
  $('asmTrace')?.addEventListener('dblclick', e => {
    const line = e.target.closest('.asm-line');
    if(!line || e.target.closest('.asm-edit-input')) return;
    if(asmTraceClickTimer) {
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
  buildMemGrid();
  buildStackView();
  refreshAsmValidation();
  refreshBreakdown();
  setStatus(t('status.demo_loaded'),'lbl-done');
  lg('sys', t('log.sys.demo_loaded', is64()?'x86-64':'IA-32'));
  lg('sys', demoProgramForArch().listing.join(' | '));
  applyCollapsedSections();
  applyCenterPaneHeights();
  applyCodeMemSplit();
  if(typeof window !== 'undefined') window.addEventListener('resize', () => {
    applyCenterPaneHeights();
    applyCodeMemSplit();
    syncAsmTraceHeight();
  });
}

function loadStackPanelWidth() {
  try {
    const manual = localStorage.getItem('memsim.stackPanelManual') === '1';
    const saved = parseInt(localStorage.getItem('memsim.stackPanelWidth') || '', 10);
    if(manual && Number.isFinite(saved)) {
      S.stackPanelManual = true;
      S.stackPanelWidth = clamp(saved, 220, 520);
    } else {
      S.stackPanelManual = false;
    }
  } catch(_) {}
}

function loadCodeMemSplit() {
  try {
    const manual = localStorage.getItem('memsim.codeMemSplitManual') === '1';
    const saved = parseInt(localStorage.getItem('memsim.codeMemSplitWidth') || '', 10);
    if(manual && Number.isFinite(saved)) {
      S.codeMemSplitManual = true;
      S.codeMemSplitWidth = saved;
    } else {
      S.codeMemSplitManual = false;
      S.codeMemSplitWidth = 0;
    }
  } catch(_) {}
}

function loadSidebarPanelWidth() {
  try {
    const manual = localStorage.getItem('memsim.sidebarPanelManual') === '1';
    const saved = parseInt(localStorage.getItem('memsim.sidebarPanelWidth') || '', 10);
    if(manual && Number.isFinite(saved)) {
      S.sidebarPanelManual = true;
      S.sidebarPanelWidth = clamp(saved, 220, 420);
    } else {
      S.sidebarPanelManual = false;
    }
  } catch(_) {}
}

function loadCenterPaneHeights() {
  try {
    const raw = localStorage.getItem('memsim.centerPaneHeights');
    if(!raw) return;
    const saved = JSON.parse(raw);
    if(!saved || typeof saved !== 'object') return;
    Object.keys(CENTER_PANE_CONFIG).forEach(key => {
      const height = parseInt(saved[key], 10);
      if(Number.isFinite(height)) S.centerPaneHeights[key] = height;
    });
  } catch(_) {}
}

function loadCollapsedSections() {
  try {
    const raw = localStorage.getItem('memsim.collapsedSections');
    if(!raw) return;
    const saved = JSON.parse(raw);
    if(saved && typeof saved === 'object') S.collapsedSections = { ...saved };
  } catch(_) {}
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
  if(!split || !handle || !memPane || !asmPane) return;

  const total = Math.round(split.getBoundingClientRect().width || split.clientWidth || 0);
  if(!total) return;

  const handleW = Math.max(handle.getBoundingClientRect().width || 0, 10);
  const minPane = codeMemSplitMinPane(total);
  const memCollapsed = !!S.collapsedSections[sectionStateId(memPane)];
  const asmCollapsed = !!S.collapsedSections[sectionStateId(asmPane)];

  memPane.classList.toggle('is-collapsed', memCollapsed);
  asmPane.classList.toggle('is-collapsed', asmCollapsed);

  if(memCollapsed && asmCollapsed) {
    handle.hidden = true;
    split.style.gridTemplateColumns = 'minmax(0, 1fr) 0px minmax(0, 1fr)';
    return;
  }

  if(memCollapsed) {
    handle.hidden = true;
    const collapsed = clamp(Math.round(total * 0.28), 210, 320);
    split.style.gridTemplateColumns = `${collapsed}px 0px minmax(0, 1fr)`;
    return;
  }

  if(asmCollapsed) {
    handle.hidden = true;
    const collapsed = clamp(Math.round(total * 0.28), 210, 320);
    split.style.gridTemplateColumns = `minmax(0, 1fr) 0px ${collapsed}px`;
    return;
  }

  handle.hidden = false;
  if(!S.codeMemSplitManual) {
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
  if(!shell) return;
  if(S.sidebarPanelManual) shell.style.setProperty('--sidebar-w', `${clamp(S.sidebarPanelWidth, 220, 420)}px`);
  else shell.style.removeProperty('--sidebar-w');
  applyCodeMemSplit();
}

function persistSidebarPanelWidth() {
  try {
    if(S.sidebarPanelManual) {
      localStorage.setItem('memsim.sidebarPanelManual', '1');
      localStorage.setItem('memsim.sidebarPanelWidth', String(clamp(S.sidebarPanelWidth, 220, 420)));
    } else {
      localStorage.removeItem('memsim.sidebarPanelManual');
      localStorage.removeItem('memsim.sidebarPanelWidth');
    }
  } catch(_) {}
}

function applyStackPanelWidth() {
  const shell = $('appShell');
  if(!shell) return;
  if(S.stackPanelManual) shell.style.setProperty('--stack-panel-w', `${clamp(S.stackPanelWidth, 220, 520)}px`);
  else shell.style.removeProperty('--stack-panel-w');
  applyCodeMemSplit();
}

function persistStackPanelWidth() {
  try {
    if(S.stackPanelManual) {
      localStorage.setItem('memsim.stackPanelManual', '1');
      localStorage.setItem('memsim.stackPanelWidth', String(clamp(S.stackPanelWidth, 220, 520)));
    } else {
      localStorage.removeItem('memsim.stackPanelManual');
      localStorage.removeItem('memsim.stackPanelWidth');
    }
  } catch(_) {}
}

function persistCodeMemSplit() {
  try {
    if(S.codeMemSplitManual) {
      localStorage.setItem('memsim.codeMemSplitManual', '1');
      localStorage.setItem('memsim.codeMemSplitWidth', String(Math.max(0, Math.round(S.codeMemSplitWidth || 0))));
    } else {
      localStorage.removeItem('memsim.codeMemSplitManual');
      localStorage.removeItem('memsim.codeMemSplitWidth');
    }
  } catch(_) {}
}

function applyCenterPaneHeights() {
  Object.entries(CENTER_PANE_CONFIG).forEach(([key, cfg]) => {
    const pane = $(key);
    if(!pane) return;
    if(S.collapsedSections[key]) {
      pane.classList.remove('pane-manual');
      pane.style.flex = '0 0 auto';
      pane.style.flexBasis = 'auto';
      pane.style.height = 'auto';
      return;
    }
    const hasManual = Number.isFinite(S.centerPaneHeights[key]);
    pane.classList.toggle('pane-manual', hasManual);
    if(!hasManual) {
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
  } catch(_) {}
}

function persistCollapsedSections() {
  try {
    localStorage.setItem('memsim.collapsedSections', JSON.stringify(S.collapsedSections || {}));
  } catch(_) {}
}

function sectionStateId(el, fallbackPrefix='section') {
  if(!el) return '';
  if(el.id) return el.id;
  if(el.dataset.sectionId) return el.dataset.sectionId;
  const header = el.querySelector('.ctrl-label, .section-badge');
  const label = (header?.textContent || `${fallbackPrefix}`).trim().replace(/\s+/g,'-').toLowerCase();
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
  if(!el) return;
  [...el.childNodes].forEach(node => {
    if(node.nodeType===Node.TEXT_NODE && node.textContent.trim()) node.remove();
  });
  let textNode = el.querySelector(':scope > .section-header-text');
  if(!textNode) {
    textNode = document.createElement('span');
    textNode.className = 'section-header-text';
    const collapseBtn = el.querySelector(':scope > .section-collapse-btn');
    el.insertBefore(textNode, collapseBtn || el.firstChild);
  }
  textNode.textContent = text;
}

function setToggleVisual(btn, collapsed) {
  if(!btn) return;
  btn.textContent = collapsed ? '+' : '−';
  btn.title = collapsed ? t('ui.section.expand') : t('ui.section.collapse');
  btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
}

function ensureCtrlSectionBodies() {
  $$('#sidebar .ctrl-section, #rightPanel .ctrl-section').forEach((section, idx) => {
    const label = section.querySelector(':scope > .ctrl-label');
    if(!label) return;
    if(!section.dataset.sectionId) {
      section.dataset.sectionId = section.closest('#sidebar') ? `sidebar-${idx}` : `right-${idx}`;
    }
    const sectionId = sectionStateId(section, section.closest('#sidebar') ? 'sidebar' : 'right');
    if(!label.querySelector('.section-collapse-btn')) createCollapseButton(label, sectionId);
    let body = section.querySelector(':scope > .ctrl-section-body');
    if(!body) {
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
    if(!body) return;
    const paneId = sectionStateId(pane, `canvas-${idx}`);
    let head = pane.querySelector(':scope > .section-badge');
    if(!head) {
      head = body.querySelector(':scope > .section-badge');
      if(head) pane.insertBefore(head, body);
    }
    if(!head) return;
    if(!head.querySelector('.section-collapse-btn')) createCollapseButton(head, paneId);
  });
}

function ensureSplitPaneHeads() {
  $$('.split-pane').forEach((pane, idx) => {
    const body = pane.querySelector(':scope > .split-pane-body');
    if(!body) return;
    const paneId = sectionStateId(pane, `split-${idx}`);
    let head = pane.querySelector(':scope > .section-badge');
    if(!head) {
      head = body.querySelector(':scope > .section-badge');
      if(head) pane.insertBefore(head, body);
    }
    if(!head) return;
    if(!head.querySelector('.section-collapse-btn')) createCollapseButton(head, paneId);
  });
}

function applyCollapsedSections() {
  $$('.ctrl-section, .canvas-pane, .split-pane').forEach(section => {
    const sectionId = sectionStateId(section);
    const collapsed = !!S.collapsedSections[sectionId];
    section.classList.toggle('is-collapsed', collapsed);
    const body = section.querySelector(':scope > .ctrl-section-body, :scope > .canvas-pane-body, :scope > .split-pane-body');
    const handle = section.querySelector(':scope > .canvas-pane-handle, :scope > .split-pane-handle');
    if(body) body.hidden = collapsed;
    if(handle) handle.hidden = collapsed;
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

function resetCoreRegisters() {
  S.regs.EAX=0xDEADBEEF; S.regs.EBX=0xCAFEBABE; S.regs.ECX=0x12345678; S.regs.EDX=0xABCD1234;
  S.regs.ESI=0; S.regs.EDI=0;
  S.regs.RAX_hi=0; S.regs.RBX_hi=0; S.regs.RCX_hi=0; S.regs.RDX_hi=0;
  S.regs.RSI_hi=0; S.regs.RDI_hi=0;
  ['R8','R9','R10','R11','R12','R13','R14','R15'].forEach(r=>{ S.regs[r]=0; S.regs[r+'_hi']=0; });
  S.regs.ESP=stackTopInit(); S.regs.EBP=stackTopInit();
  S.changedRegs = [];
}

function resetStatsState() {
  S.stats = {
    ops:0, totalTime:0, loads:0, stores:0,
    loadTimes:[], storeTimes:[], littleOps:0, bigOps:0,
  };
}

function loadDefaultProgram(announce=true, arch=S.arch) {
  const program = demoProgramForArch(arch);
  S.mem.fill(0);
  S.memState.fill('');
  resetStackState();
  S.faulted = false;
  program.bytes.forEach((byte, idx) => {
    S.mem[idx] = byte;
    if(idx < S.stackSize) S.stackMem[idx] = byte;
    S.memState[idx] = 'mc-written';
  });
  S.memViewBase = 0;
  setPC(program.entry);
  if(announce) {
    lg('sys', t('log.sys.demo_arch', arch==='x64'?'x86-64':'IA-32'));
    lg('sys', program.listing.join(' | '));
  }
}

function changedRegisterSet() {
  return new Set(Array.isArray(S.changedRegs) ? S.changedRegs : []);
}

function updateChangedRegisterClasses() {
  const changed = changedRegisterSet();
  [...gpRegs(), ...extRegs(), ...spRegs()].forEach(name => {
    $('rc-'+name)?.classList.toggle('reg-changed', changed.has(name));
    $('r'+name)?.classList.toggle('reg-changed', changed.has(name));
  });
}

function markRegistersChanged(names, opts={}) {
  const incoming = [...new Set((Array.isArray(names) ? names : [names]).filter(Boolean))];
  const replace = opts.replace !== false;
  const next = replace ? incoming : [...new Set([...(Array.isArray(S.changedRegs) ? S.changedRegs : []), ...incoming])];
  S.changedRegs = next;
  updateChangedRegisterClasses();
}

function clearChangedRegisters() {
  S.changedRegs = [];
  updateChangedRegisterClasses();
}

function traceBlock(startAddr, maxLines=20) {
  const lines = [];
  const visited = new Set();
  let pc = startAddr & 0x3F;

  while(lines.length < maxLines && !visited.has(pc)) {
    visited.add(pc);
    const instr = decodeAt(pc);
    const size = Math.max(instr.size || 1, 1);
    const bytes = [];
    for(let i=0;i<size;i++) bytes.push(hex8(S.mem[(pc+i)&0x3F]));
    lines.push({
      addr: pc,
      size,
      bytes: bytes.join(' '),
      asm: instr.asm || instr.mnem || `DB 0x${hex8(S.mem[pc])}`,
      c: cForInstr(instr, pc),
    });
    pc = (pc + size) & 0x3F;
    if(instr.op===0xF4) break;
  }

  return lines;
}

function traceProgram(program=demoProgramForArch()) {
  const lines = [];
  const visited = new Set();
  let pc = program.entry & 0x3F;
  let consumed = 0;
  const limit = Math.min(program.bytes.length, 64);

  while(consumed < limit && !visited.has(pc)) {
    visited.add(pc);
    const instr = decodeAt(pc);
    const size = Math.max(instr.size || 1, 1);
    const bytes = [];
    for(let i=0;i<size;i++) bytes.push(hex8(S.mem[(pc+i)&0x3F]));
    lines.push({
      addr: pc,
      size,
      bytes: bytes.join(' '),
      asm: instr.asm || instr.mnem || `DB 0x${hex8(S.mem[pc])}`,
      c: cForInstr(instr, pc),
    });
    pc = (pc + size) & 0x3F;
    consumed += size;
  }

  return lines;
}

function cScalarType(bits) {
  return bits===64 ? 'uint64_t' : 'uint32_t';
}

function cForInstr(instr, addr) {
  const asm = instr.asm || instr.mnem || `DB 0x${hex8(S.mem[addr & 0x3F])}`;
  let m = null;

  if(instr.unknown) return { kind:'pseudo', label:'PSEUDO', code:`db(0x${hex8(instr.op)});` };
  if(asm==='NOP') return { kind:'pseudo', label:'PSEUDO', code:'/* no-op */' };
  if(asm==='HLT') return { kind:'pseudo', label:'PSEUDO', code:'HALT_CPU();' };
  if(asm==='RET') return { kind:'c', label:'C', code:'return;' };
  if((m = /^CALL 0X([0-9A-F]+)$/.exec(asm))) return { kind:'c', label:'C', code:`fn_0x${m[1]}();` };
  if((m = /^JMP SHORT 0X([0-9A-F]+)$/.exec(asm))) return { kind:'c', label:'C', code:`goto loc_0x${m[1]};` };
  if((m = /^PUSH ([A-Z0-9]+)$/.exec(asm))) return { kind:'pseudo', label:'PSEUDO', code:`STACK.push(${m[1]});` };
  if((m = /^POP ([A-Z0-9]+)$/.exec(asm))) return { kind:'pseudo', label:'PSEUDO', code:`${m[1]} = STACK.pop();` };
  if((m = /^MOV ([A-Z0-9]+), 0X([0-9A-F]+)$/.exec(asm))) return { kind:'c', label:'C', code:`${m[1]} = 0x${m[2]};` };
  if((m = /^MOV ([A-Z0-9]+), ([A-Z0-9]+)$/.exec(asm))) return { kind:'c', label:'C', code:`${m[1]} = ${m[2]};` };
  if((m = /^MOV (QWORD|DWORD) PTR \[0X([0-9A-F]+)\], ([A-Z0-9]+)$/.exec(asm))) {
    return { kind:'c', label:'C', code:`*((${cScalarType(m[1]==='QWORD' ? 64 : 32)}*)0x${m[2]}) = ${m[3]};` };
  }
  if((m = /^MOV ([A-Z0-9]+), (QWORD|DWORD) PTR \[0X([0-9A-F]+)\]$/.exec(asm))) {
    return { kind:'c', label:'C', code:`${m[1]} = *((${cScalarType(m[2]==='QWORD' ? 64 : 32)}*)0x${m[3]});` };
  }
  if((m = /^DB 0X([0-9A-F]+)$/.exec(asm))) return { kind:'pseudo', label:'PSEUDO', code:`db(0x${m[1]});` };
  return { kind:'pseudo', label:'PSEUDO', code:`/* ${asm} */` };
}

function ensureCurrentTraceVisible() {
  const root = $('asmTrace');
  if(!root) return;
  const currentRow = root.querySelector('.trace-row-current');
  if(!currentRow) return;
  // scrollIntoView with block:'nearest' moves the scroll only if the element
  // is outside the visible area — it never steals keyboard focus.
  currentRow.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
}

function codeLabelAt(addr) {
  const at = addr & 0x3F;
  const instr = decodeAt(at);
  return instr.asm || instr.mnem || `DB 0x${hex8(S.mem[at])}`;
}

function callSiteForReturn(retAddr) {
  const addr = retAddr & 0x3F;
  const callAddr = (addr - 5 + 64) & 0x3F;
  const instr = decodeAt(callAddr);
  if(instr.op!==0xE8) return null;
  return {
    addr: callAddr,
    asm: instr.asm || instr.mnem || `CALL 0x${fmtA(addr)}`,
  };
}

function normalizeStackTraceCall(frame) {
  if(!frame) return null;
  const callSite = frame.callSite & 0x3F;
  const decoded = decodeAt(callSite);
  return {
    slot: frame.slot >>> 0,
    width: frame.width || ptrSize(),
    returnTo: frame.returnTo & 0x3F,
    callSite,
    callAsm: decoded.asm || frame.callAsm || `CALL @ 0x${fmtA(callSite)}`,
  };
}

function currentReturnInfo() {
  const top = normalizeStackTraceCall(S.callFrames[S.callFrames.length - 1]);
  if(top) return top;

  const bp = S.regs.EBP >>> 0;
  if(!stackAccessFits(bp, ptrSize())) return null;
  const retSlot = bp + ptrSize();
  if(!stackAccessFits(retSlot, ptrSize())) return null;
  const retAddr = readStackPtrLE(retSlot, ptrSize()) & 0x3F;
  const callSite = callSiteForReturn(retAddr);
  if(!callSite) return null;

  return {
    slot: retSlot,
    width: ptrSize(),
    returnTo: retAddr,
    callSite: callSite.addr & 0x3F,
    callAsm: callSite.asm || `CALL 0x${fmtA(retAddr)}`,
  };
}

function stackTraceExtra(frameCall) {
  if(!frameCall) return 'Frame raiz: nenhuma chamada ativa e nenhum endereco de retorno pendente.';
  return `<span class="stack-trace-ret-addr">RET → 0x${fmtA(frameCall.returnTo)}</span> · slot [0x${fmtStackA(frameCall.slot)}] · entrou via ${frameCall.callAsm} @ 0x${fmtA(frameCall.callSite)}`;
}

function stackTraceFrames() {
  const calls = (S.callFrames || []).map(normalizeStackTraceCall).filter(Boolean);
  if(calls.length) {
    const items = [];
    const total = Math.min(calls.length + 1, 9);
    for(let depth = 0; depth < total; depth++) {
      const addr = depth===0
        ? (S.pc & 0x3F)
        : (calls[calls.length - depth].returnTo & 0x3F);
      const frameCall = (calls.length - 1 - depth) >= 0
        ? calls[calls.length - 1 - depth]
        : null;
      items.push({
        kind: depth===0 ? 'current' : (frameCall ? 'caller' : 'root'),
        label: depth===0 ? 'ATUAL' : (frameCall ? 'CHAMADOR' : 'RAIZ'),
        depth,
        addr,
        asm: codeLabelAt(addr),
        extra: stackTraceExtra(frameCall),
      });
    }
    return items;
  }

  const items = [];
  const visitedBp = new Set();
  let bp = S.regs.EBP >>> 0;
  let currentAddr = S.pc & 0x3F;

  for(let depth = 0; depth <= 8; depth++) {
    let frameCall = null;
    if(stackAccessFits(bp, ptrSize())) {
      const retSlot = bp + ptrSize();
      if(stackAccessFits(retSlot, ptrSize())) {
        const retAddr = readStackPtrLE(retSlot, ptrSize()) & 0x3F;
        const callSite = callSiteForReturn(retAddr);
        if(callSite) {
          frameCall = {
            slot: retSlot,
            width: ptrSize(),
            returnTo: retAddr,
            callSite: callSite.addr & 0x3F,
            callAsm: callSite.asm || `CALL 0x${fmtA(retAddr)}`,
          };
        }
      }
    }

    items.push({
      kind: depth===0 ? 'current' : (frameCall ? 'caller' : 'root'),
      label: depth===0 ? 'ATUAL' : (frameCall ? 'CHAMADOR' : 'RAIZ'),
      depth,
      addr: currentAddr,
      asm: codeLabelAt(currentAddr),
      extra: stackTraceExtra(frameCall),
    });

    if(!frameCall || !stackAccessFits(bp, ptrSize()) || visitedBp.has(bp)) break;
    const prevBp = readStackPtrLE(bp, ptrSize()) >>> 0;
    if(prevBp===bp) break;
    visitedBp.add(bp);
    currentAddr = frameCall.returnTo & 0x3F;
    bp = prevBp;
  }

  return items;
}

function buildStackTrace() {
  const items = stackTraceFrames();
  const rows = [...items].reverse().map((item, i) => `
    <div class="stack-trace-row stack-trace-row-${item.kind}">
      <span class="stack-trace-depth">#${i}</span>
      <span class="stack-trace-kind">${item.label}</span>
      <span class="stack-trace-addr">0x${fmtA(item.addr)}</span>
      <span class="stack-trace-asm">${item.asm}</span>
      <span class="stack-trace-extra">${item.extra}</span>
    </div>
  `).join('');

  return `
    <div class="stack-trace">
      <div class="stack-trace-hd">
        <span>BACKTRACE</span>
        <span class="stack-trace-hint">ordem das chamadas ativas e seus enderecos de retorno</span>
      </div>
      <div class="stack-trace-list">${rows}</div>
      ${items.length===1 && items[0].kind==='root' ? '<div class="stack-trace-empty">Nenhuma chamada ativa no momento. O programa esta no frame raiz.</div>' : ''}
    </div>`;
}

function renderTraceByteChips(bytesText) {
  const tokens = String(bytesText || '').trim().split(/\s+/).filter(Boolean);
  if(!tokens.length) return '<span class="asm-byte asm-byte-empty">--</span>';
  return tokens.map(tok => `<span class="asm-byte">${tok}</span>`).join('');
}

function buildAsmTrace(opts={}) {
  const root = $('asmTrace');
  if(!root) return;
  const autoScroll = opts.autoScroll === true;

  const primary = traceProgram(demoProgramForArch());
  const currentShown = primary.some(line => line.addr===S.pc);
  let lines = primary;

  if(!currentShown) {
    lines = [
      ...primary,
      {separator:true},
      ...traceBlock(S.pc, 8),
    ];
  }

  root.innerHTML = lines.length
    ? lines.map(line => {
        if(line.separator) return '<div class="trace-separator">PC atual fora do fluxo principal. Abaixo, decode local a partir do PC.</div>';
        const byteChips = renderTraceByteChips(line.bytes);
        const hasBp = S.breakpoints.has(line.addr);
        const bpNum = hasBp ? bpNumber(line.addr) : 0;
        const isHit = hasBp && S.breakpointHit === line.addr && S.paused;
        return `<div class="trace-row${line.addr===S.pc ? ' trace-row-current' : ''}${hasBp ? ' trace-row-bp' : ''}${isHit ? ' trace-row-bp-hit' : ''}">
          <div class="asm-line${line.addr===S.pc ? ' asm-line-current' : ''}" data-addr="${fmtA(line.addr)}" data-size="${line.size || 1}" title="${t('asm.nav.title')}">
            <div class="asm-line-head">
              <span class="bp-dot${hasBp ? ' bp-dot-active' : ''}${isHit ? ' bp-dot-hit' : ''}" data-addr="${fmtA(line.addr)}" title="${hasBp ? t('asm.bp.remove', bpNum) : t('asm.bp.set')}">${hasBp ? bpNum : ''}</span>
              <span class="asm-line-addr">0x${fmtA(line.addr)}</span>
              <span class="asm-line-size">${line.size || 1}B</span>
            </div>
            <div class="asm-line-bytes">${byteChips}</div>
            <div class="asm-line-asm">${line.asm}</div>
          </div>
          <div class="c-line${line.addr===S.pc ? ' c-line-current' : ''}" data-addr="${fmtA(line.addr)}" title="${t('asm.pseudocode.title')}">
            <div class="c-line-head">
              <span class="c-line-addr">0x${fmtA(line.addr)}</span>
              <span class="c-line-kind c-line-kind-${line.c.kind}">${line.c.label}</span>
            </div>
            <div class="c-line-main">
              <span class="c-line-code">${line.c.code}</span>
            </div>
          </div>
        </div>`;
      }).join('')
    : '<div class="trace-separator">Nenhuma instrucao disponivel para listar.</div>';

  if(autoScroll) requestAnimationFrame(() => requestAnimationFrame(ensureCurrentTraceVisible));
  scheduleCenterPaneLayout();
}

function initStackResize() {
  const handle = $('stackResizeHandle');
  const shell = $('appShell');
  if(!handle || !shell) return;

  handle.addEventListener('mousedown', e => {
    if(window.innerWidth <= 1100) return;
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
  if(!handle || !shell) return;

  handle.addEventListener('mousedown', e => {
    if(window.innerWidth <= 760) return;
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
  if(!split || !handle) return;

  handle.addEventListener('mousedown', e => {
    if(handle.hidden) return;
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
      if(!pane) return;
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

// ─────────────────────────────────────────────────────────
// REGISTER CARDS
// ─────────────────────────────────────────────────────────
function parseRegisterInput(name, raw) {
  const clean = raw.replace(/[^0-9a-fA-F]/g,'').toUpperCase();
  if(isSpReg(name)) return {lo:parseInt(clean||'0',16)>>>0, hi:0};
  const width = regWidthBytes(name)===8 ? 16 : 8;
  const hex = clean.padStart(width,'0').slice(-width);
  if(width===16) {
    return {
      hi: parseInt(hex.slice(0,8)||'0',16)>>>0,
      lo: parseInt(hex.slice(8)||'0',16)>>>0,
    };
  }
  return {lo:parseInt(hex||'0',16)>>>0, hi:0};
}

function commitRegisterValue(name, raw) {
  const {lo,hi} = parseRegisterInput(name, raw);
  setRegParts(name, lo, hi);
  buildRegCards();
  buildRegPicker();
  syncPicker();
  if(name===S.reg) {
    const maxHex=Math.min(sizeN()*2, regWidthBytes(name)*2);
    $('valInput').value = isSpReg(name) ? fmtA(getReg(name)) : regHex(name).slice(-maxHex);
    refreshPreview();
    refreshBreakdown();
  }
  buildStackView();
  lg('sys', t('log.sys.reg_set', name, isSpReg(name)?fmtA(getReg(name)):regHex(name)));
}

// Make a register value element editable on click
function makeRegisterEditable(el, name) {
  if(el.dataset.editing) return;
  el.dataset.editing = '1';
  const isSp = isSpReg(name);
  const cur = isSp ? fmtA(getReg(name)) : regHex(name);
  const inp = document.createElement('input');
  inp.className = 'rc-edit-input';
  inp.type = 'text';
  inp.maxLength = isSp ? 4 : regWidthBytes(name)*2;
  inp.value = cur;
  inp.spellcheck = false;
  const prevHTML = el.innerHTML;
  el.innerHTML = '';
  el.appendChild(inp);
  inp.focus(); inp.select();

  function commit() {
    commitRegisterValue(name, inp.value);
    delete el.dataset.editing;
  }
  function cancel() {
    delete el.dataset.editing;
    el.innerHTML = prevHTML;
  }
  inp.addEventListener('keydown', e => {
    if(e.key==='Enter') { e.preventDefault(); commit(); }
    else if(e.key==='Escape') { e.preventDefault(); cancel(); }
    else { // allow only hex chars
      if(e.key.length===1 && !/[0-9a-fA-F]/.test(e.key) && !e.ctrlKey && !e.metaKey) e.preventDefault();
    }
  });
  inp.addEventListener('blur', () => { if(el.dataset.editing) commit(); });
}

function buildRegCards() {
  const gp = gpRegs(), sp = spRegs(), ext = extRegs();

  // Update section badge
  const gpBadge=$('gpBadge');
  if(gpBadge) setSectionHeaderText(gpBadge, is64() ? 'REGISTRADORES DE USO GERAL (64-bit)' : 'REGISTRADORES DE USO GERAL');

  // Main GP reg cards
  const g=$('regCards'); g.innerHTML='';
  g.style.gridTemplateColumns = gp.length > 1 ? 'repeat(2, minmax(0, 1fr))' : `repeat(${gp.length}, 1fr)`;
  for(const name of gp) {
    const d=document.createElement('div');
    const sel = name===S.reg;
    d.className='reg-card'+(sel?' rc-selected':'');
    d.id='rc-'+name;
    d.onclick=(e)=>{ if(!e.target.closest('.rc-edit-input')) App.selectReg(name); };
    const valueHex = regHex(name);
    if(is64()) {
      d.innerHTML=`<div class="rc-name">${name}</div>
        <div class="rc-value rc-val64 rc-value-editable" id="rcv-${name}" title="${t('ui.reg.edit.title')}"><span class="rc-hi">${valueHex.slice(0,8)}</span><span class="rc-lo">${valueHex.slice(8)}</span></div>
        <div class="rc-subregs" id="rcs-${name}">${renderRegisterEncapsulation(name)}</div>
        <div class="rc-bytes" id="rcb-${name}">${renderByteStrip(name)}</div>`;
    } else {
      d.innerHTML=`<div class="rc-name">${name}</div>
        <div class="rc-value rc-value-editable" id="rcv-${name}" title="${t('ui.reg.edit.title')}">${valueHex}</div>
        <div class="rc-subregs" id="rcs-${name}">${renderRegisterEncapsulation(name)}</div>
        <div class="rc-bytes" id="rcb-${name}">${renderByteStrip(name)}</div>`;
    }
    d.querySelector('.rc-value').addEventListener('click', e => {
      e.stopPropagation();
      makeRegisterEditable(d.querySelector('.rc-value'), name);
    });
    g.appendChild(d);
  }

  // R8-R15 extension cards (x64 only)
  const eg=$('extCards'); if(eg) {
    eg.innerHTML='';
    eg.style.gridTemplateColumns = ext.length ? 'repeat(4, minmax(0, 1fr))' : '';
    for(const name of ext) {
      const d=document.createElement('div');
      d.className='reg-card rc-ext'+(name===S.reg?' rc-selected':'');
      d.id='rc-'+name;
      d.onclick=(e)=>{ if(!e.target.closest('.rc-edit-input')) App.selectReg(name); };
      const valueHex=regHex(name);
      d.innerHTML=`<div class="rc-name">${name}</div>
        <div class="rc-value rc-val64 rc-value-editable" id="rcv-${name}" title="${t('ui.reg.edit.title')}"><span class="rc-hi">${valueHex.slice(0,8)}</span><span class="rc-lo">${valueHex.slice(8)}</span></div>
        <div class="rc-bytes" id="rcb-${name}">${renderByteStrip(name)}</div>`;
      d.querySelector('.rc-value').addEventListener('click', e => {
        e.stopPropagation();
        makeRegisterEditable(d.querySelector('.rc-value'), name);
      });
      eg.appendChild(d);
    }
    eg.style.display = ext.length ? '' : 'none';
    const badge=$('extBadge'); if(badge) badge.style.display = ext.length ? '' : 'none';
  }

  // Stack pointer cards
  const sg=$('spCards'); if(!sg) return;
  sg.innerHTML='';
  for(const name of sp) {
    const d=document.createElement('div');
    const role = stackRoleClass(name);
    const roleLabel = isStackTopReg(name) ? 'TOPO' : 'BASE';
    d.className='reg-card rc-sp rc-sp-'+role+(name===S.reg?' rc-selected':'');
    d.id='rc-'+name;
    d.innerHTML=`<div class="rc-sp-meta">
        <div class="rc-name">${name}</div>
        <div class="rc-sp-role">${roleLabel}</div>
      </div>
      <div class="rc-sp-body">
        <div class="rc-value rc-value-sp rc-value-editable" id="rcv-${name}" title="${t('ui.reg.edit.title')}">0x${fmtA(getReg(name))}</div>
        <div class="rc-subregs rc-subregs-sp" id="rcs-${name}">${renderRegisterEncapsulation(name)}</div>
      </div>`;
    d.querySelector('.rc-value').addEventListener('click', e => {
      e.stopPropagation();
      makeRegisterEditable(d.querySelector('.rc-value'), name);
    });
    sg.appendChild(d);
  }
  updateChangedRegisterClasses();
  scheduleCenterPaneLayout();
}

function registerMapWidthBytes(name) {
  return is64() && (name==='RSP' || name==='RBP') ? 8 : regWidthBytes(name);
}

function registerEncapsulationRows(name) {
  const classic = {
    EAX:{word:'AX', high:'AH', low:'AL', size:4},
    EBX:{word:'BX', high:'BH', low:'BL', size:4},
    ECX:{word:'CX', high:'CH', low:'CL', size:4},
    EDX:{word:'DX', high:'DH', low:'DL', size:4},
    ESI:{word:'SI', size:4},
    EDI:{word:'DI', size:4},
    ESP:{word:'SP', size:4},
    EBP:{word:'BP', size:4},
    RAX:{dword:'EAX', word:'AX', high:'AH', low:'AL', size:8},
    RBX:{dword:'EBX', word:'BX', high:'BH', low:'BL', size:8},
    RCX:{dword:'ECX', word:'CX', high:'CH', low:'CL', size:8},
    RDX:{dword:'EDX', word:'DX', high:'DH', low:'DL', size:8},
  };
  const lowOnly = {
    RSI:{dword:'ESI', word:'SI', low:'SIL', size:8},
    RDI:{dword:'EDI', word:'DI', low:'DIL', size:8},
    RSP:{dword:'ESP', word:'SP', low:'SPL', size:8},
    RBP:{dword:'EBP', word:'BP', low:'BPL', size:8},
    R8: {dword:'R8D',  word:'R8W',  low:'R8B', size:8},
    R9: {dword:'R9D',  word:'R9W',  low:'R9B', size:8},
    R10:{dword:'R10D', word:'R10W', low:'R10B', size:8},
    R11:{dword:'R11D', word:'R11W', low:'R11B', size:8},
    R12:{dword:'R12D', word:'R12W', low:'R12B', size:8},
    R13:{dword:'R13D', word:'R13W', low:'R13B', size:8},
    R14:{dword:'R14D', word:'R14W', low:'R14B', size:8},
    R15:{dword:'R15D', word:'R15W', low:'R15B', size:8},
  };

  if(classic[name]) {
    const rows = [];
    if(classic[name].dword) rows.push({ label:classic[name].dword, bits:32, start:0, count:4, tone:'dword' });
    rows.push({ label:classic[name].word, bits:16, start:0, count:2, tone:'word' });
    if(classic[name].high && classic[name].low) {
      rows.push({ label:classic[name].high, bits:8, start:1, count:1, tone:'high' });
      rows.push({ label:classic[name].low, bits:8, start:0, count:1, tone:'low' });
    } else if(classic[name].low) {
      rows.push({ label:classic[name].low, bits:8, start:0, count:1, tone:'low' });
    }
    return rows;
  }

  if(lowOnly[name]) {
    return [
      { label:lowOnly[name].dword, bits:32, start:0, count:4, tone:'dword' },
      { label:lowOnly[name].word, bits:16, start:0, count:2, tone:'word' },
      { label:lowOnly[name].low, bits:8, start:0, count:1, tone:'low' },
    ];
  }

  return [];
}

function renderRegisterEncapsulation(name) {
  const rows = registerEncapsulationRows(name);
  if(!rows.length) return '';
  const totalBytes = registerMapWidthBytes(name);
  const displayBytes = regBytes(name, totalBytes).slice().reverse().map(hex8);
  return rows.map(row => {
    const rowValue = displayBytes
      .filter((_, idx) => {
        const littleIdx = totalBytes - 1 - idx;
        return littleIdx >= row.start && littleIdx < (row.start + row.count);
      })
      .join('');
    const cells = displayBytes.map((byte, idx) => {
      const littleIdx = totalBytes - 1 - idx;
      const active = littleIdx >= row.start && littleIdx < (row.start + row.count);
      return `<span class="rc-subcell${active ? ' rc-subcell-active' : ''}">${active ? byte : '··'}</span>`;
    }).join('');
    return `<div class="rc-subrow rc-subrow-${row.tone||'neutral'}" title="${row.label} = 0x${rowValue || '00'}">
      <div class="rc-submeta">
        <span class="rc-subname">${row.label}</span>
      </div>
      <div class="rc-subgrid rc-subgrid-${totalBytes}">
        ${cells}
      </div>
    </div>`;
  }).join('');
}

function renderByteStrip(name, opts={}) {
  const {
    activePos=-1,
    doneSet=new Set(),
    compact=false,
    transferCount=transferWidth(name),
    byteCount=regWidthBytes(name),
    memoryOrder=false,
  } = opts;
  const littleBytes = regBytes(name, byteCount);
  const displaySigIdxs = memoryOrder
    ? (S.endian==='little'
        ? Array.from({length:byteCount}, (_,i)=>i)
        : Array.from({length:byteCount}, (_,i)=>byteCount-1-i))
    : Array.from({length:byteCount}, (_,i)=>byteCount-1-i);
  const byteCls = compact ? 'rp-byte' : 'rc-byte';
  const labelCls = compact ? 'rp-byte-lbl' : 'rc-blbl';
  const basePos = memoryOrder ? 0 : displayPosForTransferByte(name, 0, transferCount);
  const lastPos = memoryOrder ? Math.max(transferCount-1, 0) : displayPosForTransferByte(name, Math.max(transferCount-1, 0), transferCount);
  const transferStart = memoryOrder ? 0 : displayTransferStart(name, transferCount);

  function byteMemoryOffset(idx) {
    if(memoryOrder) return idx < Math.min(transferCount, byteCount) ? idx : null;
    if(idx < transferStart) return null;
    return S.endian==='little' ? (byteCount - 1 - idx) : (idx - transferStart);
  }

  function byteHoverTitle(sigIdx, idx) {
    const role = sigIdx===byteCount-1 ? 'MSB' : sigIdx===0 ? 'LSB' : `byte ${sigIdx}`;
    const offset = byteMemoryOffset(idx);
    const memInfo = offset===null
      ? 'fora da largura/operacao atual'
      : `ordem de memoria: A+${offset}`;
    return `${name} · ${role} · ${memInfo}`;
  }

  return displaySigIdxs.map((sigIdx, idx) => {
    const byte = hex8(littleBytes[sigIdx] || 0);
    let cls = byteCls;
    if(!compact && idx===activePos) cls += ' byte-arriving';
    else if(!compact && doneSet.has(idx)) cls += ' byte-done';
    if(idx===basePos && idx>=transferStart) cls += ' rc-byte-base';
    if(transferCount>1 && idx===lastPos && idx>=transferStart) cls += ' rc-byte-last';

    const labels = [];
    if(sigIdx===byteCount-1) labels.push(`<span class="${labelCls} rc-blbl-msb">MSB</span>`);
    if(sigIdx===0) labels.push(`<span class="${labelCls} rc-blbl-lsb">LSB</span>`);
    if(idx===basePos && idx>=transferStart) labels.push(`<span class="${labelCls} rc-blbl-mem">A+0</span>`);
    if(transferCount>1 && idx===lastPos && idx>=transferStart) {
      labels.push(`<span class="${labelCls} rc-blbl-mem">A+${transferCount-1}</span>`);
    }
    return `<span class="${cls}" title="${byteHoverTitle(sigIdx, idx)}">${byte}${labels.join('')}</span>`;
  }).join('');
}

function registerByteAnchor(name, byteIdx, transferCount=transferWidth(name)) {
  const strip = $('rcb-'+name);
  if(!strip || !Number.isInteger(byteIdx)) return null;
  const displayPos = displayPosForTransferByte(name, byteIdx, transferCount);
  if(displayPos < 0) return null;
  const bytes = strip.querySelectorAll('.rc-byte');
  return bytes[displayPos] || null;
}

function updateRegCard(name) {
  const v=$('rcv-'+name), b=$('rcb-'+name), s=$('rcs-'+name);
  if(!v) return;
  if(isSpReg(name)) {
    v.textContent='0x'+fmtA(getReg(name));
    if(s) s.innerHTML=renderRegisterEncapsulation(name);
    updateChangedRegisterClasses();
    return;
  }
  const valueHex = regHex(name);
  if(is64()) {
    const hiSpan = v.querySelector('.rc-hi');
    const loSpan = v.querySelector('.rc-lo');
    if(hiSpan && loSpan) {
      hiSpan.textContent=valueHex.slice(0,8);
      loSpan.textContent=valueHex.slice(8);
    } else v.textContent=valueHex;
  } else {
    v.textContent=valueHex;
  }
  if(s) s.innerHTML=renderRegisterEncapsulation(name);
  if(b) b.innerHTML=renderByteStrip(name);
  updateChangedRegisterClasses();
}

function pulseRegister(name) {
  ['rc-'+name, 'r'+name].forEach(id => {
    const el = $(id);
    if(!el) return;
    el.classList.remove('reg-animating');
    void el.offsetWidth;
    el.classList.add('reg-animating');
    const prevTimer = regPulseTimers.get(id);
    if(prevTimer) clearTimeout(prevTimer);
    const timer = setTimeout(() => {
      el.classList.remove('reg-animating');
      regPulseTimers.delete(id);
    }, 520);
    regPulseTimers.set(id, timer);
  });
}

// Live update during LOAD
function liveUpdate(name, partial, byteIdx, transferCount=transferWidth(name)) {
  const v=$('rcv-'+name), s=$('rcs-'+name);
  const valueHex = regHex(name);
  if(v) {
    if(is64()) {
      const hi=v.querySelector('.rc-hi');
      const lo=v.querySelector('.rc-lo');
      if(hi && lo) {
        hi.textContent=valueHex.slice(0,8);
        lo.textContent=valueHex.slice(8);
      } else v.textContent=valueHex;
    } else v.textContent=valueHex;
  }
  if(s) s.innerHTML=renderRegisterEncapsulation(name);

  const hexPos = displayPosForTransferByte(name, byteIdx, transferCount);
  const done=new Set();
  for(let i=0;i<byteIdx;i++) done.add(displayPosForTransferByte(name, i, transferCount));

  const b=$('rcb-'+name);
  if(b) b.innerHTML=renderByteStrip(name, {activePos:hexPos, doneSet:done, transferCount});
}

// Highlight byte being SENT during STORE
function storeHighlight(name, hexPos, transferCount=transferWidth(name)) {
  const b=$('rcb-'+name);
  if(!b) return;
  b.innerHTML=renderByteStrip(name, {activePos:hexPos, transferCount});
  pulseRegister(name);
}

function setLoading(name, on) {
  $('rc-'+name)?.classList.toggle('rc-loading', on);
  if(!on) updateRegCard(name);
}

// ─────────────────────────────────────────────────────────
// SIDEBAR PICKER
// ─────────────────────────────────────────────────────────
function syncPicker() {
  [...gpRegs(),...extRegs(),...spRegs()].forEach(name => {
    updatePickerVal(name);
    updatePickerBytes(name);
  });
}
function updatePickerVal(n) {
  const e=$('rpv-'+n); if(!e) return;
  e.textContent = isSpReg(n) ? '0x'+fmtA(getReg(n)) : regHex(n);
}
function updatePickerBytes(n) {
  const e=$('rpb-'+n); if(!e || isSpReg(n)) return;
  e.innerHTML = renderByteStrip(n, {
    compact:true,
    memoryOrder:true,
    byteCount:regWidthBytes(n),
    transferCount:regWidthBytes(n),
  });
}

// ─────────────────────────────────────────────────────────
// VALUE PREVIEW
// ─────────────────────────────────────────────────────────
function refreshPreview() {
  const c=$('valPreview'); if(!c) return;
  const n=transferWidth(S.reg), bs=regBytes(S.reg,n);
  const ord=orderedBytes(bs,S.endian);
  c.innerHTML=ord.map((b,i)=>{
    const f=i===0, l=i===n-1;
    let cls='vp-byte';
    if(f && S.endian==='little') cls+=' lsb';
    if(f && S.endian==='big')    cls+=' msb';
    if(l && S.endian==='little' && n>1) cls+=' msb';
    if(l && S.endian==='big'    && n>1) cls+=' lsb';
    const lbl=(f&&S.endian==='little')?' LSB':(f&&S.endian==='big')?' MSB':
              (l&&S.endian==='little'&&n>1)?' MSB':(l&&S.endian==='big'&&n>1)?' LSB':'';
    return `<span class="${cls}">${hex8(b)}${lbl}</span>`;
  }).join('');
}

// ─────────────────────────────────────────────────────────
// BYTE BREAKDOWN
// ─────────────────────────────────────────────────────────
function refreshBreakdown() {
  const c=$('byteBreakdown'); if(!c) return;
  const n=transferWidth(S.reg), addr=parseInt($('addrInput').value||'0',16)&0x3F;
  const bs=regBytes(S.reg,n);
  const ord=orderedBytes(bs,S.endian);
  c.innerHTML=ord.map((b,i)=>{
    const ma=addr+i, f=i===0, l=i===n-1;
    let cls='', role='—';
    if(f&&S.endian==='little'){cls='bb-lsb';role='LSB';}
    if(f&&S.endian==='big')   {cls='bb-msb';role='MSB';}
    if(l&&S.endian==='little'&&n>1){cls='bb-msb';role='MSB';}
    if(l&&S.endian==='big'   &&n>1){cls='bb-lsb';role='LSB';}
    return `<div class="bb-row">
      <span class="bb-addr">0x${fmtA(ma)}</span>
      <span class="bb-hex ${cls}">${hex8(b)}</span>
      <span class="bb-bin">${b.toString(2).padStart(8,'0')}</span>
      <span class="bb-label">${role}</span></div>`;
  }).join('');
}

// ─────────────────────────────────────────────────────────
// MEMORY GRID
// ─────────────────────────────────────────────────────────
function buildMemGrid() {
  const g=$('memGrid'), a=$('memAddrBar');
  S.memViewBase = 0;
  const base = 0;
  const rowCount = memWindowRows();
  const totalBytes = memSpaceSize();
  const cellPx = memCellPx();
  const gapPx = 2;
  const trackTopPx = 24;
  const trackBottomPx = 24;
  const gridHeightPx = (rowCount * cellPx) + (Math.max(rowCount - 1, 0) * gapPx);
  const addrHeightPx = trackTopPx + trackBottomPx + gridHeightPx + (Math.max(rowCount + 1, 0) * gapPx);
  const topAddr = base;
  const bottomAddr = Math.max(totalBytes - 1, 0);
  const addrFrag = document.createDocumentFragment();
  const gridFrag = document.createDocumentFragment();
  memCellRefs = new Array(totalBytes);
  // Expande breakpoints para cobrir todos os bytes de cada instrução marcada
  const bpBytes = new Set();
  for(const bpAddr of S.breakpoints) {
    const instr = decodeAt(bpAddr & 0x3F);
    const sz = Math.max(instr.size || 1, 1);
    for(let i = 0; i < sz; i++) bpBytes.add(bpAddr + i);
  }
  g.innerHTML='';
  a.innerHTML='';
  const tag=$('addrDirTag');
  if(tag) tag.textContent=`0x${fmtMemA(topAddr)}..0x${fmtMemA(bottomAddr)} · total ${formatStackSize(totalBytes)}`;
  a.style.setProperty('--mem-row-count', String(rowCount));
  a.style.setProperty('--mem-cell-h', `${cellPx}px`);
  a.style.setProperty('--mem-cell-w', `${cellPx}px`);
  a.style.minHeight = `${addrHeightPx}px`;
  g.style.setProperty('--mem-row-count', String(rowCount));
  g.style.setProperty('--mem-cell-h', `${cellPx}px`);
  g.style.setProperty('--mem-cell-w', `${cellPx}px`);
  g.style.minHeight = `${gridHeightPx}px`;

  for(let r=0;r<rowCount;r++) {
    const rowBase = base + (r * 8);
    const l=document.createElement('div');
    l.className='addr-lbl';
    l.textContent='0x'+fmtMemA(rowBase);
    addrFrag.appendChild(l);
    for(let c=0;c<8;c++) {
      const addr=rowBase+c;
      if(addr>=totalBytes) break;
      const cell=document.createElement('div');
      cell.className='mem-cell'; cell.dataset.addr=addr;
      cell.title=t('mem.cell.title', fmtMemA(addr));
      cell.textContent=hex8(memByteAt(addr));
      const st = memStateAt(addr);
      if(st) cell.classList.add(st);
      if(addr===S.memSelectedAddr) cell.classList.add('mc-selected');
      if(addr < 64 && bpBytes.has(addr)) cell.classList.add('mc-bp');
      memCellRefs[addr] = cell;
      gridFrag.appendChild(cell);
    }
  }


  a.appendChild(addrFrag);
  g.appendChild(gridFrag);

  // Painel de breakpoints — sempre visível, lista todos, destaca o atingido
  const bpStatus = $('memBpStatus');
  if(bpStatus) {
    if(S.breakpoints.size > 0) {
      const sorted = [...S.breakpoints].sort((a, b) => a - b);
      bpStatus.innerHTML = '<div class="mem-bp-status-list">' + sorted.map((a, i) => {
        const num = i + 1;
        const isHit = S.breakpointHit === a && S.paused;
        return `<div class="bp-status-item${isHit ? ' bp-status-item-hit' : ''}">`
          + `<span class="bp-status-num">BP #${num}</span>`
          + `<span class="bp-status-addr">0x${fmtA(a)}</span>`
          + (isHit ? '<span class="bp-status-hit-lbl">PAUSA</span>' : '')
          + '</div>';
      }).join('') + '</div>';
    } else {
      bpStatus.innerHTML = '';
    }
  }

  scheduleCenterPaneLayout();
  syncAsmTraceHeight();
}

// Set #asmTraceSection height = #memSection's natural height so the grid row
// is always dictated by the memory map, never by the (taller) listing content.
function syncAsmTraceHeight() {
  const mem = $('memSection');
  const asm = $('asmTraceSection');
  if(!mem || !asm) return;
  // Remove height override so mem can express its natural size
  asm.style.height = '';
  asm.style.alignSelf = 'start';
  mem.style.alignSelf = 'start';
  // After the browser reflows mem at its natural height, pin asm to match
  requestAnimationFrame(() => {
    const h = mem.getBoundingClientRect().height;
    if(h > 0) {
      asm.style.height = h + 'px';
      asm.style.alignSelf = 'start';
    }
  });
}

const memEl = addr => memCellRefs[addr] || null;

function writeMem(addr, val, st) {
  if(addr<0||addr>=memSpaceSize()) return;
  const next = val & 0xFF;
  if(addr<64) S.mem[addr]=next;
  if(addr<S.stackSize) S.stackMem[addr]=next;
  setByteState(addr, st || '');
  const el=memEl(addr); if(!el) return;
  el.textContent=hex8(val);
  el.className='mem-cell mc-flash'+(st?' '+st:'');
  setTimeout(()=>{ if(el) el.classList.remove('mc-flash'); },500);
}

function setMemSt(addr, st) {
  if(addr<0||addr>=memSpaceSize()) return;
  setByteState(addr, st || '');
  const el=memEl(addr); if(!el) return;
  el.className='mem-cell'+(st?' '+st:'');
}

function editMemCell(addr) {
  const cell = memEl(addr);
  if(!cell || cell.classList.contains('is-editing')) return;
  cell.classList.add('is-editing');
  const prevState = memStateAt(addr) || '';
  const prevVal = hex8(memByteAt(addr));
  const inp = document.createElement('input');
  inp.className = 'mem-edit-input';
  inp.type = 'text';
  inp.maxLength = 2;
  inp.value = prevVal;
  inp.spellcheck = false;
  cell.innerHTML = '';
  cell.appendChild(inp);
  inp.focus();
  inp.select();

  function restore() {
    cell.className = 'mem-cell'+(prevState ? ' '+prevState : '');
    cell.textContent = prevVal;
  }

  function commit() {
    const raw = inp.value.replace(/[^0-9a-fA-F]/g,'').toUpperCase();
    const val = parseInt(raw || '0', 16) & 0xFF;
    writeMem(addr, val, 'mc-written');
    if(addr < 64) buildAsmTrace();
    buildStackView();
    lg('sys', t('log.sys.mem_edit', fmtMemA(addr), hex8(val)));
  }

  inp.addEventListener('keydown', e => {
    if(e.key==='Enter') { e.preventDefault(); commit(); }
    else if(e.key==='Escape') { e.preventDefault(); restore(); }
    else if(e.key.length===1 && !/[0-9a-fA-F]/.test(e.key) && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
    }
  });
  inp.addEventListener('blur', () => {
    if(cell.classList.contains('is-editing')) commit();
  });
}

function writeAssembledBytes(addr, src, oldSizeHint, bytesHint) {
  const baseAddr = addr & 0x3F;
  const bytes = bytesHint || assemble(src, baseAddr);
  if(!bytes) return null;

  const oldSize = Math.max(oldSizeHint || decodeAt(baseAddr).size || 1, 1);
  for(let i=0;i<bytes.length;i++) writeMem((baseAddr+i)&0x3F, bytes[i], 'mc-written');
  if(bytes.length < oldSize) {
    for(let i=bytes.length;i<oldSize;i++) writeMem((baseAddr+i)&0x3F, 0x90, 'mc-written');
  }

  buildAsmTrace();
  buildStackView();
  syncPicker();
  buildRegCards();
  refreshPreview();
  refreshBreakdown();

  return { bytes, oldSize, baseAddr };
}

function editAsmLine(line) {
  if(!line || line.dataset.editing) return;
  const asmEl = line.querySelector('.asm-line-asm');
  if(!asmEl) return;

  const addr = parseInt(line.dataset.addr || '0', 16) & 0x3F;
  const oldSize = Math.max(parseInt(line.dataset.size || '1', 10) || 1, 1);
  const prevAsm = asmEl.textContent.trim();
  const input = document.createElement('input');

  line.dataset.editing = '1';
  line.classList.add('asm-line-editing');
  input.className = 'asm-edit-input';
  input.type = 'text';
  input.value = prevAsm;
  input.spellcheck = false;

  asmEl.textContent = '';
  asmEl.appendChild(input);
  input.focus();
  input.select();

  function updateInlineValidation() {
    const check = validateAssembly(input.value, addr);
    input.classList.toggle('is-invalid', !!input.value.trim() && !check.ok);
    input.title = check.ok ? t('ui.asm.valid', check.bytes.length) : check.error;
    return check;
  }

  function cancel() {
    delete line.dataset.editing;
    line.classList.remove('asm-line-editing');
    asmEl.textContent = prevAsm;
  }

  function commit() {
    const src = input.value.trim();
    if(!src) { cancel(); return; }
    const validation = updateInlineValidation();
    if(!validation.ok) {
      setStatus(t('status.asm_invalid', fmtA(addr), validation.error),'lbl-error');
      lg('error', t('log.error.asm_invalid_listing', fmtA(addr), validation.error));
      requestAnimationFrame(() => { input.focus(); input.select(); });
      return;
    }
    const result = writeAssembledBytes(addr, src, oldSize, validation.bytes);

    delete line.dataset.editing;
    line.classList.remove('asm-line-editing');
    setPC(addr);
    lg('sys', t('log.sys.asm_edit', fmtA(addr), src));
    if(result.bytes.length < result.oldSize) {
      lg('sys', t('log.sys.nop_fill', fmtA(addr), fmtA((addr+result.oldSize-1)&0x3F)));
    } else if(result.bytes.length > result.oldSize) {
      lg('error', t('log.error.asm_grew', fmtA(addr), result.oldSize, result.bytes.length));
    }
  }

  input.addEventListener('keydown', e => {
    if(e.key==='Enter') { e.preventDefault(); commit(); }
    else if(e.key==='Escape') { e.preventDefault(); cancel(); }
  });
  input.addEventListener('input', updateInlineValidation);
  input.addEventListener('blur', () => {
    if(line.dataset.editing) commit();
  });
  updateInlineValidation();
}

// ─────────────────────────────────────────────────────────
// SETTERS (called from HTML + App object)
// ─────────────────────────────────────────────────────────
function doSetEndian(e) {
  S.endian=e;
  $('eLittle').classList.toggle('active',e==='little');
  $('eBig').classList.toggle('active',e==='big');
  $('endianHint').innerHTML = e==='little'
    ? '<span class="eh-arrow">0x0000</span> ← byte menos significativo (LSB)'
    : '<span class="eh-arrow">0x0000</span> ← byte mais significativo (MSB)';
  buildRegCards();
  buildRegPicker();
  buildStackView();
  syncPicker();
  refreshPreview(); refreshBreakdown();
  lg('sys', t('log.sys.format', e.toUpperCase()));
}

function doSetSize(s) {
  S.size=s;
  ['byte','word','dword','qword'].forEach(x=>{
    const id='s'+x[0].toUpperCase()+x.slice(1);
    $( id)?.classList.toggle('active',x===s);
  });
  // QWORD only available in x64 mode; clamp to dword otherwise
  if(s==='qword' && !is64()) { S.size='dword'; doSetSize('dword'); return; }
  buildRegCards();
  buildRegPicker();
  syncPicker();
  refreshPreview(); refreshBreakdown();
  lg('sys', t('log.sys.size', s.toUpperCase(), sizeN()*8));
}

function doSelectReg(name) {
  S.reg=name;
  [...gpRegs(),...extRegs(),...spRegs()].forEach(r=>{
    $('rc-'+r)?.classList.toggle('rc-selected',r===name);
    $('r'+r)?.classList.toggle('active',r===name);
  });
  const maxHex = Math.min(sizeN()*2, regWidthBytes(name)*2);
  const v = isSpReg(name) ? fmtA(getReg(name)) : regHex(name).slice(-maxHex);
  $('valInput').value=v;
  refreshPreview(); refreshBreakdown();
  lg('sys', t('log.sys.reg_selected', name));
}

function buildRegPicker() {
  const picker=$('regPicker'); if(!picker) return;
  const gp=gpRegs(), sp=spRegs(), ext=extRegs();
  const all=[...gp,...ext,...sp];
  picker.innerHTML='';
  for(const name of all) {
    const isSp=isSpReg(name);
    const role = isSp ? ` rpbtn-${stackRoleClass(name)}` : '';
    const btn=document.createElement('button');
    btn.className='rpbtn'+(isSp?' rpbtn-sp':'')+role+(name===S.reg?' active':'');
    btn.id='r'+name;
    btn.onclick=(e)=>{ if(!e.target.closest('.rc-edit-input')) App.selectReg(name); };
    const val=isSp?'0x'+fmtA(getReg(name)):regHex(name);
    btn.innerHTML=`<span class="rp-main">
        <span class="rp-name">${name}</span>
        <span class="rp-val rp-val-editable" id="rpv-${name}" title="${t('ui.reg.picker.title')}">${val}</span>
      </span>
      ${isSp ? '' : `<span class="rp-bytes" id="rpb-${name}">${renderByteStrip(name, {
        compact:true,
        memoryOrder:true,
        byteCount:regWidthBytes(name),
        transferCount:regWidthBytes(name),
      })}</span>`}`;
    btn.querySelector('.rp-val').addEventListener('click', e => {
      e.stopPropagation();
      makeRegisterEditable(btn.querySelector('.rp-val'), name);
    });
    picker.appendChild(btn);
  }
  updateChangedRegisterClasses();
}

function doSetArch(arch) {
  S.arch = arch;
  $('archIA32')?.classList.toggle('active', arch==='ia32');
  $('archX64') ?.classList.toggle('active', arch==='x64');

  // Add QWORD button visibility
  const sQ=$('sQword'); if(sQ) sQ.style.display = arch==='x64' ? '' : 'none';

  // Default operand size follows the selected architecture in the UI
  if(arch==='x64') S.size = 'qword';
  else if(S.size==='qword') S.size = 'dword';

  // Granularidade padrão por arquitetura: DWord (IA-32) / QWord (x64)
  S.stackGranularity = arch === 'x64' ? 'qword' : 'dword';

  resetStatsState();
  resetCoreRegisters();
  S.reg = arch==='x64' ? 'RAX' : 'EAX';
  S.halt=false;
  S.progRunning=false;
  loadDefaultProgram(false, arch);

  buildRegCards();
  buildRegPicker();
  buildMemGrid();
  setPC(demoProgramForArch(arch).entry);
  buildStackView();
  doSetSize(S.size);
  syncPicker(); refreshStats(); refreshPreview(); refreshBreakdown();
  updatePickerVal(S.reg);
  doSelectReg(S.reg);
  $('clockDisplay').textContent='—';
  $('opsDisplay').textContent='0';
  setCpuState('idle');
  const chip=$('archDisplay'); if(chip) chip.textContent=arch==='x64'?'x86-64':'IA-32';
  const stackLbl=$('stackArchLbl'); if(stackLbl) stackLbl.textContent=`STACK  ${arch==='x64'?'RSP/RBP':'ESP/EBP'}`;
  const asmPh=$('asmInput'); if(asmPh) asmPh.placeholder=t(arch==='x64'?'asm.hint.placeholder.x64':'asm.hint.placeholder.ia32');
  refreshAsmValidation();
  setStatus(t('status.demo_arch', arch==='x64'?'x86-64':'IA-32'),'lbl-done');
  lg('sys', t('log.sys.arch', arch==='x64'?'x86-64':'IA-32'));
  lg('sys', demoProgramForArch(arch).listing.join(' | '));
}

// ─────────────────────────────────────────────────────────
// STORE
// ─────────────────────────────────────────────────────────
async function doStore() {
  if(S.busy) return;
  clearFaultLatch();
  S.busy=true; setBusy(true);
  const reg=S.reg, addr=readAddr(), n=transferWidth(reg), t0=performance.now();
  const ord=regBytes(reg,n);
  const asm = asmForOp('store-start',{reg,addr,val:regHex(reg)});
  if(!mapAccessFits(addr, n)) {
    reportWidthOverflow(`STORE ${reg}`, addr, n, asm);
    S.busy=false; setBusy(false);
    return;
  }
  setPC(addr, { traceAutoScroll:false });
  lg('store', t('log.store.start', reg, regHex(reg), fmtA(addr), S.size.toUpperCase(), S.endian.toUpperCase()), asm);
  setStatus(t('status.store_start', n, fmtA(addr)),'lbl-store');

  for(let i=0;i<n;i++) {
    const ma=addr+i;
    if(ma>=64){lg('error', t('log.error.addr_range', fmtA(ma)));break;}
    const hexPos=displayPosForTransferByte(reg, i, n);
    storeHighlight(reg, hexPos, n);
    setPC(ma, { traceAutoScroll:false });
    setMemSt(ma,'mc-active');
    await animPacket('store', ord[i], ma, { regName: reg, byteIdx: i, transferCount: n });
    writeMem(ma, ord[i], 'mc-active');
    lg('store', t('log.store.byte', fmtA(ma), hex8(ord[i]), i+1, n),
       asmForOp('store-byte',{byteAddr:ma,byteVal:ord[i],byteIdx:i,byteCount:n}));
    await sleep(S.speed*0.18);
    S.memState[ma]='mc-written'; setMemSt(ma,'mc-written');
  }
  updateRegCard(reg);
  const ms=Math.round(performance.now()-t0);
  recOp('store',ms);
  setPC((addr+n)&0x3F, { traceAutoScroll:false });
  setStatus(t('status.store_done', ms),'lbl-done');
  lg('store', t('log.store.done', ms));
  buildStackView();
  refreshStats(); refreshBreakdown();
  S.busy=false; setBusy(false);
}

// ─────────────────────────────────────────────────────────
// LOAD
// ─────────────────────────────────────────────────────────
async function doLoad() {
  if(S.busy) return;
  clearFaultLatch();
  S.busy=true; setBusy(true);
  const reg=S.reg, addr=readAddr(), n=transferWidth(reg), t0=performance.now();
  const asm = asmForOp('load-start',{reg,addr});
  if(!mapAccessFits(addr, n)) {
    reportWidthOverflow(`LOAD ${reg}`, addr, n, asm);
    S.busy=false; setBusy(false);
    return;
  }
  setPC(addr, { traceAutoScroll:false });
  lg('load', t('log.load.start', fmtA(addr), reg, S.size.toUpperCase(), S.endian.toUpperCase()), asm);
  setStatus(t('status.load_start', n, fmtA(addr)),'lbl-load');

  const raw=[];
  for(let i=0;i<n;i++) { const ma=addr+i; raw.push(ma<64?S.mem[ma]:0); }

  // Zero register + show loading state
  setRegParts(reg,0,0); setLoading(reg,true);
  const partialLittle = new Array(n).fill(0);

  for(let i=0;i<n;i++) {
    const ma=addr+i; if(ma>=64) break;
    setPC(ma, { traceAutoScroll:false }); setMemSt(ma,'mc-active');
    await animPacket('load', raw[i], ma, { regName: reg, byteIdx: i, transferCount: n });

    partialLittle[i] = raw[i] & 0xFF;
    setRegFromBytes(reg, partialLittle);

    // Live register update — value builds up byte by byte
    liveUpdate(reg, 0, i, n);
    updatePickerVal(reg);
    updatePickerBytes(reg);

    lg('load', t('log.load.byte', reg, i, fmtA(ma), hex8(raw[i]), regHex(reg)),
       asmForOp('load-byte',{byteAddr:ma,byteIdx:i,partial:regHex(reg)}));
    await sleep(S.speed*0.18);
    S.memState[ma]='mc-written'; setMemSt(ma,'mc-written');
  }

  setLoading(reg,false);
  updatePickerVal(reg);
  updatePickerBytes(reg);
  const finalHex=regHex(reg);
  $('valInput').value=finalHex.slice(-Math.min(sizeN()*2, regWidthBytes(reg)*2));
  const ms=Math.round(performance.now()-t0);
  recOp('load',ms);
  setPC((addr+n)&0x3F, { traceAutoScroll:false });
  setStatus(t('status.load_done', reg, finalHex, ms),'lbl-done');
  lg('load', t('log.load.done', reg, finalHex, ms));
  buildStackView();
  refreshStats(); refreshPreview(); refreshBreakdown();
  S.busy=false; setBusy(false);
}

// ─────────────────────────────────────────────────────────
// X86 SUBSET — opcode table, decoder, assembler, executor
// ─────────────────────────────────────────────────────────

// Reg encoding: index → name
const REG32 = ['EAX','ECX','EDX','EBX','ESP','EBP','ESI','EDI'];
const REG64 = ['RAX','RCX','RDX','RBX','RSP','RBP','RSI','RDI'];
// R8-R15 (REX.B/REX.R extension)
const REG64X = ['R8','R9','R10','R11','R12','R13','R14','R15'];

// Current reg table for decoder/assembler
function regTable(rex_r) { return is64() ? (rex_r ? REG64X : REG64) : REG32; }
function regName(idx, rex_ext) {
  if(is64()) return rex_ext ? REG64X[idx&7] : REG64[idx&7];
  return REG32[idx&7];
}
function operandRegName(idx, rex_ext, wide) {
  if(!is64()) return REG32[idx&7];
  if(rex_ext) return REG64X[idx&7];
  return wide ? REG64[idx&7] : REG32[idx&7];
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
  0x90: { mnem:'NOP',       size:1 },
  0xF4: { mnem:'HLT',       size:1 },
  0xC3: { mnem:'RET',       size:1 },
  0xE8: { mnem:'CALL',      size:5 },
  0x89: { mnem:'MOV',       size:3 },   // MOV [r/m32], r32  (mod=11 or mod=00+addr)
  0x8B: { mnem:'MOV',       size:3 },   // MOV r32, [r/m32]
  0xFF: { mnem:'PUSH',      size:2 },   // PUSH r/m32 (mod=11)
  0x8F: { mnem:'POP',       size:2 },   // POP r/m32 (mod=11)
  0xEB: { mnem:'JMP SHORT', size:2 },
};
// B8..BF: MOV r32, imm32
for(let i=0;i<8;i++) OPMAP[0xB8+i]={ mnem:'MOV', size:5, regIdx:i };

function decodeAt(pc) {
  let off = 0;
  let rex = 0;
  const byte0 = S.mem[pc&0x3F];

  // REX prefix (0x40–0x4F) — only meaningful in x64 mode
  if(is64() && byte0>=0x40 && byte0<=0x4F) {
    rex = byte0;
    off = 1;
  }
  const rex_w = !!(rex & 0x08);  // 64-bit operand size (unused in our 32-bit sim, but decoded)
  const rex_r = !!(rex & 0x04);  // extends ModRM.reg field
  const rex_b = !!(rex & 0x01);  // extends ModRM.rm or opcode reg field

  const op = S.mem[(pc+off)&0x3F];
  const rexPfx = rex ? `REX.${rex_w?'W':''}${rex_r?'R':''}${rex_b?'B':''} ` : '';

  // Helpers
  const spName = is64() ? 'RSP' : 'ESP';
  const spKey  = 'ESP';  // S.regs key is always ESP
  const faultInstr = (size, detail, asmText=null, opts={}) => {
    const total = Math.max(off + size, 1);
    return {
      op,
      mnem: opts.mnem || 'DECODE ERROR',
      size: total,
      asm: asmText || `; ${detail}`,
      exec:()=>{},
      unknown: !!opts.unknown,
      decodeError: !opts.unknown,
      errorDetail: detail,
      errorAddrs: Array.from({length:total}, (_,i)=>(pc+i)&0x3F),
    };
  };
  const unknownOpcodeInstr = () => faultInstr(
    1,
    `Opcode invalido em 0x${fmtA(pc)}: 0x${hex8(op)} nao pertence ao subset Intel implementado pelo simulador.`,
    `; 0x${hex8(op)} (opcode nao reconhecido)`,
    { mnem:`DB 0x${hex8(op)}`, unknown:true }
  );

  // B8..BF: MOV r32/r64, imm32
  if(op>=0xB8 && op<=0xBF) {
    const regIdx = (op-0xB8) + (rex_b ? 8 : 0);
    const reg = operandRegName(regIdx & 7, rex_b, rex_w);
    const base = pc+off+1;
    if(rex_w) {
      const bytes = [];
      for(let i=0;i<8;i++) bytes.push(S.mem[(base+i)&0x3F]);
      let lo = 0;
      let hi = 0;
      for(let i=0;i<4;i++) lo |= bytes[i]<<(i*8);
      for(let i=4;i<8;i++) hi |= bytes[i]<<((i-4)*8);
      return { op, mnem:`${rexPfx}MOV ${reg}, 0x${hex64(hi>>>0,lo>>>0)}`, size:off+9,
               asm:`MOV ${reg}, 0x${hex64(hi>>>0,lo>>>0)}`,
               exec:()=>{ setRegParts(reg, lo>>>0, hi>>>0); updateRegCard(reg); updatePickerVal(reg); updatePickerBytes(reg); } };
    }
    const imm=(S.mem[base&0x3F])|(S.mem[(base+1)&0x3F]<<8)|(S.mem[(base+2)&0x3F]<<16)|(S.mem[(base+3)&0x3F]<<24);
    const immU=imm>>>0;
    return { op, mnem:`${rexPfx}MOV ${reg}, 0x${hex32(immU)}`, size:off+5,
             asm:`MOV ${reg}, 0x${hex32(immU)}`,
             exec:()=>{ setReg(reg,immU); updateRegCard(reg); updatePickerVal(reg); updatePickerBytes(reg); } };
  }
  if(op===0x90) return { op, mnem:'NOP', size:off+1, asm:'NOP', exec:()=>{} };
  if(op===0xF4) return { op, mnem:'HLT', size:off+1, asm:'HLT', exec:()=>{ S.halt=true; } };
  if(op===0xC3) return { op, mnem:'RET', size:off+1, asm:'RET',
    exec:()=>{
      const width = ptrSize();
      const sp = S.regs[spKey] >>> 0;
      if(!stackAccessFits(sp, width)) {
        reportStackBoundsError(`RET em 0x${fmtA(pc)}`, sp, width, 'RET', { halt:true, pc });
        return;
      }
      const bytes = readStackBytes(sp, width);
      let target = 0;
      for(let i=0;i<Math.min(4,width);i++) target |= (bytes[i]&0xFF)<<(i*8);
      const expected = S.callFrames[S.callFrames.length-1];
      const highGarbage = width>4 && bytes.slice(4).some(b => b!==0);
      if(expected) {
        const issues = [];
        if(expected.slot !== sp) issues.push(`o topo da pilha esta em 0x${fmtStackA(sp)}, mas o CALL mais recente gravou o retorno em 0x${fmtStackA(expected.slot)}`);
        if((expected.returnTo & 0x3F) !== (target & 0x3F)) issues.push(`o endereco lido foi 0x${fmtA(target & 0x3F)}, mas o CALL mais recente esperava 0x${fmtA(expected.returnTo & 0x3F)}`);
        if(expected.width !== width) issues.push(`a largura esperada para o retorno era ${expected.width} byte(s), mas o RET leu ${width}`);
        if(highGarbage) issues.push('os bytes altos do endereco de retorno nao estao zerados');
        if(issues.length) {
          reportStackError(`RET corrompido em 0x${fmtA(pc)}: ${issues.join('; ')}.`, 'RET', { halt:true, pc });
          return;
        }
        S.callFrames.pop();
      }
      S.regs[spKey]=S.regs[spKey]+width;
      revealMemRange(sp, width, { select:true });
      updateRegCard(spName);
      updatePickerVal(spName);
      markRegistersChanged(spName);
      setPC(target & 0x3F);
    } };
  if(op===0xE8) {
    const base = pc+off+1;
    const rel = (
      (S.mem[base&0x3F]) |
      (S.mem[(base+1)&0x3F] << 8) |
      (S.mem[(base+2)&0x3F] << 16) |
      (S.mem[(base+3)&0x3F] << 24)
    ) >> 0;
    const nextIp = (pc+off+5) & 0x3F;
    const target = (pc+off+5+rel) & 0x3F;
    return { op, mnem:`CALL 0x${fmtA(target)}`, size:off+5, asm:`CALL 0x${fmtA(target)}`,
      exec:()=>{
        const width = ptrSize();
        const targetInstr = decodeAt(target);
        if(isInstructionFault(targetInstr)) {
          reportMemoryError(
            [target],
            `CALL corrompido em 0x${fmtA(pc)}: o destino 0x${fmtA(target)} nao aponta para uma instrucao valida no subset atual.`,
            `CALL 0x${fmtA(target)}`,
            { halt:true, pc }
          );
          return;
        }
        const nextSp = S.regs[spKey] - width;
        if(!stackAccessFits(nextSp, width)) {
          reportStackBoundsError(`CALL 0x${fmtA(target)}`, nextSp, width, `CALL 0x${fmtA(target)}`, { halt:true, pc });
          return;
        }
        S.regs[spKey]=nextSp;
        const sp = S.regs[spKey] >>> 0;
        const retBytes = [];
        for(let i=0;i<width;i++) {
          const byte = i<4 ? ((nextIp>>>(i*8))&0xFF) : 0;
          retBytes.push(byte);
        }
        writeStackBytes(sp, retBytes);
        revealMemRange(sp, width, { select:true });
        S.callFrames.push({ slot: sp, width, returnTo: nextIp & 0x3F, callSite: pc & 0x3F, target });
        updateRegCard(spName);
        updatePickerVal(spName);
        markRegistersChanged(spName);
        setPC(target);
      } };
  }
  if(op===0xEB) {
    const rel=((S.mem[(pc+off+1)&0x3F])<<24>>24); // signed byte
    const target=(pc+off+2+rel)&0x3F;
    return { op, mnem:`JMP SHORT +${rel} → 0x${fmtA(target)}`, size:off+2, asm:`JMP SHORT 0x${fmtA(target)}`,
             exec:()=>{}, jmpTarget:target };
  }
  if(op===0x89||op===0x8B) {
    const modrm=S.mem[(pc+off+1)&0x3F];
    const mod=(modrm>>6)&3, regIdx=(modrm>>3)&7, rmIdx=modrm&7;
    const width = rex_w ? 8 : 4;
    const rName=operandRegName(regIdx, rex_r, rex_w), rmName=operandRegName(rmIdx, rex_b, rex_w);
    const dPtr = width===8 ? 'QWORD PTR' : 'DWORD PTR';
    if(mod===3) {
      if(op===0x89) return { op, mnem:`${rexPfx}MOV ${rmName}, ${rName}`, size:off+2, asm:`MOV ${rmName}, ${rName}`,
        exec:()=>{
          if(width===8) {
            const {lo,hi}=regParts(rName);
            setRegParts(rmName, lo, hi);
          } else {
            setReg(rmName,getReg(rName));
          }
          updateRegCard(rmName); updatePickerVal(rmName); updatePickerBytes(rmName);
        } };
      else return { op, mnem:`${rexPfx}MOV ${rName}, ${rmName}`, size:off+2, asm:`MOV ${rName}, ${rmName}`,
        exec:()=>{
          if(width===8) {
            const {lo,hi}=regParts(rmName);
            setRegParts(rName, lo, hi);
          } else {
            setReg(rName,getReg(rmName));
          }
          updateRegCard(rName); updatePickerVal(rName); updatePickerBytes(rName);
        } };
    }
    if(mod===0) {
      if(rmIdx!==0) {
        return faultInstr(
          3,
          `DECODE inconsistente em 0x${fmtA(pc)}: o subset atual aceita MOV com memoria apenas no formato absoluto [disp8], codificado com rm=000. Foi lido rm=${rmIdx}.`,
          `; MOV /r com rm=${rmIdx} nao suportado`
        );
      }
      const addr=S.mem[(pc+off+2)&0x3F]&0x3F;
      if(op===0x89) return { op, mnem:`${rexPfx}MOV [0x${fmtA(addr)}], ${rName}`, size:off+3, asm:`MOV ${dPtr} [0x${fmtA(addr)}], ${rName}`,
        exec:()=>{
          if(!mapAccessFits(addr, width)) {
            reportWidthOverflow(`MOV [0x${fmtA(addr)}], ${rName}`, addr, width, `MOV ${dPtr} [0x${fmtA(addr)}], ${rName}`, { halt:true, pc });
            return;
          }
          regBytes(rName,width).forEach((b,i)=>writeMem((addr+i)&0x3F,b,'mc-written'));
        } };
      else return { op, mnem:`${rexPfx}MOV ${rName}, [0x${fmtA(addr)}]`, size:off+3, asm:`MOV ${rName}, ${dPtr} [0x${fmtA(addr)}]`,
        exec:()=>{
          if(!mapAccessFits(addr, width)) {
            reportWidthOverflow(`MOV ${rName}, [0x${fmtA(addr)}]`, addr, width, `MOV ${rName}, ${dPtr} [0x${fmtA(addr)}]`, { halt:true, pc });
            return;
          }
          const bytes=[]; for(let i=0;i<width;i++) bytes.push(S.mem[(addr+i)&0x3F]); setRegFromBytes(rName,bytes); updateRegCard(rName); updatePickerVal(rName); updatePickerBytes(rName);
        } };
    }
    return faultInstr(
      2,
      `DECODE inconsistente em 0x${fmtA(pc)}: opcode 0x${hex8(op)} com ModRM mod=${mod} nao e suportado pelo subset atual.`,
      `; MOV /r com mod=${mod} nao suportado`
    );
  }
  if(op===0xFF) { // PUSH
    const modrm=S.mem[(pc+off+1)&0x3F];
    const mod=(modrm>>6)&3, subop=(modrm>>3)&7, rmIdx=modrm&7;
    if(subop!==6) {
      return faultInstr(
        2,
        `DECODE inconsistente em 0x${fmtA(pc)}: opcode 0xFF exige ModRM /6 para PUSH, mas foi lido /${subop}.`,
        `; FF /${subop} nao corresponde a PUSH`
      );
    }
    if(mod===3) { const rn=regName(rmIdx, rex_b); return { op, mnem:`${rexPfx}PUSH ${rn}`, size:off+2, asm:`PUSH ${rn}`,
      exec:()=>{
        const width=ptrSize();
        const nextSp=S.regs[spKey]-width;
        if(!stackAccessFits(nextSp, width)) {
          reportStackBoundsError(`PUSH ${rn}`, nextSp, width, `PUSH ${rn}`, { halt:true, pc });
          return;
        }
        S.regs[spKey]=nextSp;
        writeStackBytes(S.regs[spKey], regBytes(rn,width));
        revealMemRange(S.regs[spKey], width, { select:true });
        updateRegCard(spName); updatePickerVal(spName);
        markRegistersChanged(spName);
      } }; }
    return faultInstr(
      2,
      `DECODE inconsistente em 0x${fmtA(pc)}: o subset atual aceita PUSH apenas com registrador (ModRM mod=11), mas foi lido mod=${mod}.`,
      `; PUSH com mod=${mod} nao suportado`
    );
  }
  if(op===0x8F) { // POP
    const modrm=S.mem[(pc+off+1)&0x3F];
    const mod=(modrm>>6)&3, subop=(modrm>>3)&7, rmIdx=modrm&7;
    if(subop!==0) {
      return faultInstr(
        2,
        `DECODE inconsistente em 0x${fmtA(pc)}: opcode 0x8F exige ModRM /0 para POP, mas foi lido /${subop}.`,
        `; 8F /${subop} nao corresponde a POP`
      );
    }
    if(mod===3) { const rn=regName(rmIdx, rex_b); return { op, mnem:`${rexPfx}POP ${rn}`, size:off+2, asm:`POP ${rn}`,
      exec:()=>{
        const width=ptrSize();
        const sp = S.regs[spKey] >>> 0;
        if(!stackAccessFits(sp, width)) {
          reportStackBoundsError(`POP ${rn}`, sp, width, `POP ${rn}`, { halt:true, pc });
          return;
        }
        const bytes = readStackBytes(sp, width);
        revealMemRange(sp, width, { select:true });
        setRegFromBytes(rn, bytes);
        S.regs[spKey]=S.regs[spKey]+width;
        updateRegCard(rn); updateRegCard(spName); updatePickerVal(rn); updatePickerVal(spName); updatePickerBytes(rn);
        markRegistersChanged([rn, spName]);
      } }; }
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
  if(S.busy) return;
  clearFaultLatch();
  S.busy=true; setBusy(true);
  const addr=S.pc;                    // IP aponta para a instrução
  const instr=decodeAt(addr);

  // ── FASE 1: FETCH ──────────────────────────────────────
  // Lê bytes da memória → Instruction Register (IR)
  // O IP é incrementado IMEDIATAMENTE para além dos bytes lidos
  // (Intel SDM Vol.1 §6.3: "The EIP register is incremented after each
  //  instruction fetch to point to the next sequential instruction")
  const np=(addr+instr.size)&0x3F;   // novo PC = endereço pós-instrução
  setStatus(t('status.fetch1', fmtA(addr), instr.size),'lbl-fetch');
  for(let i=0;i<instr.size;i++){const ma=(addr+i)&0x3F; setMemSt(ma,'mc-pc');}
  lg('info', t('log.info.fetch1', fmtA(addr), hex8(instr.op), instr.size));
  await sleep(S.speed * 0.4);

  // IP avança durante o fetch (antes do decode/execute)
  setPC(np, { traceAutoScroll: true });
  setStatus(t('status.fetch2', fmtA(np)),'lbl-fetch');
  lg('info', t('log.info.fetch2', fmtA(np)));
  await sleep(S.speed * 0.25);

  // ── FASE 2: DECODE ─────────────────────────────────────
  // Decodifica o conteúdo do IR
  setStatus(t('status.decode', instr.mnem),'lbl-fetch');
  lg('info', t('log.info.decode', instr.mnem), instr.asm);
  if(isInstructionFault(instr)) {
    reportMemoryError(
      instr.errorAddrs || [addr],
      instr.errorDetail || `Falha de decode em 0x${fmtA(addr)}.`,
      instr.asm,
      { pc: addr }
    );
    S.busy=false; setBusy(false);
    return;
  }
  await sleep(S.speed * 0.35);

  for(let i=0;i<instr.size;i++){const ma=(addr+i)&0x3F; setMemSt(ma,S.memState[ma]||'');}
  setStatus(t('status.fetch_decode_done', fmtA(np)),'lbl-done');
  buildStackView();
  S.busy=false; setBusy(false);
}

// ─────────────────────────────────────────────────────────
// EXECUTE — núcleo interno (sem setBusy, para uso por doRun)
// ─────────────────────────────────────────────────────────
async function _executeOne(opts={}) {
  const traceMode = opts.traceMode || 'run';
  const isStepTrace = traceMode==='step';
  if(S.halt) return;
  const addr=S.pc;
  const instr=decodeAt(addr);
  if(isStepTrace) {
    lg('step', t('log.sys.step_start', fmtA(addr)));
  }

  // ── FASE 1: FETCH ──────────────────────────────────────
  // Lê bytes da memória → IR; IP incrementa imediatamente (Intel SDM §6.3)
  const np_seq = (addr+instr.size)&0x3F;   // PC sequencial (pode ser sobrescrito por JMP)
  setStatus(t('status.fetch_short', fmtA(addr), instr.size),'lbl-fetch',{log:false});
  for(let i=0;i<instr.size;i++){const ma=(addr+i)&0x3F; setMemSt(ma,'mc-pc');}
  if(isStepTrace) {
    lg('info', t('log.info.fetch_desc', instr.size, fmtA(addr)), asmForOp('fetch', { addr, newPC: np_seq }), { indent:1, kindLabel:'FETCH' });
  } else {
    lg('info', t('log.info.fetch1', fmtA(addr), hex8(instr.op), instr.size));
  }
  await sleep(S.speed * 0.25);

  // IP avança durante o fetch
  setPC(np_seq, { traceAutoScroll: true });
  if(isStepTrace) {
    lg('info', t('log.info.fetch_ip', ipReg(), fmtA(np_seq)), null, { indent:1, kindLabel:'FETCH' });
  }
  await sleep(S.speed * 0.1);

  // ── FASE 2: DECODE ─────────────────────────────────────
  setStatus(t('status.decode', instr.mnem),'lbl-fetch',{log:false});
  if(isStepTrace) {
    lg('info', t('log.info.decode_desc', instr.mnem), instr.asm, { indent:1, kindLabel:'DECODE' });
  } else {
    lg('info', t('log.info.decode', instr.mnem), instr.asm);
  }
  if(isInstructionFault(instr)) {
    const prevIndent = S.logIndent;
    if(isStepTrace) S.logIndent = 2;
    try {
      reportMemoryError(
        instr.errorAddrs || [addr],
        instr.errorDetail || `Falha de decode em 0x${fmtA(addr)}.`,
        instr.asm,
        { halt:true, pc: addr }
      );
    } finally {
      S.logIndent = prevIndent;
    }
    syncPicker(); refreshStats(); refreshPreview(); refreshBreakdown();
    return;
  }
  await sleep(S.speed * 0.2);

  // ── FASE 3: EXECUTE ────────────────────────────────────
  setStatus(t('status.execute', instr.mnem),'lbl-load',{log:false});
  if(isStepTrace) {
    lg('info', t('log.info.execute_desc'), instr.asm, { indent:1, kindLabel:'EXECUTE' });
  }
  const prevIndent = S.logIndent;
  if(isStepTrace) S.logIndent = 2;
  try {
    instr.exec();
  } finally {
    S.logIndent = prevIndent;
  }
  for(let i=0;i<instr.size;i++){const ma=(addr+i)&0x3F; setMemSt(ma,S.memState[ma]||'');}
  if(S.faulted) {
    syncPicker(); refreshStats(); refreshPreview(); refreshBreakdown();
    return;
  }

  // JMP sobrescreve o IP que foi incrementado durante o fetch
  if(instr.jmpTarget !== undefined) setPC(instr.jmpTarget, { traceAutoScroll: true });

  await sleep(S.speed * 0.2);

  if(isStepTrace) {
    lg('sys', t('log.sys.step_done', ipReg(), fmtA(S.pc)), null, { indent:1, kindLabel:'RESULTADO' });
  } else {
    lg('store', t('log.store.exec_ok', instr.mnem), instr.asm);
  }

  if(S.halt) {
    setStatus(t('status.hlt'),'lbl-error',{log:false});
    if(isStepTrace) lg('error', t('log.error.hlt'), null, { indent:1, kindLabel:'HALT' });
    else lg('error', t('log.error.hlt'));
  } else {
    setStatus(t('status.execute_done', fmtA(S.pc)),'lbl-done',{log:false});
  }

  buildStackView();
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
  if(S.history.length > S.historyMax) S.history.shift();
}

function restoreSnapshot(snap) {
  // Calcula quais registradores efetivamente mudaram antes de restaurar
  const prevRegs = S.regs;
  const actuallyChanged = Object.keys(snap.regs).filter(k => snap.regs[k] !== prevRegs[k]);

  S.regs       = { ...snap.regs };
  S.mem        = snap.mem.slice();
  S.stackMem   = snap.stackMem.slice();
  S.stackState = new Map(snap.stackState);
  S.memState   = [...snap.memState];
  S.callFrames = snap.callFrames.map(f => ({ ...f }));
  S.halt       = false;
  if (actuallyChanged.length > 0) markRegistersChanged(actuallyChanged);
  else clearChangedRegisters();
  buildRegCards();
  buildMemGrid();
  buildStackView();
  syncPicker();
  refreshStats();
  refreshPreview();
  refreshBreakdown();
  setPC(snap.pc, { traceAutoScroll: true });
}

// Resolve qualquer byte de memória para o endereço de início
// da instrução que o contém. Se o byte não pertencer a nenhuma
// instrução conhecida do programa atual, retorna o próprio addr.
function instrStartFor(addr) {
  const target = addr & 0x3F;
  const lines = traceProgram(demoProgramForArch());
  for(const line of lines) {
    if(target >= line.addr && target < line.addr + line.size) return line.addr;
  }
  // Fora do programa principal: tenta traceBlock a partir do início
  const block = traceBlock(0, 64);
  for(const line of block) {
    if(target >= line.addr && target < line.addr + line.size) return line.addr;
  }
  return target;
}

function toggleBreakpoint(addr) {
  const a = instrStartFor(addr);
  if(S.breakpoints.has(a)) S.breakpoints.delete(a);
  else S.breakpoints.add(a);
  buildAsmTrace();
  buildMemGrid();
}

// Retorna o número 1-based do breakpoint em addr (ordenado por endereço), ou 0 se não existe.
function bpNumber(addr) {
  const sorted = [...S.breakpoints].sort((a, b) => a - b);
  const idx = sorted.indexOf(addr & 0x3F);
  return idx < 0 ? 0 : idx + 1;
}

async function doExecute(opts={}) {
  if(S.busy) return;
  clearFaultLatch();
  if(S.halt){ lg('error', t('log.error.cpu_halted')); return; }
  S.busy=true; setBusy(true);
  await _executeOne(opts);
  S.busy=false; setBusy(false);
}

// ─────────────────────────────────────────────────────────
// PROGRAMA — RUN / STEP
// ─────────────────────────────────────────────────────────
async function doStep() { await doExecute({ traceMode:'step' }); }

async function doRun() {
  if(S.busy||S.progRunning) return;
  clearFaultLatch();
  S.halt=false; S.paused=false; S.stopped=false; S.progRunning=true;
  S.breakpointHit = null;
  S.busy=true;
  setCpuState('running');

  while(!S.halt && !S.paused && !S.stopped) {
    if(S.breakpoints.has(S.pc & 0x3F)) {
      S.paused = true;
      S.breakpointHit = S.pc & 0x3F;
      lg('sys', t('log.sys.bp_hit', bpNumber(S.pc), fmtA(S.pc & 0x3F)));
      break;
    }
    snapshotState();
    await _executeOne({ traceMode:'run' });
    if(S.halt || S.paused || S.stopped) break;
    await sleep(S.speed * 0.1);
  }

  S.busy=false;
  setBusy(false);
  if(S.paused) {
    setCpuState('paused');
    buildMemGrid();
    buildAsmTrace({ autoScroll: true });
  } else {
    S.progRunning=false;
    setCpuState('idle');
  }
}

function doPause() {
  if(!S.progRunning || S.paused) return;
  S.paused = true;
  // O loop doRun() detecta S.paused e chama setCpuState('paused')
}

async function doResume() {
  if(!S.progRunning || !S.paused) return;
  let skipBreakpointOnce = S.breakpointHit === (S.pc & 0x3F)
    ? (S.pc & 0x3F)
    : null;
  S.paused = false;
  S.stopped = false;
  S.breakpointHit = null;
  S.busy = true;
  setCpuState('running');
  buildMemGrid();

  while(!S.halt && !S.paused && !S.stopped) {
    const pc = S.pc & 0x3F;
    const shouldPauseOnBreakpoint = S.breakpoints.has(pc) && pc !== skipBreakpointOnce;
    skipBreakpointOnce = null;
    if(shouldPauseOnBreakpoint) {
      S.paused = true;
      S.breakpointHit = pc;
      lg('sys', t('log.sys.bp_hit', bpNumber(S.pc), fmtA(S.pc & 0x3F)));
      break;
    }
    snapshotState();
    await _executeOne({ traceMode:'run' });
    if(S.halt || S.paused || S.stopped) break;
    await sleep(S.speed * 0.1);
  }

  S.busy = false;
  setBusy(false);
  if(S.paused) {
    setCpuState('paused');
    buildMemGrid();
    buildAsmTrace({ autoScroll: true });
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
  if(!S.paused) return;
  if(S.halt) { lg('error', t('log.error.cpu_halted')); return; }
  clearFaultLatch();
  snapshotState();
  S.busy = true; setBusy(true);
  await _executeOne({ traceMode:'step' });
  S.busy = false; setBusy(false);
}

async function _executeOneReverse(fromAddr) {
  const instr = decodeAt(fromAddr);
  // EXECUTE → DECODE → FETCH (ordem inversa)
  setStatus(t('status.execute_revert', instr.mnem),'lbl-load',{log:false});
  await sleep(S.speed * 0.2);
  setStatus(t('status.decode_revert', instr.mnem),'lbl-fetch',{log:false});
  await sleep(S.speed * 0.2);
  setStatus(t('status.fetch_revert', fmtA(fromAddr)),'lbl-fetch',{log:false});
  for(let i=0;i<instr.size;i++){const ma=(fromAddr+i)&0x3F; setMemSt(ma,'mc-pc');}
  await sleep(S.speed * 0.25);
  for(let i=0;i<instr.size;i++){const ma=(fromAddr+i)&0x3F; setMemSt(ma,S.memState[ma]||'');}
  setStatus(t('status.back_done', fmtA(fromAddr)),'lbl-done',{log:false});
}

async function doStepBack() {
  if(!S.paused) return;
  if(S.history.length === 0) return;
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
  if(S.busy) return;
  clearFaultLatch();
  S.busy=true; setBusy(true);
  const reg=S.reg, width=ptrSize();
  const spName = is64() ? 'RSP' : 'ESP';
  const nextSp = S.regs.ESP - width;
  if(!stackAccessFits(nextSp, width)) {
    reportStackBoundsError(`PUSH ${reg}`, nextSp, width, `PUSH ${reg}`, { halt: true });
    S.busy=false; setBusy(false);
    return;
  }
  S.regs.ESP=nextSp;
  const sp=S.regs.ESP;
  revealMemRange(sp, width, { select:true });
  buildStackView();
  lg('store', t('log.push', reg, regHex(reg), spName, fmtStackA(sp)), `PUSH ${reg}`);
  setStatus(t('status.push_start', reg, fmtStackA(sp)),'lbl-store');
  const bs=regBytes(reg,width);
  for(let i=0;i<width;i++) {
    const ma=sp+i;
    const hexPos=displayPosForTransferByte(reg, i, width);
    storeHighlight(reg, hexPos, width);
    setMemSt(ma,'mc-active');
    await animPacket('store', bs[i], ma, { surface:'stack', regName: reg, byteIdx: i, transferCount: width });
    writeMem(ma, bs[i], 'mc-active');
    await sleep(S.speed*0.12);
    setMemSt(ma, 'mc-written');
  }
  updateRegCard(reg); updatePickerVal(reg); updatePickerBytes(reg);
  updateRegCard(spName); updatePickerVal(spName);
  markRegistersChanged(spName);
  setStatus(t('status.push_done', spName, fmtStackA(sp)),'lbl-done');
  buildStackView();
  refreshStats(); refreshBreakdown();
  S.busy=false; setBusy(false);
}

async function doPop() {
  if(S.busy) return;
  clearFaultLatch();
  S.busy=true; setBusy(true);
  const reg=S.reg, spName=is64()?'RSP':'ESP', sp=S.regs.ESP >>> 0, width=ptrSize();
  if(!stackAccessFits(sp, width)) {
    reportStackBoundsError(`POP ${reg}`, sp, width, `POP ${reg}`, { halt: true });
    S.busy=false; setBusy(false);
    return;
  }
  lg('load', t('log.pop', fmtStackA(sp), reg, spName), `POP ${reg}`);
  setStatus(t('status.pop_start', fmtStackA(sp), reg),'lbl-load');
  revealMemRange(sp, width, { select:true });
  buildStackView();
  const partialLittle = new Array(width).fill(0);
  setRegParts(reg,0,0); setLoading(reg,true);
  for(let i=0;i<width;i++) {
    const ma=sp+i;
    setMemSt(ma,'mc-active');
    await animPacket('load', S.stackMem[ma], ma, { surface:'stack', regName: reg, byteIdx: i, transferCount: width });
    partialLittle[i]=S.stackMem[ma]&0xFF;
    setRegFromBytes(reg, partialLittle);
    liveUpdate(reg, 0, i, width); updatePickerVal(reg); updatePickerBytes(reg);
    await sleep(S.speed*0.12);
    setMemSt(ma,'mc-written');
  }
  setLoading(reg,false);
  S.regs.ESP=sp+width;
  updateRegCard(reg); updateRegCard(spName); updatePickerVal(spName);
  markRegistersChanged([reg, spName]);
  const finalHex=regHex(reg);
  $('valInput').value=finalHex.slice(-Math.min(sizeN()*2, regWidthBytes(reg)*2));
  setStatus(t('status.pop_done', reg, finalHex),'lbl-done');
  buildStackView();
  refreshStats(); refreshPreview(); refreshBreakdown();
  S.busy=false; setBusy(false);
}

// ─────────────────────────────────────────────────────────
// ASSEMBLER EMBUTIDO
// Converte instrução Intel (subset) para bytes e grava na memória
// ─────────────────────────────────────────────────────────
function parseAsmSource(src) {
  const normalized = src.trim().toUpperCase().replace(/\s+/g,' ').replace(/,\s*/g,',');
  if(!normalized) return { normalized:'', mnem:'', ops:[] };
  const tok = normalized.split(' ');
  const mnem = tok[0];
  const tail = tok.slice(1).join(' ').trim();
  const ops = tail ? tail.split(',').map(x=>x.trim()).filter(Boolean) : [];
  return { normalized, mnem, ops };
}

function parseAsmNumber(token) {
  const raw = token.trim().toUpperCase();
  if(!raw) return null;
  if(!/^0X[0-9A-F]+$/.test(raw) && !/^[0-9]+$/.test(raw)) return null;
  try {
    return { raw, big: BigInt(raw) };
  } catch(_) {
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
  if(!m) return null;
  const num = parseAsmNumber(m[2]);
  if(!num) return { error:'Endereco de memoria invalido.' };
  if(!fitsUnsigned(num.big, 16)) return { error:'Endereco de memoria fora de 16 bits.' };
  if(num.big > 0x3Fn) return { error:'Endereco de memoria fora do mapa 0x0000..0x003F.' };
  return {
    ptr: m[1] || '',
    addr: Number(num.big),
  };
}

const SUPPORTED_ASM_MNEMS = ['MOV','PUSH','POP','CALL','RET','JMP','NOP','HLT'];

function editDistance(a, b) {
  const aa = a.toUpperCase();
  const bb = b.toUpperCase();
  const rows = Array.from({length:aa.length + 1}, () => new Array(bb.length + 1).fill(0));
  for(let i=0;i<=aa.length;i++) rows[i][0] = i;
  for(let j=0;j<=bb.length;j++) rows[0][j] = j;
  for(let i=1;i<=aa.length;i++) {
    for(let j=1;j<=bb.length;j++) {
      const cost = aa[i-1]===bb[j-1] ? 0 : 1;
      rows[i][j] = Math.min(
        rows[i-1][j] + 1,
        rows[i][j-1] + 1,
        rows[i-1][j-1] + cost
      );
    }
  }
  return rows[aa.length][bb.length];
}

function humanJoin(list) {
  const uniq = [...new Set(list.filter(Boolean))];
  if(!uniq.length) return '';
  if(uniq.length===1) return uniq[0];
  if(uniq.length===2) return `${uniq[0]} ou ${uniq[1]}`;
  return `${uniq.slice(0,-1).join(', ')} ou ${uniq[uniq.length-1]}`;
}

function closestAsmNames(token, names, limit=2, maxDistance=2) {
  const raw = token.trim().toUpperCase();
  if(!raw) return [];
  return [...new Set(names)]
    .map(name => ({ name, dist: editDistance(raw, name) }))
    .filter(item => item.dist <= maxDistance)
    .sort((a,b) => a.dist - b.dist || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(item => item.name);
}

function asmValidRegistersForArch(opts={}) {
  if(is64()) {
    if(opts.onlyWide) return [...REG64, ...REG64X];
    return [...REG32, ...REG64, ...REG64X];
  }
  return [...REG32];
}

function asmRegisterExamples(expectedRegs=null) {
  const regs = expectedRegs?.length ? expectedRegs : asmValidRegistersForArch();
  const preferred = is64()
    ? ['RAX','RBX','RCX','RDX','RSP','RBP','R8','R9','R10','EAX','EBX','ECX','EDX','ESP','EBP']
    : ['EAX','EBX','ECX','EDX','ESP','EBP','ESI','EDI'];
  const picks = [];
  for(const name of preferred) {
    if(regs.includes(name) && !picks.includes(name)) picks.push(name);
  }
  return humanJoin(picks.slice(0, is64() ? 5 : 4));
}

function wideAliasForReg(name) {
  const idx = REG32.indexOf(name);
  return idx>=0 ? REG64[idx] : '';
}

function isAsmIdentifierToken(token) {
  return /^\$?[A-Z_][A-Z0-9_]*$/.test(token.trim().toUpperCase());
}

function instructionRuleHint(mnem, expectedRegs=null) {
  if(mnem==='MOV') {
    return 'Formas aceitas: MOV REG,IMEDIATO; MOV REG,REG; MOV REG,[END]; MOV [END],REG.';
  }
  if(mnem==='PUSH' || mnem==='POP') {
    const ex = is64() ? 'RAX' : 'EAX';
    return `${mnem} no assembler deste simulador aceita apenas 1 registrador. Exemplo: ${mnem} ${ex}.`;
  }
  if(mnem==='CALL') return 'Use um endereco do mapa, por exemplo CALL 0x0015.';
  if(mnem==='JMP') return 'Use um endereco do mapa, por exemplo JMP 0x0010 ou JMP SHORT 0x0010.';
  if(['NOP','HLT','RET'].includes(mnem)) return `Escreva apenas ${mnem}, sem operandos.`;
  return `Use operandos validos, por exemplo ${asmRegisterExamples(expectedRegs)}.`;
}

function explainUnsupportedMnemonic(mnem) {
  if(/^[0-9]+/.test(mnem)) {
    const stripped = mnem.replace(/^[0-9]+/, '');
    if(SUPPORTED_ASM_MNEMS.includes(stripped)) {
      return `Instrucao nao suportada pelo assembler: ${mnem}. O nome da instrucao nao pode comecar com numero. Parece haver um caractere extra antes de ${stripped}.`;
    }
  }
  const suggestions = closestAsmNames(mnem, SUPPORTED_ASM_MNEMS);
  if(suggestions.length) {
    return `Instrucao nao suportada pelo assembler: ${mnem}. Esse mnemonico nao existe exatamente assim no subset atual. Talvez voce quis dizer ${humanJoin(suggestions)}.`;
  }
  return `Instrucao nao suportada pelo assembler: ${mnem}. O subset atual aceita apenas ${humanJoin(SUPPORTED_ASM_MNEMS)}.`;
}

function explainInvalidRegisterOperand(token, mnem='', expectedRegs=null) {
  const raw = token.trim().toUpperCase();
  const regs = expectedRegs?.length ? expectedRegs : asmValidRegistersForArch();
  const ruleHint = instructionRuleHint(mnem, regs);

  if(!raw) return `Operando vazio. ${ruleHint}`;
  if(/^\$[A-Z0-9_]+$/.test(raw)) {
    const bare = raw.slice(1);
    if([...REG32, ...REG64, ...REG64X, 'EIP', 'RIP', 'PC'].includes(bare)) {
      return `Registrador invalido: ${raw}. Na sintaxe Intel usada pelo simulador, registradores nao levam o prefixo "$". Escreva ${bare}.`;
    }
    return `Registrador invalido: ${raw}. O prefixo "$" nao faz parte da sintaxe Intel usada aqui. ${ruleHint}`;
  }
  if(raw==='PC') {
    return 'Registrador invalido: PC. "PC" e apenas o nome didatico mostrado na interface. No assembler, altere o fluxo com JMP/CALL ou edite o PC pelos controles visuais.';
  }
  if(raw==='EIP' || raw==='RIP') {
    return `Registrador invalido: ${raw}. ${raw} e um ponteiro de instrucao especial da CPU, mas este assembler didatico nao aceita ${raw} como operando. Para mudar o fluxo, use JMP/CALL; a interface atualiza o PC automaticamente.`;
  }
  if(raw==='FP') {
    return `Registrador invalido: ${raw}. "FP" nao e um registrador Intel x86/x86-64. Para a base do frame, use ${is64() ? 'RBP' : 'EBP'}.`;
  }
  if(raw==='SP') {
    return `Registrador invalido: ${raw}. O nome correto do ponteiro de pilha nesta arquitetura e ${is64() ? 'RSP' : 'ESP'}.`;
  }
  if(raw==='BP') {
    return `Registrador invalido: ${raw}. O nome correto do base pointer nesta arquitetura e ${is64() ? 'RBP' : 'EBP'}.`;
  }
  if(/^0X$/.test(raw)) {
    return `Registrador invalido: ${raw}. Isso parece um hexadecimal incompleto: faltam digitos apos 0x. ${ruleHint}`;
  }
  if(/^0X[0-9A-F]+$/.test(raw) || /^[0-9]+$/.test(raw)) {
    return `Registrador invalido: ${raw}. Isso e um valor imediato, nao um registrador. ${ruleHint}`;
  }
  if(/^\[.*\]$/.test(raw) || /\bPTR\b/.test(raw)) {
    return `Registrador invalido: ${raw}. Isso representa memoria, nao um registrador. ${ruleHint}`;
  }

  const suggestions = closestAsmNames(raw, regs);
  if(suggestions.length) {
    return `Registrador invalido: ${raw}. Esse nome nao existe exatamente como foi escrito. Talvez voce quis dizer ${humanJoin(suggestions)}.`;
  }
  return `Registrador invalido: ${raw}. Esse nome nao existe nos registradores aceitos pelo simulador nesta arquitetura. Use, por exemplo, ${asmRegisterExamples(regs)}.`;
}

function validateAssembly(src, baseAddr=S.pc) {
  const { normalized, mnem, ops } = parseAsmSource(src);
  if(!normalized) return { ok:false, error:'Digite uma instrucao ASM.' };

  const allRegs = [...REG32, ...REG64, ...REG64X];
  const isReg = n => allRegs.includes(n);
  const regAllowedInArch = n => is64() || (!REG64.includes(n) && !REG64X.includes(n));
  const requireNoOps = name => {
    if(ops.length!==0) return { ok:false, error:`${name} nao recebe operandos. ${instructionRuleHint(name)}` };
    return null;
  };
  const requireOneOp = name => {
    if(ops.length!==1) return { ok:false, error:`${name} exige exatamente 1 operando. ${instructionRuleHint(name)}` };
    return null;
  };
  const requireTwoOps = name => {
    if(ops.length!==2) return { ok:false, error:`${name} exige exatamente 2 operandos. ${instructionRuleHint(name)}` };
    return null;
  };

  if(['NOP','HLT','RET'].includes(mnem)) {
    const err = requireNoOps(mnem);
    if(err) return err;
  } else if(mnem==='PUSH' || mnem==='POP') {
    const err = requireOneOp(mnem);
    if(err) return err;
    const reg = ops[0];
    const expectedRegs = asmValidRegistersForArch({ onlyWide:is64() });
    if(!isReg(reg)) return { ok:false, error:explainInvalidRegisterOperand(reg, mnem, expectedRegs) };
    if(!regAllowedInArch(reg)) return { ok:false, error:`${reg} nao existe no modo IA-32.` };
    if(is64() && asmRegWidth(reg)!==64) {
      const alias = wideAliasForReg(reg);
      return { ok:false, error:`Em x86-64, ${mnem} da simulacao aceita apenas registradores de 64 bits. ${reg} tem 32 bits${alias ? `; use ${alias}` : ''}.` };
    }
  } else if(mnem==='JMP') {
    const err = requireOneOp('JMP');
    if(err) return err;
    const targetTok = ops[0].replace(/^SHORT\s+/,'').trim();
    const target = parseAsmNumber(targetTok);
    if(!target) return { ok:false, error:`Destino de JMP invalido: ${ops[0]}. ${instructionRuleHint('JMP')}` };
    if(target.big > 0x3Fn) return { ok:false, error:'Destino de JMP fora do mapa 0x0000..0x003F.' };
  } else if(mnem==='CALL') {
    const err = requireOneOp('CALL');
    if(err) return err;
    const target = parseAsmNumber(ops[0]);
    if(!target) return { ok:false, error:`Destino de CALL invalido: ${ops[0]}. ${instructionRuleHint('CALL')}` };
    if(target.big > 0x3Fn) return { ok:false, error:'Destino de CALL fora do mapa 0x0000..0x003F.' };
  } else if(mnem==='MOV') {
    const err = requireTwoOps('MOV');
    if(err) return err;
    const [dst, src2] = ops;
    const dstReg = isReg(dst) ? dst : null;
    const srcReg = isReg(src2) ? src2 : null;
    const dstMem = parseAsmMemoryOperand(dst);
    const srcMem = parseAsmMemoryOperand(src2);
    const imm = parseAsmNumber(src2);

    if(dstReg && !regAllowedInArch(dstReg)) return { ok:false, error:`${dstReg} nao existe no modo IA-32.` };
    if(srcReg && !regAllowedInArch(srcReg)) return { ok:false, error:`${srcReg} nao existe no modo IA-32.` };
    if(dstMem?.error) return { ok:false, error:dstMem.error };
    if(srcMem?.error) return { ok:false, error:srcMem.error };
    if(!dstReg && !dstMem) {
      const dstRaw = dst.trim().toUpperCase();
      if(parseAsmNumber(dstRaw) || /^0X$/.test(dstRaw) || /^[0-9]+$/.test(dstRaw)) {
        return { ok:false, error:`Operando de destino invalido: ${dst}. Em MOV, o destino nao pode ser um valor imediato. ${instructionRuleHint('MOV')}` };
      }
      if(/^\[/.test(dstRaw) || /\bPTR\b/.test(dstRaw)) {
        return { ok:false, error:`Operando de memoria invalido: ${dst}. Use [0x0010], DWORD PTR [0x0010] ou QWORD PTR [0x0010].` };
      }
      if(isAsmIdentifierToken(dstRaw)) {
        return { ok:false, error:explainInvalidRegisterOperand(dstRaw, 'MOV', asmValidRegistersForArch()) };
      }
    }
    if(!srcReg && !srcMem && !imm) {
      const srcRaw = src2.trim().toUpperCase();
      if(/^\[/.test(srcRaw) || /\bPTR\b/.test(srcRaw)) {
        return { ok:false, error:`Operando de memoria invalido: ${src2}. Use [0x0010], DWORD PTR [0x0010] ou QWORD PTR [0x0010].` };
      }
      if(isAsmIdentifierToken(srcRaw) || /^\$[A-Z0-9_]+$/.test(srcRaw) || /^0X$/.test(srcRaw) || /^[0-9]+$/.test(srcRaw)) {
        return { ok:false, error:explainInvalidRegisterOperand(srcRaw, 'MOV', asmValidRegistersForArch()) };
      }
    }

    if(dstReg && imm) {
      const bits = asmRegWidth(dstReg);
      if(bits===64) {
        if(!is64()) return { ok:false, error:`${dstReg} nao existe no modo IA-32.` };
        if(!fitsUnsigned(imm.big, 64)) return { ok:false, error:'Imediato nao cabe em 64 bits sem sinal.' };
      } else if(!fitsUnsigned(imm.big, 32)) {
        return { ok:false, error:'Imediato nao cabe em 32 bits sem sinal.' };
      }
    } else if(dstReg && srcReg) {
      if(asmRegWidth(dstReg)!==asmRegWidth(srcReg)) {
        return { ok:false, error:'MOV entre registradores exige operandos da mesma largura.' };
      }
    } else if(dstMem && srcReg) {
      const bits = asmRegWidth(srcReg);
      if(bits===64 && !is64()) return { ok:false, error:`${srcReg} nao existe no modo IA-32.` };
      if(dstMem.ptr && !['DWORD','QWORD'].includes(dstMem.ptr)) {
        return { ok:false, error:'A simulacao suporta apenas DWORD PTR e QWORD PTR para MOV.' };
      }
      if(bits===64 && dstMem.ptr && dstMem.ptr!=='QWORD') {
        return { ok:false, error:'MOV com registrador de 64 bits requer QWORD PTR.' };
      }
      if(bits===32 && dstMem.ptr && dstMem.ptr!=='DWORD') {
        return { ok:false, error:'MOV com registrador de 32 bits requer DWORD PTR.' };
      }
    } else if(dstReg && srcMem) {
      const bits = asmRegWidth(dstReg);
      if(bits===64 && !is64()) return { ok:false, error:`${dstReg} nao existe no modo IA-32.` };
      if(srcMem.ptr && !['DWORD','QWORD'].includes(srcMem.ptr)) {
        return { ok:false, error:'A simulacao suporta apenas DWORD PTR e QWORD PTR para MOV.' };
      }
      if(bits===64 && srcMem.ptr && srcMem.ptr!=='QWORD') {
        return { ok:false, error:'MOV com registrador de 64 bits requer QWORD PTR.' };
      }
      if(bits===32 && srcMem.ptr && srcMem.ptr!=='DWORD') {
        return { ok:false, error:'MOV com registrador de 32 bits requer DWORD PTR.' };
      }
    } else {
      return { ok:false, error:`Formato de MOV nao suportado neste simulador. ${instructionRuleHint('MOV')}` };
    }
  } else {
    return { ok:false, error:explainUnsupportedMnemonic(mnem) };
  }

  const bytes = assemble(normalized, baseAddr);
  if(!bytes) return { ok:false, error:'Instrucao reconhecida, mas nao pode ser codificada pelo subset atual. Revise os operandos e os formatos aceitos por este simulador.' };
  return { ok:true, bytes, normalized };
}

function refreshAsmValidation() {
  const input = $('asmInput');
  const hint = $('asmHint');
  if(!input || !hint) return;

  const raw = input.value.trim();
  input.classList.remove('is-valid','is-invalid');
  hint.classList.remove('asm-hint-ok','asm-hint-error');

  if(!raw) {
    hint.textContent = 'Grava bytes no PC atual. Enter para confirmar.';
    return;
  }

  const check = validateAssembly(raw, S.pc);
  if(check.ok) {
    input.classList.add('is-valid');
    hint.classList.add('asm-hint-ok');
    hint.textContent = `Valido: ${check.bytes.length} byte(s) serao gravados em 0x${fmtA(S.pc)}.`;
  } else {
    input.classList.add('is-invalid');
    hint.classList.add('asm-hint-error');
    hint.textContent = `Invalido: ${check.error}`;
  }
}

function assemble(src, baseAddr=S.pc) {
  const { normalized, mnem, ops } = parseAsmSource(src);
  if(!normalized) return null;

  // Build full register lookup (IA-32 + x64 GP + R8-R15)
  const ALL_REGS = [...REG32, ...REG64, ...REG64X];
  const isReg = n => ALL_REGS.includes(n);
  const isWideAsmReg = n => REG64.includes(n) || REG64X.includes(n);
  const isImm = n => /^0X[0-9A-F]+$/.test(n)||/^[0-9]+$/.test(n);
  const parseImm = n => Number(parseAsmNumber(n).big & 0xFFFFFFFFn)>>>0;
  const parseImm64Parts = n => {
    const big = BigInt.asUintN(64, parseAsmNumber(n).big);
    return {
      hi: Number((big >> 32n) & 0xFFFFFFFFn)>>>0,
      lo: Number(big & 0xFFFFFFFFn)>>>0,
    };
  };
  const modrm = (mod,reg,rm) => ((mod&3)<<6)|((reg&7)<<3)|(rm&7);

  // Resolve a register name to {idx, rex_b/rex_r}
  function resolveReg(name) {
    let idx = REG32.indexOf(name);
    if(idx>=0) return {idx, ext:false};
    idx = REG64.indexOf(name);
    if(idx>=0) return {idx, ext:false};
    idx = REG64X.indexOf(name);
    if(idx>=0) return {idx, ext:true};
    return null;
  }

  // Build REX byte from flags
  function rexByte(w,r,x,b) {
    const v = 0x40 | (w?8:0) | (r?4:0) | (x?2:0) | (b?1:0);
    return v===0x40 ? [] : [v]; // only emit if any flag is set
  }

  if(mnem==='NOP')  return [0x90];
  if(mnem==='HLT')  return [0xF4];
  if(mnem==='RET')  return [0xC3];

  if(mnem==='PUSH' && ops.length===1) {
    if(isReg(ops[0])) {
      const r=resolveReg(ops[0]); if(!r) return null;
      return [...rexByte(0,0,0,r.ext), 0xFF, modrm(3,6,r.idx)];
    }
  }
  if(mnem==='POP' && ops.length===1) {
    if(isReg(ops[0])) {
      const r=resolveReg(ops[0]); if(!r) return null;
      return [...rexByte(0,0,0,r.ext), 0x8F, modrm(3,0,r.idx)];
    }
  }

  if(mnem==='JMP' && ops.length===1) {
    const lbl=ops[0].replace('SHORT','').trim();
    const target = lbl.startsWith('0X') ? parseInt(lbl,16) : parseInt(lbl,10);
    const rel = (target - (baseAddr+2))&0xFF;
    return [0xEB, rel&0xFF];
  }
  if(mnem==='CALL' && ops.length===1) {
    const target = ops[0].startsWith('0X') ? parseInt(ops[0],16) : parseInt(ops[0],10);
    const rel = (target - (baseAddr+5)) >> 0;
    return [0xE8, rel&0xFF, (rel>>8)&0xFF, (rel>>16)&0xFF, (rel>>24)&0xFF];
  }

  if(mnem==='MOV' && ops.length===2) {
    const [dst,src2]=ops;
    // MOV reg, imm32
    if(isReg(dst) && isImm(src2)) {
      const r=resolveReg(dst); if(!r) return null;
      if(isWideAsmReg(dst)) {
        const imm=parseImm64Parts(src2);
        return [
          ...rexByte(1,0,0,r.ext),
          0xB8+r.idx,
          imm.lo&0xFF,(imm.lo>>8)&0xFF,(imm.lo>>16)&0xFF,(imm.lo>>24)&0xFF,
          imm.hi&0xFF,(imm.hi>>8)&0xFF,(imm.hi>>16)&0xFF,(imm.hi>>24)&0xFF,
        ];
      }
      const v=parseImm(src2);
      return [...rexByte(0,0,0,r.ext), 0xB8+r.idx, v&0xFF,(v>>8)&0xFF,(v>>16)&0xFF,(v>>24)&0xFF];
    }
    // MOV reg, reg
    if(isReg(dst) && isReg(src2)) {
      const rd=resolveReg(dst), rs=resolveReg(src2); if(!rd||!rs) return null;
      const wide = isWideAsmReg(dst) && isWideAsmReg(src2);
      return [...rexByte(wide,rs.ext,0,rd.ext), 0x89, modrm(3,rs.idx,rd.idx)];
    }
    // MOV [addr], reg  (strip QWORD PTR / DWORD PTR if present)
    const dstClean = dst.replace(/(?:QWORD|DWORD|WORD|BYTE)\s*PTR\s*/,'');
    const src2Clean = src2.replace(/(?:QWORD|DWORD|WORD|BYTE)\s*PTR\s*/,'');
    const mAddr=/^\[(?:0X)?([0-9A-F]+)\]$/.exec(dstClean);
    if(mAddr && isReg(src2Clean)) {
      const rs=resolveReg(src2Clean); if(!rs) return null;
      const addr=parseInt(mAddr[1],16)&0x3F;
      const wide = /\bQWORD\b/.test(dst) || isWideAsmReg(src2Clean);
      return [...rexByte(wide,rs.ext,0,0), 0x89, modrm(0,rs.idx,0), addr];
    }
    // MOV reg, [addr]
    const mAddr2=/^\[(?:0X)?([0-9A-F]+)\]$/.exec(src2Clean);
    if(isReg(dstClean) && mAddr2) {
      const rd=resolveReg(dstClean); if(!rd) return null;
      const addr=parseInt(mAddr2[1],16)&0x3F;
      const wide = /\bQWORD\b/.test(src2) || isWideAsmReg(dstClean);
      return [...rexByte(wide,rd.ext,0,0), 0x8B, modrm(0,rd.idx,0), addr];
    }
  }
  return null; // não reconhecido
}

async function doAssemble() {
  const inp=$('asmInput'); if(!inp) return;
  const src=inp.value.trim(); if(!src) return;
  const addr=S.pc;
  const validation = validateAssembly(src, addr);
  refreshAsmValidation();
  if(!validation.ok){
    setStatus(t('status.asm_invalid_short', validation.error),'lbl-error');
    lg('error', t('log.error.asm_invalid', fmtA(addr), validation.error));
    return;
  }
  const result = writeAssembledBytes(addr, validation.normalized, undefined, validation.bytes);
  if(!result){ lg('error',`ASM: não reconhecido — "${src}"`); return; }
  lg('sys',`ASM: "${src}" → [${result.bytes.map(b=>'0x'+hex8(b)).join(', ')}] @ 0x${fmtA(addr)}`);
  setPC((addr+result.bytes.length)&0x3F);
  lg('sys', `${result.bytes.length} byte(s) gravados em 0x${fmtA(addr)}`);
  inp.value='';
  refreshAsmValidation();
}

// ─────────────────────────────────────────────────────────
// CLEAR
// ─────────────────────────────────────────────────────────
function doClear() {
  resetStatsState();
  resetCoreRegisters();
  S.halt=false; S.stopped=false; S.progRunning=false; S.breakpoints.clear(); S.breakpointHit=null;
  // Reset selected register to arch default
  S.reg = is64() ? 'RAX' : 'EAX';
  loadDefaultProgram(false);
  buildRegCards(); buildRegPicker(); buildMemGrid(); setPC(0);
  $('valInput').value=regHex(S.reg).slice(-Math.min(sizeN()*2, regWidthBytes(S.reg)*2));
  buildStackView();
  syncPicker(); refreshStats(); refreshPreview(); refreshBreakdown();
  $('clockDisplay').textContent='—';
  $('opsDisplay').textContent='0';
  setCpuState('idle');
  setStatus(t('status.demo_reset'),'lbl-done');
  lg('sys', t('log.sys.demo_reset'), asmForOp('clear',{}));
  lg('sys', demoProgramForArch().listing.join(' | '));
}

function clearBreakpoints() {
  S.breakpoints.clear();
  S.breakpointHit = null;
  buildAsmTrace();
  buildMemGrid();
}

// ─────────────────────────────────────────────────────────
// STACK VIEW
// ─────────────────────────────────────────────────────────
function distanceUp(from, to) {
  return Math.max(0, to - from);
}

function inActiveFrame(addr, sp, bp) {
  if(sp===bp) return false;
  const total = distanceUp(sp, bp);
  const dist = distanceUp(sp, addr);
  return dist>0 && dist<total;
}

function frameAddressesDesc() {
  const sp = S.regs.ESP >>> 0;
  const bp = S.regs.EBP >>> 0;
  const ret = bp + ptrSize();

  if(sp===bp) {
    const out = [];
    const top = Math.min(S.stackSize - 1, sp + 3);
    const bottom = Math.max(0, sp - 4);
    for(let addr=top;addr>=bottom;addr--) out.push(addr);
    return out;
  }

  const start = Math.min(S.stackSize - 1, ret + 2);
  const end = Math.max(0, sp - 2);
  const out = [];
  let cur = start;
  while(out.length < 20 && cur >= end) {
    out.push(cur);
    if(cur===end) break;
    cur -= 1;
  }
  return out;
}

function stackRowMeta(addr) {
  const sp = S.regs.ESP >>> 0;
  const bp = S.regs.EBP >>> 0;
  const ret = bp + ptrSize();
  const tags = [];

  if(addr===sp) tags.push({cls:'sp', text:`${is64()?'RSP':'ESP'} topo`});
  if(addr===bp) tags.push({cls:'bp', text:`${is64()?'RBP':'EBP'} base`});
  if(sp!==bp && addr===ret) tags.push({cls:'ret', text:'retorno'});
  if(addr===S.pc) tags.push({cls:'pc', text:'PC'});
  if(inActiveFrame(addr, sp, bp)) tags.push({cls:'frame', text:'frame ativo'});

  const priority = ['sp','bp','ret','pc','frame'];
  const primary = tags.find(tag => priority.includes(tag.cls))?.cls || 'default';
  return {primary, tags};
}

function stackGranBytes() {
  switch(S.stackGranularity) {
    case 'word':  return 2;
    case 'dword': return 4;
    case 'qword': return 8;
    default:      return 1;
  }
}

function stackGroupHex(baseAddr, n) {
  // Lê n bytes a partir de baseAddr em little-endian e retorna string hex
  let val = 0;
  for(let i = n - 1; i >= 0; i--) val = (val * 256) + (S.stackMem[baseAddr + i] || 0);
  return val.toString(16).padStart(n * 2, '0').toUpperCase();
}

function buildStackView() {
  const view = $('stackView');
  if(!view) return;

  const spName = is64() ? 'RSP' : 'ESP';
  const bpName = is64() ? 'RBP' : 'EBP';
  const sp = S.regs.ESP >>> 0;
  const bp = S.regs.EBP >>> 0;
  const retInfo = currentReturnInfo();
  const mode = S.stackMode === 'frame' ? 'FRAME' : 'FULL';
  const gran = stackGranBytes();

  // Lista de endereços base para cada linha (granulados, alinhados ao tamanho do grupo)
  let rawList = S.stackMode === 'frame'
    ? frameAddressesDesc()
    : Array.from({length:Math.min(64, S.stackSize)}, (_,i)=>(S.stackSize - 1) - i);

  // Ao agrupar, filtrar para que apenas o endereço base de cada grupo apareça
  let list;
  if(gran === 1) {
    list = rawList;
  } else {
    const seen = new Set();
    list = [];
    for(const addr of rawList) {
      const base = addr - (addr % gran);
      if(!seen.has(base)) { seen.add(base); list.push(base); }
    }
  }

  const rows = list.map(addr => {
    // Para granularidade > 1, verifica se todos os bytes do grupo estão na lista original
    const meta = stackRowMeta(addr);
    const tags = meta.tags.length
      ? meta.tags.map(tag => `<span class="stack-tag stack-tag-${tag.cls}">${tag.text}</span>`).join('')
      : '<span class="stack-row-empty">livre</span>';
    const valHex = gran === 1
      ? hex8(S.stackMem[addr] || 0)
      : stackGroupHex(addr, gran);
    const granLabel = gran === 1 ? '' : ` stack-row-gran-${S.stackGranularity}`;
    return `<div class="stack-row${granLabel} stack-row-${meta.primary}" data-stack-addr="${addr}" title="${t('ui.stack.row.title')}">
      <span class="stack-row-addr">0x${fmtStackA(addr)}</span>
      <span class="stack-row-byte">${valHex}</span>
      <span class="stack-row-tags">${tags}</span>
    </div>`;
  }).join('');

  view.innerHTML = `
    <div class="stack-meta">
      <div class="stack-meta-row stack-meta-row-mode"><span class="stack-meta-key">modo</span><span class="stack-meta-pill">${mode}</span></div>
      <div class="stack-meta-row stack-meta-row-size"><span class="stack-meta-key">Tamanho da stack</span><span class="stack-meta-pill">${formatStackSize(S.stackSize)}</span></div>
      <div class="stack-meta-row stack-meta-row-pc"><span class="stack-meta-key">${ipReg()} (Contador)</span><span class="stack-meta-pill">0x${fmtA(S.pc)}</span></div>
      <div class="stack-meta-row stack-meta-row-esp"><span class="stack-meta-key">${spName} (Topo da Pilha)</span><span class="stack-meta-pill">0x${fmtStackA(sp)}</span></div>
      <div class="stack-meta-row stack-meta-row-ebp"><span class="stack-meta-key">${bpName} (Base do Frame)</span><span class="stack-meta-pill">0x${fmtStackA(bp)}</span></div>
      <div class="stack-meta-row stack-meta-row-ret"><span class="stack-meta-key">Endereco de retorno</span><span class="stack-meta-pill">${retInfo ? `0x${fmtA(retInfo.returnTo)}` : '—'}</span></div>
    </div>
    ${buildStackTrace()}
    <div class="stack-list">${rows}</div>`;

  const stackLbl = $('stackArchLbl');
  if(stackLbl) stackLbl.textContent = `STACK  ${spName}/${bpName}`;
  syncStackSizeUI();
  syncStackCfgUI();
  scheduleCenterPaneLayout();
}

// Sincroniza os botões ativos do painel de configuração
function syncStackCfgUI() {
  // Modo: FULL / FRAME
  const modeFull  = $('stackModeFull');
  const modeFrame = $('stackModeFrame');
  if(modeFull)  modeFull.classList.toggle('stack-cfg-mode-btn-active',  S.stackMode !== 'frame');
  if(modeFrame) modeFrame.classList.toggle('stack-cfg-mode-btn-active', S.stackMode === 'frame');

  // Granularidade
  const granIds = { byte:'stackGranByte', word:'stackGranWord', dword:'stackGranDword', qword:'stackGranQword' };
  for(const [val, id] of Object.entries(granIds)) {
    const el = $(id);
    if(el) el.classList.toggle('stack-cfg-gran-btn-active', S.stackGranularity === val);
  }
}

function toggleStackCfg() {
  const panel  = $('stackCfg');
  const toggle = $('stackCfgToggle');
  if(!panel) return;
  const isOpen = panel.classList.toggle('stack-cfg-open');
  panel.setAttribute('aria-hidden', String(!isOpen));
  if(toggle) toggle.setAttribute('aria-expanded', String(isOpen));
}

function setStackMode(mode) {
  if(mode !== 'full' && mode !== 'frame') return;
  S.stackMode = mode;
  buildStackView();
}

// Mantém toggleStackMode para compatibilidade interna
function toggleStackMode() {
  S.stackMode = S.stackMode === 'frame' ? 'full' : 'frame';
  buildStackView();
}

function setStackGranularity(val) {
  const valid = ['byte','word','dword','qword'];
  if(!valid.includes(val)) return;
  S.stackGranularity = val;
  buildStackView();
}

const stackRowEl = addr => $('stackView')?.querySelector(`.stack-row[data-stack-addr="${addr}"]`);
const stackByteEl = addr => stackRowEl(addr)?.querySelector('.stack-row-byte') || null;

function activeRegisterAnchor(dir, opts={}) {
  const regName = opts.regName || S.reg;
  const transferCount = opts.transferCount || transferWidth(regName);
  const exactByte = registerByteAnchor(regName, opts.byteIdx, transferCount);
  const bytes = $('rcb-'+regName);
  if(dir==='store') {
    return exactByte || bytes?.querySelector('.byte-arriving, .byte-active, .byte-done') || $('rcv-'+regName) || $('rc-'+regName);
  }
  return exactByte || bytes?.querySelector('.byte-arriving, .byte-active, .byte-done') || $('rcv-'+regName) || $('rc-'+regName);
}

function setMemOpIndicator(addr, dir) {
  const cell = memEl(addr);
  if(!cell) return;
  cell.classList.remove('mc-op-store','mc-op-load');
  cell.classList.add(dir==='load' ? 'mc-op-load' : 'mc-op-store');
}

function clearMemOpIndicator(addr) {
  const cell = memEl(addr);
  if(!cell) return;
  cell.classList.remove('mc-op-store','mc-op-load');
}

function setStackOpIndicator(addr, dir) {
  const cell = stackByteEl(addr);
  if(!cell) return;
  cell.classList.remove('stack-byte-op-store','stack-byte-op-load');
  cell.classList.add(dir==='load' ? 'stack-byte-op-load' : 'stack-byte-op-store');
}

function clearStackOpIndicator(addr) {
  const cell = stackByteEl(addr);
  if(!cell) return;
  cell.classList.remove('stack-byte-op-store','stack-byte-op-load');
}

function animIndicator(surface, addr, dir, active) {
  if(surface === 'stack') {
    if(active) setStackOpIndicator(addr, dir);
    else clearStackOpIndicator(addr);
    return;
  }
  if(active) setMemOpIndicator(addr, dir);
  else clearMemOpIndicator(addr);
}

function animTargetAnchor(surface, addr) {
  if(surface === 'stack') return stackByteEl(addr) || stackRowEl(addr);
  return memEl(addr);
}

function rectEdgePoint(fromRect, toRect, stageRect) {
  const fx = fromRect.left + fromRect.width / 2;
  const fy = fromRect.top + fromRect.height / 2;
  const tx = toRect.left + toRect.width / 2;
  const ty = toRect.top + toRect.height / 2;
  const dx = tx - fx;
  const dy = ty - fy;
  const hw = Math.max(fromRect.width / 2, 1);
  const hh = Math.max(fromRect.height / 2, 1);
  const scale = 1 / Math.max(Math.abs(dx) / hw || 0, Math.abs(dy) / hh || 0, 1);
  const x = fx + dx * scale;
  const y = fy + dy * scale;
  return {
    x: clamp(x - stageRect.left, 6, Math.max(stageRect.width - 6, 6)),
    y: clamp(y - stageRect.top, 6, Math.max(stageRect.height - 6, 6)),
  };
}

// ─────────────────────────────────────────────────────────
// ANIMATION
// ─────────────────────────────────────────────────────────
async function animPacket(dir, bv, targetIdx, opts={}) {
  const stage=$('animStage'), svg=$('animSVG');
  const surface = opts.surface === 'stack' ? 'stack' : 'mem';
  const regAnchor = activeRegisterAnchor(dir, opts);
  const targetAnchor = animTargetAnchor(surface, targetIdx);
  if(!stage||!svg||!regAnchor||!targetAnchor){ await sleep(Math.max(S.speed*0.4,80)); return; }

  const sr=stage.getBoundingClientRect();
  const rr=regAnchor.getBoundingClientRect();
  const tr=targetAnchor.getBoundingClientRect();
  const sourceRect = dir==='store' ? rr : tr;
  const destRect = dir==='store' ? tr : rr;
  const start = rectEdgePoint(sourceRect, destRect, sr);
  const end = rectEdgePoint(destRect, sourceRect, sr);

  const col=dir==='store'?'#4ade80':'#60a5fa';
  const mk =dir==='store'?'url(#arrowG)':'url(#arrowB)';
  animIndicator(surface, targetIdx, dir, true);

  const ln=document.createElementNS('http://www.w3.org/2000/svg','line');
  [['x1',start.x],['y1',start.y],['x2',end.x],['y2',end.y],
   ['stroke',col],['stroke-width','1.8'],['stroke-dasharray','5 4'],
   ['stroke-linecap','round'],['opacity','0.52'],['marker-end',mk]].forEach(([k,v])=>ln.setAttribute(k,v));
  svg.appendChild(ln);

  const pkt=document.createElement('div');
  pkt.className=`anim-packet pkt-${dir}`;
  pkt.textContent=hex8(bv);
  pkt.style.cssText=`left:${start.x}px;top:${start.y}px;`;
  stage.appendChild(pkt);

  const dur=Math.max(S.speed*0.58,110), t0=performance.now();
  await new Promise(res=>{
    function step(now){
      const t=Math.min((now-t0)/dur,1), e=ease(t);
      pkt.style.left=(start.x+(end.x-start.x)*e)+'px';
      pkt.style.top =(start.y+(end.y-start.y)*e)+'px';
      t<1 ? requestAnimationFrame(step) : (pkt.remove(),ln.remove(),animIndicator(surface, targetIdx, dir, false),res());
    }
    requestAnimationFrame(step);
  });
}

// ─────────────────────────────────────────────────────────
// PC / STATUS / LOG / STATS
// ─────────────────────────────────────────────────────────
function setPC(addr, opts={}){
  S.pc=addr&0x3F;
  const syncTrace = opts.trace !== false;
  const traceAutoScroll = opts.traceAutoScroll === true;
  const revealMem = opts.revealMem === true;
  const pd=$('pcDisplay');
  if(pd && document.activeElement!==pd) pd.value=fmtA(S.pc);
  const ai=$('addrInput');
  if(ai && document.activeElement!==ai) {
    ai.value=fmtA(S.pc);
    if(revealMem) revealMemAddr(S.pc, { select:true, scroll:true });
    refreshBreakdown();
  }
  if(syncTrace) {
    buildAsmTrace({ autoScroll: traceAutoScroll });
    refreshAsmValidation();
  }
}
function statusLogType(cls) {
  if(cls==='lbl-error') return 'error';
  if(cls==='lbl-store') return 'store';
  if(cls==='lbl-load') return 'load';
  if(cls==='lbl-fetch') return 'info';
  return 'sys';
}
function setStatus(msg, cls, opts={}) {
  if(!msg || opts.log===false) return;
  const key = `${cls||''}|${msg}`;
  if(key===lastStatusLog) return;
  lastStatusLog = key;
  lg(statusLogType(cls), msg);
}

function sizePtr() {
  if(S.size==='byte')  return 'BYTE PTR';
  if(S.size==='word')  return 'WORD PTR';
  if(S.size==='qword') return 'QWORD PTR';
  return is64() ? 'DWORD PTR' : 'DWORD PTR';
}
function ipReg() { return is64() ? 'RIP' : 'EIP'; }

function asmForOp(type, ctx) {
  // ctx: { reg, addr, val, byteAddr, byteVal, byteIdx, byteCount, newPC }
  switch(type) {
    case 'store-start':
      return `MOV ${sizePtr()} [0x${fmtA(ctx.addr)}], ${ctx.reg}`;
    case 'store-byte':
      return `MOV BYTE PTR [0x${fmtA(ctx.byteAddr)}], 0x${hex8(ctx.byteVal)}  ; byte ${ctx.byteIdx+1}/${ctx.byteCount}`;
    case 'load-start':
      return `MOV ${ctx.reg}, ${sizePtr()} [0x${fmtA(ctx.addr)}]`;
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

function logKindLabel(type, overrideLabel='') {
  if(overrideLabel) return overrideLabel;
  if(type==='step') return t('log.kind.step');
  if(type==='store') return t('log.kind.store');
  if(type==='load') return t('log.kind.load');
  if(type==='info') return t('log.kind.info');
  if(type==='error') return t('log.kind.error');
  return t('log.kind.sys');
}

function lg(type, msg, asm, opts={}) {
  const out=$('logOutput'); if(!out) return;
  const d=document.createElement('div');
  const indent = Math.max(0, Number.isFinite(opts.indent) ? opts.indent : (S.logIndent || 0));
  d.className='le le-'+type+(indent ? ` le-indent-${Math.min(indent,3)}` : '');
  d.dataset.type = type;
  if(indent > 0) {
    const offset = indent * 20;
    d.style.marginLeft = `${offset}px`;
    d.style.maxWidth = `calc(100% - ${offset}px)`;
  }
  const ts=new Date().toTimeString().slice(0,8);
  const tsEl=document.createElement('span');
  tsEl.className='le-ts';
  tsEl.textContent=`[${ts}]`;

  const kindEl=document.createElement('span');
  kindEl.className='le-kind';
  kindEl.textContent=logKindLabel(type, opts.kindLabel || '');

  const msgEl=document.createElement('span');
  msgEl.className='le-msg';
  msgEl.textContent=msg;

  d.append(tsEl, kindEl, msgEl);

  if(asm) {
    const asmEl=document.createElement('div');
    asmEl.className='le-asm';
    const asmLbl=document.createElement('span');
    asmLbl.className='le-asm-lbl';
    asmLbl.textContent='asm:';
    const code=document.createElement('code');
    code.textContent=asm;
    asmEl.append(asmLbl, code);
    d.appendChild(asmEl);
  }
  out.appendChild(d); out.scrollTop=out.scrollHeight;
}
function doClearLog(){
  const o=$('logOutput');
  if(o) o.innerHTML='';
  lastStatusLog = '';
  scheduleCenterPaneLayout();
}

function recOp(type,ms){
  S.stats.ops++; S.stats.totalTime+=ms;
  if(type==='load') {S.stats.loads++;  S.stats.loadTimes.push(ms);}
  if(type==='store'){S.stats.stores++; S.stats.storeTimes.push(ms);}
  S.endian==='little'?S.stats.littleOps++:S.stats.bigOps++;
  $('clockDisplay').textContent=ms+'ms';
  $('opsDisplay').textContent=S.stats.ops;
}

function refreshStats(){
  const st=S.stats;
  if(!$('st-ops')) return;
  $('st-ops').textContent=st.ops;
  $('st-time').textContent=st.totalTime+'ms';
  $('st-loads').textContent=st.loads;
  $('st-stores').textContent=st.stores;
  const avg=a=>a.length?Math.round(a.reduce((x,y)=>x+y,0)/a.length):null;
  const al=avg(st.loadTimes), as=avg(st.storeTimes);
  $('st-avgl').textContent=al!==null?al+'ms':'—';
  $('st-avgs').textContent=as!==null?as+'ms':'—';
  const tot=st.littleOps+st.bigOps, pL=tot?Math.round(st.littleOps/tot*100):50;
  $('pfl').style.width=pL+'%'; $('pfb').style.width=(100-pL)+'%';
  $('pc-l').textContent=st.littleOps; $('pc-b').textContent=st.bigOps;
}

function setBusy(on){['opStore','opLoad','opClear','opStep','opRun','opPush','opPop'].forEach(id=>{const b=$(id);if(b)b.disabled=on;});}
function readAddr(){return parseInt($('addrInput').value||'0',16)&0x3F;}

// ─────────────────────────────────────────────────────────
// SAVE / LOAD
// ─────────────────────────────────────────────────────────
function saveSim(){
  const data={version:10,state:{
    endian:S.endian,size:S.size,reg:S.reg,arch:S.arch,stackMode:S.stackMode,stackSize:S.stackSize,stackSizeInputUnit:S.stackSizeInputUnit,sidebarPanelWidth:S.sidebarPanelWidth,sidebarPanelManual:S.sidebarPanelManual,stackPanelWidth:S.stackPanelWidth,stackPanelManual:S.stackPanelManual,codeMemSplitWidth:S.codeMemSplitWidth,codeMemSplitManual:S.codeMemSplitManual,centerPaneHeights:{...S.centerPaneHeights},collapsedSections:{...S.collapsedSections},speed:S.speed,
    memViewBase:S.memViewBase,
    regs:{...S.regs},mem:Array.from(S.mem),memState:[...S.memState],stackMem:Array.from(S.stackMem || []),stackState:Array.from((S.stackState || new Map()).entries()),
    stats:{...S.stats,loadTimes:[...S.stats.loadTimes],storeTimes:[...S.stats.storeTimes]},pc:S.pc
  }};
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  a.download=`memsim_${Date.now()}.json`; a.click();
  lg('sys','Simulação salva.');
}

function loadSim(e){
  const file=e.target.files[0]; if(!file) return;
  const r=new FileReader();
  r.onload=ev=>{
    try{
      const d=JSON.parse(ev.target.result).state;
      S.endian=d.endian; S.size=d.size; S.reg=d.reg;
      if(d.stackMode) S.stackMode=d.stackMode;
      if(Number.isFinite(d.stackSize)) S.stackSize = normalizeStackSizeBytes(d.stackSize);
      S.stackSizeInputUnit = normalizeStackSizeUnit(d.stackSizeInputUnit || preferredStackSizeUnit(S.stackSize));
      S.sidebarPanelManual = !!d.sidebarPanelManual;
      S.stackPanelManual = !!d.stackPanelManual;
      S.codeMemSplitManual = !!d.codeMemSplitManual;
      if(S.sidebarPanelManual && Number.isFinite(d.sidebarPanelWidth)) S.sidebarPanelWidth = clamp(d.sidebarPanelWidth, 220, 420);
      if(S.stackPanelManual && Number.isFinite(d.stackPanelWidth)) S.stackPanelWidth = clamp(d.stackPanelWidth, 220, 520);
      if(S.codeMemSplitManual && Number.isFinite(d.codeMemSplitWidth)) S.codeMemSplitWidth = d.codeMemSplitWidth;
      if(d.centerPaneHeights && typeof d.centerPaneHeights==='object') {
        Object.keys(CENTER_PANE_CONFIG).forEach(key => {
          const height = parseInt(d.centerPaneHeights[key], 10);
          if(Number.isFinite(height)) S.centerPaneHeights[key] = height;
        });
      }
      if(d.collapsedSections && typeof d.collapsedSections==='object') {
        S.collapsedSections = { ...d.collapsedSections };
      }
      if(Number.isFinite(d.speed)) S.speed = normalizeSpeed(d.speed);
      if(Number.isFinite(d.memViewBase)) S.memViewBase = normalizeMemViewBase(d.memViewBase);
      if(d.arch) S.arch=d.arch;
      Object.assign(S.regs,d.regs);
      S.mem=new Uint8Array(d.mem); S.memState=d.memState;
      ensureStackMem();
      if(Array.isArray(d.stackMem) && d.stackMem.length===S.stackSize) S.stackMem = new Uint8Array(d.stackMem);
      else S.stackMem.fill(0);
      S.stackState = Array.isArray(d.stackState) ? new Map(d.stackState) : new Map();
      syncLowMemoryToStack();
      Object.assign(S.stats,d.stats); S.pc=d.pc;
      applySidebarPanelWidth();
      persistSidebarPanelWidth();
      applyStackPanelWidth();
      persistStackPanelWidth();
      applyCodeMemSplit();
      persistCodeMemSplit();
      applyCenterPaneHeights();
      persistCenterPaneHeights();
      applyCollapsedSections();
      persistCollapsedSections();
      doSetEndian(S.endian); doSetArch(S.arch); doSetSize(S.size); doSelectReg(S.reg);
      buildRegCards(); buildRegPicker(); buildMemGrid(); setPC(S.pc);
      buildStackView();
  syncSpeedUI();
  syncStackSizeUI();
      syncPicker(); refreshStats(); refreshPreview(); refreshBreakdown();
      $('opsDisplay').textContent = S.stats.ops;
      $('clockDisplay').textContent = '—';
      lg('sys','Simulação carregada.');
    }catch(err){ lg('error','Falha: '+err.message); }
  };
  r.readAsText(file); e.target.value='';
}

// ─────────────────────────────────────────────────────────
// HELP
// ─────────────────────────────────────────────────────────
function showHelp(page, tabEl){
  $('helpBody').innerHTML=t(`help.${page}`)||'';
  $$('.htab').forEach(tab=>tab.classList.remove('active'));
  if(tabEl) tabEl.classList.add('active');
}
function closeHelp(){ $('helpBg').classList.remove('open'); }

// ─────────────────────────────────────────────────────────
// PUBLIC API  (called from HTML onclick="App.xxx()")
// ─────────────────────────────────────────────────────────
const App = {
  setEndian:  doSetEndian,
  setSize:    doSetSize,
  setArch:    doSetArch,
  selectReg:  doSelectReg,
  doStore,
  doLoad,
  doClear,
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
  doAssemble,
  toggleStackMode,
  setStackMode,
  setStackGranularity,
  toggleStackCfg,
  applyStackSize,
  clearLog:        doClearLog,
  clearBreakpoints,
  showHelp,
  closeHelp,
  _applyI18n: function() {
    const asmPh = $('asmInput');
    if (asmPh) asmPh.placeholder = t(S.arch==='x64' ? 'asm.hint.placeholder.x64' : 'asm.hint.placeholder.ia32');
    const stackLbl = $('stackArchLbl');
    if (stackLbl) stackLbl.textContent = t(is64() ? 'stack.label.x64' : 'stack.label.ia32');
    buildAsmTrace();
    buildMemGrid();
    buildRegCards();
  },
};

document.addEventListener('DOMContentLoaded', init);
