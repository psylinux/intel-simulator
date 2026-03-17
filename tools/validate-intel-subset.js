#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const APP_JS = path.join(ROOT, 'js', 'app.js');

class MockClassList {
  constructor() {
    this.items = new Set();
  }
  add(...tokens) {
    tokens.filter(Boolean).forEach(token => this.items.add(token));
  }
  remove(...tokens) {
    tokens.forEach(token => this.items.delete(token));
  }
  toggle(token, force) {
    if(force === true) {
      this.items.add(token);
      return true;
    }
    if(force === false) {
      this.items.delete(token);
      return false;
    }
    if(this.items.has(token)) {
      this.items.delete(token);
      return false;
    }
    this.items.add(token);
    return true;
  }
  contains(token) {
    return this.items.has(token);
  }
}

class MockElement {
  constructor(id = '', tagName = 'div') {
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.style = {
      setProperty() {},
    };
    this.classList = new MockClassList();
    this.className = '';
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
    this.disabled = false;
    this.title = '';
    this.placeholder = '';
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.clientHeight = 360;
    this.onclick = null;
    this.listeners = {};
  }
  appendChild(child) {
    this.children.push(child);
    this.scrollHeight = this.children.length * 24;
    return child;
  }
  append(...nodes) {
    nodes.forEach(node => this.appendChild(node));
  }
  querySelector() {
    return new MockElement();
  }
  querySelectorAll() {
    return [];
  }
  addEventListener(type, handler) {
    if(!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(handler);
  }
  removeEventListener() {}
  setAttribute(name, value) {
    this[name] = value;
  }
  focus() {}
  select() {}
  remove() {}
  click() {
    if(typeof this.onclick === 'function') {
      this.onclick({ target:this, preventDefault() {}, stopPropagation() {} });
    }
  }
  closest() {
    return null;
  }
  getBoundingClientRect() {
    return { left:0, top:0, right:640, bottom:480, width:640, height:480 };
  }
}

function createDocument() {
  const elements = new Map();
  const nullIds = [/^animStage$/, /^animSVG$/, /^rc/, /^rpv-/, /^rpb-/, /^r[A-Z0-9]+$/];

  const doc = {
    body: new MockElement('body', 'body'),
    _listeners: {},
    getElementById(id) {
      if(nullIds.some(rx => rx.test(id))) return null;
      if(!elements.has(id)) elements.set(id, new MockElement(id));
      return elements.get(id);
    },
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
    createElement(tagName) {
      return new MockElement('', tagName);
    },
    createElementNS(_ns, tagName) {
      return new MockElement('', tagName);
    },
    createTextNode(text) {
      return { nodeType:3, nodeValue:String(text) };
    },
    addEventListener(type, handler) {
      this._listeners[type] = handler;
    },
  };

  return { document: doc, elements };
}

function loadSimulator() {
  const { document, elements } = createDocument();
  const storage = new Map();
  let tick = 0;
  const context = {
    console,
    Math,
    Date,
    JSON,
    RegExp,
    Array,
    Object,
    Set,
    Map,
    String,
    Number,
    Boolean,
    BigInt,
    Promise,
    Uint8Array,
    parseInt,
    parseFloat,
    URL: { createObjectURL() { return 'blob:mock'; } },
    Blob: class Blob {},
    FileReader: class FileReader {},
    setTimeout(fn) {
      if(typeof fn === 'function') fn();
      return 0;
    },
    clearTimeout() {},
    requestAnimationFrame(fn) {
      if(typeof fn === 'function') fn((tick += 16));
      return 0;
    },
    cancelAnimationFrame() {},
    performance: {
      now() {
        return ++tick;
      },
    },
    localStorage: {
      getItem(key) {
        return storage.has(key) ? storage.get(key) : null;
      },
      setItem(key, value) {
        storage.set(key, String(value));
      },
      removeItem(key) {
        storage.delete(key);
      },
    },
    document,
    navigator: { userAgent: 'node' },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);

  const source = fs.readFileSync(APP_JS, 'utf8') + `
globalThis.__memsim = {
  S,
  init,
  decodeAt,
  validateAssembly,
  assemble,
  doFetch,
  _executeOne,
  doStore,
  doLoad,
  doPush,
  doPop,
  doSetArch,
  doSetEndian,
  doSetSize,
  setPC,
  getReg,
  setReg,
  regHex,
  regBytes,
  regParts,
  setRegParts,
  setRegFromBytes,
  ptrSize,
  mapAccessFits,
  isInstructionFault,
  loadDefaultProgram,
  resetCoreRegisters
};
`;
  vm.runInContext(source, context, { filename: APP_JS });
  return { api: context.__memsim, document, elements };
}

function hexBytes(bytes) {
  return bytes.map(v => v.toString(16).padStart(2, '0').toUpperCase());
}

function setAddr(document, addr) {
  document.getElementById('addrInput').value = addr.toString(16).padStart(4, '0').toUpperCase();
}

function defaultStackTop(api) {
  return api.S.stackSize;
}

function resetSim(api, document, arch = 'ia32') {
  api.S.arch = arch;
  api.S.endian = 'little';
  api.S.size = arch === 'x64' ? 'qword' : 'dword';
  api.S.reg = arch === 'x64' ? 'RAX' : 'EAX';
  api.S.stackSize = 100 * 1024;
  api.S.busy = false;
  api.S.halt = false;
  api.S.faulted = false;
  api.S.progRunning = false;
  api.S.callFrames = [];
  api.resetCoreRegisters();
  api.S.stackMem = new Uint8Array(api.S.stackSize);
  api.S.regs.ESP = defaultStackTop(api);
  api.S.regs.EBP = defaultStackTop(api);
  api.S.mem.fill(0);
  api.S.memState.fill('');
  setAddr(document, 0);
  api.setPC(0);
}

function writeBytes(api, addr, bytes) {
  bytes.forEach((byte, idx) => {
    api.S.mem[(addr + idx) & 0x3F] = byte & 0xFF;
    api.S.memState[(addr + idx) & 0x3F] = 'mc-written';
  });
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('STORE standalone sempre grava little-endian, mesmo com visualizacao BIG', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.S.endian = 'big';
  api.S.size = 'dword';
  api.S.reg = 'EAX';
  api.setReg('EAX', 0x12345678);
  setAddr(document, 0x0010);
  await api.doStore();
  assert.deepEqual(Array.from(api.S.mem.slice(0x10, 0x14)), [0x78, 0x56, 0x34, 0x12]);
});

test('LOAD standalone sempre le little-endian, mesmo com visualizacao BIG', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.S.endian = 'big';
  api.S.size = 'dword';
  api.S.reg = 'EAX';
  writeBytes(api, 0x0020, [0x78, 0x56, 0x34, 0x12]);
  setAddr(document, 0x0020);
  await api.doLoad();
  assert.equal(api.regHex('EAX'), '12345678');
});

test('MOV r32, imm32 executa com imediato little-endian e PC sequencial', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  writeBytes(api, 0x0000, [0xB8, 0x78, 0x56, 0x34, 0x12]);
  await api._executeOne();
  assert.equal(api.regHex('EAX'), '12345678');
  assert.equal(api.S.pc, 0x0005);
});

test('MOV r64, imm64 com REX.W carrega 64 bits completos', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'x64');
  writeBytes(api, 0x0000, [0x48, 0xB8, 0x88, 0x77, 0x66, 0x55, 0x44, 0x33, 0x22, 0x11]);
  await api._executeOne();
  assert.equal(api.regHex('RAX'), '1122334455667788');
  assert.equal(api.S.pc, 0x000A);
});

test('MOV [mem], reg grava bytes little-endian no subset decodificado', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.setReg('EAX', 0xDEADBEEF);
  writeBytes(api, 0x0000, api.assemble('MOV DWORD PTR [0x0010], EAX', 0x0000));
  await api._executeOne();
  assert.deepEqual(Array.from(api.S.mem.slice(0x10, 0x14)), [0xEF, 0xBE, 0xAD, 0xDE]);
});

test('MOV reg, [mem] reconstrui o registrador a partir de bytes little-endian', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  writeBytes(api, 0x0010, [0xEF, 0xBE, 0xAD, 0xDE]);
  writeBytes(api, 0x0000, api.assemble('MOV ECX, DWORD PTR [0x0010]', 0x0000));
  await api._executeOne();
  assert.equal(api.regHex('ECX'), 'DEADBEEF');
});

test('PUSH usa little-endian e decrementa o stack pointer antes da escrita', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.S.endian = 'big';
  api.S.reg = 'EAX';
  api.setReg('EAX', 0xA1B2C3D4);
  await api.doPush();
  assert.equal(api.S.regs.ESP, defaultStackTop(api) - 4);
  assert.deepEqual(Array.from(api.S.stackMem.slice(api.S.regs.ESP, api.S.regs.ESP + 4)), [0xD4, 0xC3, 0xB2, 0xA1]);
});

test('POP usa little-endian e incrementa o stack pointer apos a leitura', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.S.endian = 'big';
  api.S.reg = 'EAX';
  api.S.regs.ESP = defaultStackTop(api) - 4;
  api.S.stackMem.set([0xD4, 0xC3, 0xB2, 0xA1], api.S.regs.ESP);
  await api.doPop();
  assert.equal(api.regHex('EAX'), 'A1B2C3D4');
  assert.equal(api.S.regs.ESP, defaultStackTop(api));
});

test('CALL em IA-32 empilha o proximo EIP e desvia para o alvo', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  writeBytes(api, 0x0000, [0xE8, 0x05, 0x00, 0x00, 0x00, 0xF4, 0x00, 0x00, 0x00, 0x00, 0xC3]);
  await api._executeOne();
  assert.equal(api.S.pc, 0x000A);
  assert.equal(api.S.regs.ESP, defaultStackTop(api) - 4);
  assert.deepEqual(Array.from(api.S.stackMem.slice(api.S.regs.ESP, api.S.regs.ESP + 4)), [0x05, 0x00, 0x00, 0x00]);
  assert.equal(api.S.callFrames.length, 1);
});

test('RET em IA-32 restaura o endereco de retorno empilhado por CALL', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  writeBytes(api, 0x0000, [0xE8, 0x05, 0x00, 0x00, 0x00, 0xF4, 0x00, 0x00, 0x00, 0x00, 0xC3]);
  await api._executeOne();
  await api._executeOne();
  assert.equal(api.S.pc, 0x0005);
  assert.equal(api.S.regs.ESP, defaultStackTop(api));
  assert.equal(api.S.callFrames.length, 0);
});

test('CALL/RET em x86-64 usam largura de ponteiro de 8 bytes', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'x64');
  writeBytes(api, 0x0000, [0xE8, 0x05, 0x00, 0x00, 0x00, 0xF4, 0x00, 0x00, 0x00, 0x00, 0xC3]);
  await api._executeOne();
  assert.equal(api.S.pc, 0x000A);
  assert.equal(api.S.regs.ESP, defaultStackTop(api) - 8);
  assert.deepEqual(Array.from(api.S.stackMem.slice(api.S.regs.ESP, api.S.regs.ESP + 8)), [0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  await api._executeOne();
  assert.equal(api.S.pc, 0x0005);
  assert.equal(api.S.regs.ESP, defaultStackTop(api));
});

test('FETCH avanca o IP/RIP para a proxima instrucao sem executar a instrucao atual', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  writeBytes(api, 0x0000, [0xB8, 0x78, 0x56, 0x34, 0x12]);
  await api.doFetch();
  assert.equal(api.S.pc, 0x0005);
  assert.equal(api.regHex('EAX'), 'DEADBEEF');
});

test('Opcode invalido marca erro e para a CPU no execute', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  writeBytes(api, 0x0000, [0x0F]);
  await api._executeOne();
  assert.equal(api.S.halt, true);
  assert.equal(api.S.faulted, true);
  assert.equal(api.S.memState[0x0000], 'mc-error');
});

test('Decode inconsistente em ModRM invalido e sinalizado como erro', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  writeBytes(api, 0x0000, [0xFF, 0xE8]);
  await api._executeOne();
  assert.equal(api.S.halt, true);
  assert.equal(api.S.faulted, true);
  assert.deepEqual(api.S.memState.slice(0, 2), ['mc-error', 'mc-error']);
});

test('Overflow de largura em MOV para memoria interrompe a execucao e marca bytes visiveis', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  api.setReg('EAX', 0xCAFEBABE);
  writeBytes(api, 0x0000, [0x89, 0x00, 0x3E]);
  await api._executeOne();
  assert.equal(api.S.halt, true);
  assert.equal(api.S.faulted, true);
  assert.equal(api.S.memState[0x003E], 'mc-error');
  assert.equal(api.S.memState[0x003F], 'mc-error');
});

test('RET corrompido e detectado quando o endereco empilhado nao bate com o CALL ativo', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  writeBytes(api, 0x0000, [0xE8, 0x05, 0x00, 0x00, 0x00, 0xF4, 0x00, 0x00, 0x00, 0x00, 0xC3]);
  await api._executeOne();
  api.S.stackMem[api.S.regs.ESP] = 0x07;
  await api._executeOne();
  assert.equal(api.S.halt, true);
  assert.equal(api.S.faulted, true);
  assert.equal(api.S.pc, 0x000A);
});

test('Validador aceita MOV imediato suportado e gera opcode correto', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  const check = api.validateAssembly('MOV EAX, 0x1234', 0x0000);
  assert.equal(check.ok, true);
  assert.equal(hexBytes(check.bytes).join(' '), 'B8 34 12 00 00');
});

test('Validador explica por que PUSH EAX e invalido em x86-64 neste simulador', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'x64');
  const check = api.validateAssembly('PUSH EAX', 0x0000);
  assert.equal(check.ok, false);
  assert.match(check.error, /64 bits/i);
});

test('Validador explica que EIP nao pode ser usado como operando ASM', async () => {
  const { api, document } = loadSimulator();
  resetSim(api, document, 'ia32');
  const check = api.validateAssembly('MOV EIP, 0x1', 0x0000);
  assert.equal(check.ok, false);
  assert.match(check.error, /ponteiro de instrucao especial/i);
});

(async () => {
  let passed = 0;
  for(const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`PASS ${t.name}`);
    } catch (err) {
      console.error(`FAIL ${t.name}`);
      console.error(err.stack || err.message || String(err));
      process.exitCode = 1;
      break;
    }
  }
  if(process.exitCode) return;
  console.log(`\n${passed}/${tests.length} validacoes passaram.`);
})();
