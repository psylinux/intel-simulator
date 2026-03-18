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

function syncSpeedUI() {
  S.speed = normalizeSpeed(S.speed);
  const slider = $('speedSlider');
  const label = $('speedVal');
  if (slider) slider.value = String(S.speed);
  if (label) label.textContent = `${S.speed}ms`;
}

function syncStackSizeUI(displayBytes = S.stackSize) {
  const input = $('stackSizeInput');
  const unitSel = $('stackSizeUnitSelect');
  S.stackSizeInputUnit = normalizeStackSizeUnit(S.stackSizeInputUnit || preferredStackSizeUnit(displayBytes));
  if (unitSel && document.activeElement !== unitSel) unitSel.value = S.stackSizeInputUnit;
  if (input) {
    input.min = S.stackSizeInputUnit === 'KB' ? '0.001' : '1';
    input.max = S.stackSizeInputUnit === 'KB' ? String(MAX_STACK_SIZE / 1024) : String(MAX_STACK_SIZE);
    input.step = S.stackSizeInputUnit === 'KB' ? '0.001' : '1';
    if (document.activeElement !== input) input.value = formatStackSizeInputValue(displayBytes, S.stackSizeInputUnit);
  }
}

function doSetStackSizeUnit(nextUnit) {
  const input = $('stackSizeInput');
  const prevUnit = normalizeStackSizeUnit(S.stackSizeInputUnit || 'B');
  const normalized = normalizeStackSizeUnit(nextUnit);
  let previewBytes = S.stackSize;

  if (input) {
    const raw = parseFloat(input.value || '');
    if (Number.isFinite(raw)) previewBytes = normalizeStackSizeBytes(raw * stackSizeUnitFactor(prevUnit));
  }

  S.stackSizeInputUnit = normalized;
  syncStackSizeUI(previewBytes);
}

function setRunButtonMode(mode = 'run') {
  setCpuState(mode === 'stop' ? 'running' : 'idle');
}

// idle | running | paused
function setCpuState(state) {
  const grid = $('cpuOpsGrid');
  if (grid) grid.dataset.cpuState = state;
  // Botões de operação fora da CPU (desabilitar durante running/paused)
  const frozen = (state === 'running' || state === 'paused');
  ['opStore', 'opLoad', 'opPush', 'opPop'].forEach(id => {
    const b = $(id); if (b) b.disabled = frozen;
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
  renderRegCards();
  renderRegPicker();
  renderMemGrid();
  syncPicker();
  if (isSpReg(S.reg)) $('valInput').value = fmtA(getReg(S.reg));
  renderStackView();
  refreshPreview();
  refreshBreakdown();
  syncStackSizeUI();
  lg('sys', t('log.sys.stack_size', formatStackSize(nextSize), is64() ? 'RSP/RBP' : 'ESP/EBP', fmtStackA(stackTopInit()), fmtMemA(Math.max(memSpaceSize() - 1, 0))));
}


function changedRegisterSet() {
  return new Set(Array.isArray(S.changedRegs) ? S.changedRegs : []);
}

function syncRegChangedClasses() {
  const changed = changedRegisterSet();
  [...gpRegs(), ...extRegs(), ...spRegs()].forEach(name => {
    $('rc-' + name)?.classList.toggle('reg-changed', changed.has(name));
    $('r' + name)?.classList.toggle('reg-changed', changed.has(name));
  });
}
function traceBlock(startAddr, maxLines = 20) {
  const lines = [];
  const visited = new Set();
  let pc = startAddr & 0x3F;

  while (lines.length < maxLines && !visited.has(pc)) {
    visited.add(pc);
    const instr = decodeAt(pc);
    const size = Math.max(instr.size || 1, 1);
    const bytes = [];
    for (let i = 0; i < size; i++) bytes.push(hex8(S.mem[(pc + i) & 0x3F]));
    lines.push({
      addr: pc,
      size,
      bytes: bytes.join(' '),
      asm: instr.asm || instr.mnem || `DB 0x${hex8(S.mem[pc])}`,
      c: cForInstr(instr, pc),
    });
    pc = (pc + size) & 0x3F;
    if (instr.op === 0xF4) break;
  }

  return lines;
}

function traceProgram(program = demoProgramForArch()) {
  const lines = [];
  const visited = new Set();
  let pc = program.entry & 0x3F;
  let consumed = 0;
  const limit = Math.min(program.bytes.length, 64);

  while (consumed < limit && !visited.has(pc)) {
    visited.add(pc);
    const instr = decodeAt(pc);
    const size = Math.max(instr.size || 1, 1);
    const bytes = [];
    for (let i = 0; i < size; i++) bytes.push(hex8(S.mem[(pc + i) & 0x3F]));
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
  return bits === 64 ? 'uint64_t' : 'uint32_t';
}

function cForInstr(instr, addr) {
  const asm = instr.asm || instr.mnem || `DB 0x${hex8(S.mem[addr & 0x3F])}`;
  let m = null;

  if (instr.unknown) return { kind: 'pseudo', label: 'PSEUDO', code: `db(0x${hex8(instr.op)});` };
  if (asm === 'NOP') return { kind: 'pseudo', label: 'PSEUDO', code: '/* no-op */' };
  if (asm === 'HLT') return { kind: 'pseudo', label: 'PSEUDO', code: 'HALT_CPU();' };
  if (asm === 'RET') return { kind: 'c', label: 'C', code: 'return;' };
  if ((m = /^CALL 0X([0-9A-F]+)$/.exec(asm))) return { kind: 'c', label: 'C', code: `fn_0x${m[1]}();` };
  if ((m = /^JMP SHORT 0X([0-9A-F]+)$/.exec(asm))) return { kind: 'c', label: 'C', code: `goto loc_0x${m[1]};` };
  if ((m = /^PUSH ([A-Z0-9]+)$/.exec(asm))) return { kind: 'pseudo', label: 'PSEUDO', code: `STACK.push(${m[1]});` };
  if ((m = /^POP ([A-Z0-9]+)$/.exec(asm))) return { kind: 'pseudo', label: 'PSEUDO', code: `${m[1]} = STACK.pop();` };
  if ((m = /^MOV ([A-Z0-9]+), 0X([0-9A-F]+)$/.exec(asm))) return { kind: 'c', label: 'C', code: `${m[1]} = 0x${m[2]};` };
  if ((m = /^MOV ([A-Z0-9]+), ([A-Z0-9]+)$/.exec(asm))) return { kind: 'c', label: 'C', code: `${m[1]} = ${m[2]};` };
  if ((m = /^MOV (QWORD|DWORD) PTR \[0X([0-9A-F]+)\], ([A-Z0-9]+)$/.exec(asm))) {
    return { kind: 'c', label: 'C', code: `*((${cScalarType(m[1] === 'QWORD' ? 64 : 32)}*)0x${m[2]}) = ${m[3]};` };
  }
  if ((m = /^MOV ([A-Z0-9]+), (QWORD|DWORD) PTR \[0X([0-9A-F]+)\]$/.exec(asm))) {
    return { kind: 'c', label: 'C', code: `${m[1]} = *((${cScalarType(m[2] === 'QWORD' ? 64 : 32)}*)0x${m[3]});` };
  }
  if ((m = /^DB 0X([0-9A-F]+)$/.exec(asm))) return { kind: 'pseudo', label: 'PSEUDO', code: `db(0x${m[1]});` };
  return { kind: 'pseudo', label: 'PSEUDO', code: `/* ${asm} */` };
}

function ensureCurrentTraceVisible() {
  const root = $('asmTrace');
  if (!root) return;
  const currentRow = root.querySelector('.trace-row-current');
  if (!currentRow) return;
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
  if (instr.op !== 0xE8) return null;
  return {
    addr: callAddr,
    asm: instr.asm || instr.mnem || `CALL 0x${fmtA(addr)}`,
  };
}

function normalizeStackTraceCall(frame) {
  if (!frame) return null;
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
  if (top) return top;

  const bp = S.regs.EBP >>> 0;
  if (!stackAccessFits(bp, ptrSize())) return null;
  const retSlot = bp + ptrSize();
  if (!stackAccessFits(retSlot, ptrSize())) return null;
  const retAddr = readStackPtrLE(retSlot, ptrSize()) & 0x3F;
  const callSite = callSiteForReturn(retAddr);
  if (!callSite) return null;

  return {
    slot: retSlot,
    width: ptrSize(),
    returnTo: retAddr,
    callSite: callSite.addr & 0x3F,
    callAsm: callSite.asm || `CALL 0x${fmtA(retAddr)}`,
  };
}

function stackTraceExtra(frameCall) {
  if (!frameCall) return 'Frame raiz: nenhuma chamada ativa e nenhum endereco de retorno pendente.';
  return `<span class="stack-trace-ret-addr">RET → 0x${fmtA(frameCall.returnTo)}</span> · slot [0x${fmtStackA(frameCall.slot)}] · entrou via ${frameCall.callAsm} @ 0x${fmtA(frameCall.callSite)}`;
}

function stackTraceFrames() {
  const calls = (S.callFrames || []).map(normalizeStackTraceCall).filter(Boolean);
  if (calls.length) {
    const items = [];
    const total = Math.min(calls.length + 1, 9);
    for (let depth = 0; depth < total; depth++) {
      const addr = depth === 0
        ? (S.pc & 0x3F)
        : (calls[calls.length - depth].returnTo & 0x3F);
      const frameCall = (calls.length - 1 - depth) >= 0
        ? calls[calls.length - 1 - depth]
        : null;
      items.push({
        kind: depth === 0 ? 'current' : (frameCall ? 'caller' : 'root'),
        label: depth === 0 ? 'ATUAL' : (frameCall ? 'CHAMADOR' : 'RAIZ'),
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

  for (let depth = 0; depth <= 8; depth++) {
    let frameCall = null;
    if (stackAccessFits(bp, ptrSize())) {
      const retSlot = bp + ptrSize();
      if (stackAccessFits(retSlot, ptrSize())) {
        const retAddr = readStackPtrLE(retSlot, ptrSize()) & 0x3F;
        const callSite = callSiteForReturn(retAddr);
        if (callSite) {
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
      kind: depth === 0 ? 'current' : (frameCall ? 'caller' : 'root'),
      label: depth === 0 ? 'ATUAL' : (frameCall ? 'CHAMADOR' : 'RAIZ'),
      depth,
      addr: currentAddr,
      asm: codeLabelAt(currentAddr),
      extra: stackTraceExtra(frameCall),
    });

    if (!frameCall || !stackAccessFits(bp, ptrSize()) || visitedBp.has(bp)) break;
    const prevBp = readStackPtrLE(bp, ptrSize()) >>> 0;
    if (prevBp === bp) break;
    visitedBp.add(bp);
    currentAddr = frameCall.returnTo & 0x3F;
    bp = prevBp;
  }

  return items;
}

function renderStackTrace() {
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
      ${items.length === 1 && items[0].kind === 'root' ? '<div class="stack-trace-empty">Nenhuma chamada ativa no momento. O programa esta no frame raiz.</div>' : ''}
    </div>`;
}

function renderTraceByteChips(bytesText) {
  const tokens = String(bytesText || '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return '<span class="asm-byte asm-byte-empty">--</span>';
  return tokens.map(tok => `<span class="asm-byte">${tok}</span>`).join('');
}

function renderAsmTrace(opts = {}) {
  const root = $('asmTrace');
  if (!root) return;
  const autoScroll = opts.autoScroll === true;

  const primary = traceProgram(demoProgramForArch());
  const currentShown = primary.some(line => line.addr === S.pc);
  let lines = primary;

  if (!currentShown) {
    lines = [
      ...primary,
      { separator: true },
      ...traceBlock(S.pc, 8),
    ];
  }

  root.innerHTML = lines.length
    ? lines.map(line => {
      if (line.separator) return '<div class="trace-separator">PC atual fora do fluxo principal. Abaixo, decode local a partir do PC.</div>';
      const byteChips = renderTraceByteChips(line.bytes);
      const hasBp = S.breakpoints.has(line.addr);
      const bpNum = hasBp ? bpNumber(line.addr) : 0;
      const isHit = hasBp && S.breakpointHit === line.addr && S.paused;
      return `<div class="trace-row${line.addr === S.pc ? ' trace-row-current' : ''}${hasBp ? ' trace-row-bp' : ''}${isHit ? ' trace-row-bp-hit' : ''}">
          <div class="asm-line${line.addr === S.pc ? ' asm-line-current' : ''}" data-addr="${fmtA(line.addr)}" data-size="${line.size || 1}" title="${t('asm.nav.title')}">
            <div class="asm-line-head">
              <span class="bp-dot${hasBp ? ' bp-dot-active' : ''}${isHit ? ' bp-dot-hit' : ''}" data-addr="${fmtA(line.addr)}" title="${hasBp ? t('asm.bp.remove', bpNum) : t('asm.bp.set')}">${hasBp ? bpNum : ''}</span>
              <span class="asm-line-addr">0x${fmtA(line.addr)}</span>
              <span class="asm-line-size">${line.size || 1}B</span>
            </div>
            <div class="asm-line-bytes">${byteChips}</div>
            <div class="asm-line-asm">${line.asm}</div>
          </div>
          <div class="c-line${line.addr === S.pc ? ' c-line-current' : ''}" data-addr="${fmtA(line.addr)}" title="${t('asm.pseudocode.title')}">
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

  if (autoScroll) requestAnimationFrame(() => requestAnimationFrame(ensureCurrentTraceVisible));
  scheduleCenterPaneLayout();
}


// ─────────────────────────────────────────────────────────
// REGISTER CARDS
// ─────────────────────────────────────────────────────────
function parseRegisterInput(name, raw) {
  const clean = raw.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  if (isSpReg(name)) return { lo: parseInt(clean || '0', 16) >>> 0, hi: 0 };
  const width = regWidthBytes(name) === 8 ? 16 : 8;
  const hex = clean.padStart(width, '0').slice(-width);
  if (width === 16) {
    return {
      hi: parseInt(hex.slice(0, 8) || '0', 16) >>> 0,
      lo: parseInt(hex.slice(8) || '0', 16) >>> 0,
    };
  }
  return { lo: parseInt(hex || '0', 16) >>> 0, hi: 0 };
}

function commitRegisterValue(name, raw) {
  const { lo, hi } = parseRegisterInput(name, raw);
  setRegParts(name, lo, hi);
  renderRegCards();
  renderRegPicker();
  syncPicker();
  if (name === S.reg) {
    const maxHex = Math.min(sizeN() * 2, regWidthBytes(name) * 2);
    $('valInput').value = isSpReg(name) ? fmtA(getReg(name)) : regHex(name).slice(-maxHex);
    refreshPreview();
    refreshBreakdown();
  }
  renderStackView();
  lg('sys', t('log.sys.reg_set', name, isSpReg(name) ? fmtA(getReg(name)) : regHex(name)));
}

// Make a register value element editable on click
function makeRegisterEditable(el, name) {
  if (el.dataset.editing) return;
  el.dataset.editing = '1';
  const isSp = isSpReg(name);
  const cur = isSp ? fmtA(getReg(name)) : regHex(name);
  const inp = document.createElement('input');
  inp.className = 'rc-edit-input';
  inp.type = 'text';
  inp.maxLength = isSp ? 4 : regWidthBytes(name) * 2;
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
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    else { // allow only hex chars
      if (e.key.length === 1 && !/[0-9a-fA-F]/.test(e.key) && !e.ctrlKey && !e.metaKey) e.preventDefault();
    }
  });
  inp.addEventListener('blur', () => { if (el.dataset.editing) commit(); });
}

function renderRegCards() {
  const gp = gpRegs(), sp = spRegs(), ext = extRegs();

  // Update section badge
  const gpBadge = $('gpBadge');
  if (gpBadge) setSectionHeaderText(gpBadge, is64() ? 'REGISTRADORES DE USO GERAL (64-bit)' : 'REGISTRADORES DE USO GERAL');

  // Main GP reg cards
  const g = $('regCards'); g.innerHTML = '';
  g.style.gridTemplateColumns = gp.length > 1 ? 'repeat(2, minmax(0, 1fr))' : `repeat(${gp.length}, 1fr)`;
  for (const name of gp) {
    const d = document.createElement('div');
    d.className = 'reg-card';
    d.id = 'rc-' + name;
    const valueHex = regHex(name);
    if (is64()) {
      d.innerHTML = `<div class="rc-name">${name}</div>
        <div class="rc-value rc-val64 rc-value-editable" id="rcv-${name}" title="${t('ui.reg.edit.title')}"><span class="rc-hi">${valueHex.slice(0, 8)}</span><span class="rc-lo">${valueHex.slice(8)}</span></div>
        <div class="rc-subregs" id="rcs-${name}">${renderRegisterEncapsulation(name)}</div>
        <div class="rc-bytes" id="rcb-${name}">${renderByteStrip(name)}</div>`;
    } else {
      d.innerHTML = `<div class="rc-name">${name}</div>
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
  const eg = $('extCards'); if (eg) {
    eg.innerHTML = '';
    eg.style.gridTemplateColumns = ext.length ? 'repeat(4, minmax(0, 1fr))' : '';
    for (const name of ext) {
      const d = document.createElement('div');
      d.className = 'reg-card rc-ext';
      d.id = 'rc-' + name;
      const valueHex = regHex(name);
      d.innerHTML = `<div class="rc-name">${name}</div>
        <div class="rc-value rc-val64 rc-value-editable" id="rcv-${name}" title="${t('ui.reg.edit.title')}"><span class="rc-hi">${valueHex.slice(0, 8)}</span><span class="rc-lo">${valueHex.slice(8)}</span></div>
        <div class="rc-bytes" id="rcb-${name}">${renderByteStrip(name)}</div>`;
      d.querySelector('.rc-value').addEventListener('click', e => {
        e.stopPropagation();
        makeRegisterEditable(d.querySelector('.rc-value'), name);
      });
      eg.appendChild(d);
    }
    eg.style.display = ext.length ? '' : 'none';
    const badge = $('extBadge'); if (badge) badge.style.display = ext.length ? '' : 'none';
  }

  // Stack pointer cards
  const sg = $('spCards'); if (!sg) return;
  sg.innerHTML = '';
  for (const name of sp) {
    const d = document.createElement('div');
    const role = stackRoleClass(name);
    const roleLabel = isStackTopReg(name) ? 'TOPO' : 'BASE';
    d.className = 'reg-card rc-sp rc-sp-' + role + (name === S.reg ? ' rc-selected' : '');
    d.id = 'rc-' + name;
    d.innerHTML = `<div class="rc-sp-meta">
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
  syncRegChangedClasses();
  scheduleCenterPaneLayout();
}

function registerMapWidthBytes(name) {
  return is64() && (name === 'RSP' || name === 'RBP') ? 8 : regWidthBytes(name);
}

function registerEncapsulationRows(name) {
  const classic = {
    EAX: { word: 'AX', high: 'AH', low: 'AL', size: 4 },
    EBX: { word: 'BX', high: 'BH', low: 'BL', size: 4 },
    ECX: { word: 'CX', high: 'CH', low: 'CL', size: 4 },
    EDX: { word: 'DX', high: 'DH', low: 'DL', size: 4 },
    ESI: { word: 'SI', size: 4 },
    EDI: { word: 'DI', size: 4 },
    ESP: { word: 'SP', size: 4 },
    EBP: { word: 'BP', size: 4 },
    RAX: { dword: 'EAX', word: 'AX', high: 'AH', low: 'AL', size: 8 },
    RBX: { dword: 'EBX', word: 'BX', high: 'BH', low: 'BL', size: 8 },
    RCX: { dword: 'ECX', word: 'CX', high: 'CH', low: 'CL', size: 8 },
    RDX: { dword: 'EDX', word: 'DX', high: 'DH', low: 'DL', size: 8 },
  };
  const lowOnly = {
    RSI: { dword: 'ESI', word: 'SI', low: 'SIL', size: 8 },
    RDI: { dword: 'EDI', word: 'DI', low: 'DIL', size: 8 },
    RSP: { dword: 'ESP', word: 'SP', low: 'SPL', size: 8 },
    RBP: { dword: 'EBP', word: 'BP', low: 'BPL', size: 8 },
    R8: { dword: 'R8D', word: 'R8W', low: 'R8B', size: 8 },
    R9: { dword: 'R9D', word: 'R9W', low: 'R9B', size: 8 },
    R10: { dword: 'R10D', word: 'R10W', low: 'R10B', size: 8 },
    R11: { dword: 'R11D', word: 'R11W', low: 'R11B', size: 8 },
    R12: { dword: 'R12D', word: 'R12W', low: 'R12B', size: 8 },
    R13: { dword: 'R13D', word: 'R13W', low: 'R13B', size: 8 },
    R14: { dword: 'R14D', word: 'R14W', low: 'R14B', size: 8 },
    R15: { dword: 'R15D', word: 'R15W', low: 'R15B', size: 8 },
  };

  if (classic[name]) {
    const rows = [];
    if (classic[name].dword) rows.push({ label: classic[name].dword, bits: 32, start: 0, count: 4, tone: 'dword' });
    rows.push({ label: classic[name].word, bits: 16, start: 0, count: 2, tone: 'word' });
    if (classic[name].high && classic[name].low) {
      rows.push({ label: classic[name].high, bits: 8, start: 1, count: 1, tone: 'high' });
      rows.push({ label: classic[name].low, bits: 8, start: 0, count: 1, tone: 'low' });
    } else if (classic[name].low) {
      rows.push({ label: classic[name].low, bits: 8, start: 0, count: 1, tone: 'low' });
    }
    return rows;
  }

  if (lowOnly[name]) {
    return [
      { label: lowOnly[name].dword, bits: 32, start: 0, count: 4, tone: 'dword' },
      { label: lowOnly[name].word, bits: 16, start: 0, count: 2, tone: 'word' },
      { label: lowOnly[name].low, bits: 8, start: 0, count: 1, tone: 'low' },
    ];
  }

  return [];
}

function renderRegisterEncapsulation(name) {
  const rows = registerEncapsulationRows(name);
  if (!rows.length) return '';
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
    return `<div class="rc-subrow rc-subrow-${row.tone || 'neutral'}" title="${row.label} = 0x${rowValue || '00'}">
      <div class="rc-submeta">
        <span class="rc-subname">${row.label}</span>
      </div>
      <div class="rc-subgrid rc-subgrid-${totalBytes}">
        ${cells}
      </div>
    </div>`;
  }).join('');
}

function renderByteStrip(name, opts = {}) {
  const {
    activePos = -1,
    doneSet = new Set(),
    compact = false,
    transferCount = transferWidth(name),
    byteCount = regWidthBytes(name),
    memoryOrder = false,
  } = opts;
  const littleBytes = regBytes(name, byteCount);
  const displaySigIdxs = memoryOrder
    ? (S.endian === 'little'
      ? Array.from({ length: byteCount }, (_, i) => i)
      : Array.from({ length: byteCount }, (_, i) => byteCount - 1 - i))
    : Array.from({ length: byteCount }, (_, i) => byteCount - 1 - i);
  const byteCls = compact ? 'rp-byte' : 'rc-byte';
  const labelCls = compact ? 'rp-byte-lbl' : 'rc-blbl';
  const basePos = memoryOrder ? 0 : displayPosForTransferByte(name, 0, transferCount);
  const lastPos = memoryOrder ? Math.max(transferCount - 1, 0) : displayPosForTransferByte(name, Math.max(transferCount - 1, 0), transferCount);
  const transferStart = memoryOrder ? 0 : displayTransferStart(name, transferCount);

  function byteMemoryOffset(idx) {
    if (memoryOrder) return idx < Math.min(transferCount, byteCount) ? idx : null;
    if (idx < transferStart) return null;
    return S.endian === 'little' ? (byteCount - 1 - idx) : (idx - transferStart);
  }

  function byteHoverTitle(sigIdx, idx) {
    const role = sigIdx === byteCount - 1 ? 'MSB' : sigIdx === 0 ? 'LSB' : `byte ${sigIdx}`;
    const offset = byteMemoryOffset(idx);
    const memInfo = offset === null
      ? 'fora da largura/operacao atual'
      : `ordem de memoria: A+${offset}`;
    return `${name} · ${role} · ${memInfo}`;
  }

  return displaySigIdxs.map((sigIdx, idx) => {
    const byte = hex8(littleBytes[sigIdx] || 0);
    let cls = byteCls;
    if (idx === activePos) cls += ' byte-arriving';
    else if (doneSet.has(idx)) cls += ' byte-done';
    if (idx === basePos && idx >= transferStart) cls += ' rc-byte-base';
    if (transferCount > 1 && idx === lastPos && idx >= transferStart) cls += ' rc-byte-last';

    const labels = [];
    if (sigIdx === byteCount - 1) labels.push(`<span class="${labelCls} rc-blbl-msb">MSB</span>`);
    if (sigIdx === 0) labels.push(`<span class="${labelCls} rc-blbl-lsb">LSB</span>`);
    if (idx === basePos && idx >= transferStart) labels.push(`<span class="${labelCls} rc-blbl-mem">A+0</span>`);
    if (transferCount > 1 && idx === lastPos && idx >= transferStart) {
      labels.push(`<span class="${labelCls} rc-blbl-mem">A+${transferCount - 1}</span>`);
    }
    return `<span class="${cls}" title="${byteHoverTitle(sigIdx, idx)}">${byte}${labels.join('')}</span>`;
  }).join('');
}

function registerByteAnchor(name, byteIdx) {
  const strip = $('rpb-' + name);
  if (!strip || !Number.isInteger(byteIdx)) return null;
  // O picker usa memoryOrder: bytes A+0, A+1, ... portanto byteIdx == posição direta
  const bytes = strip.querySelectorAll('.rp-byte');
  return bytes[byteIdx] || null;
}

function updateRegCard(name) {
  const v = $('rcv-' + name), b = $('rcb-' + name), s = $('rcs-' + name);
  if (!v) return;
  if (isSpReg(name)) {
    v.textContent = '0x' + fmtA(getReg(name));
    if (s) s.innerHTML = renderRegisterEncapsulation(name);
    syncRegChangedClasses();
    return;
  }
  const valueHex = regHex(name);
  if (is64()) {
    const hiSpan = v.querySelector('.rc-hi');
    const loSpan = v.querySelector('.rc-lo');
    if (hiSpan && loSpan) {
      hiSpan.textContent = valueHex.slice(0, 8);
      loSpan.textContent = valueHex.slice(8);
    } else v.textContent = valueHex;
  } else {
    v.textContent = valueHex;
  }
  if (s) s.innerHTML = renderRegisterEncapsulation(name);
  if (b) b.innerHTML = renderByteStrip(name);
  syncRegChangedClasses();
}

function pulseRegister(name) {
  ['rc-' + name, 'r' + name].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.classList.remove('reg-animating');
    void el.offsetWidth;
    el.classList.add('reg-animating');
    const prevTimer = regPulseTimers.get(id);
    if (prevTimer) clearTimeout(prevTimer);
    const timer = setTimeout(() => {
      el.classList.remove('reg-animating');
      regPulseTimers.delete(id);
    }, 520);
    regPulseTimers.set(id, timer);
  });
}

// Live update during LOAD
function liveUpdate(name, partial, byteIdx, transferCount = transferWidth(name)) {
  const v = $('rcv-' + name), s = $('rcs-' + name);
  const valueHex = regHex(name);
  if (v) {
    if (is64()) {
      const hi = v.querySelector('.rc-hi');
      const lo = v.querySelector('.rc-lo');
      if (hi && lo) {
        hi.textContent = valueHex.slice(0, 8);
        lo.textContent = valueHex.slice(8);
      } else v.textContent = valueHex;
    } else v.textContent = valueHex;
  }
  if (s) s.innerHTML = renderRegisterEncapsulation(name);

  // display-order para o reg card
  const hexPos = displayPosForTransferByte(name, byteIdx, transferCount);
  const done = new Set();
  for (let i = 0; i < byteIdx; i++) done.add(displayPosForTransferByte(name, i, transferCount));

  // Update reg card bytes (visualização, display order)
  const b = $('rcb-' + name);
  if (b) b.innerHTML = renderByteStrip(name, { activePos: hexPos, doneSet: done, transferCount });

  // memory-order para o picker: byteIdx == posição direta em A+0, A+1, ...
  const pickerDone = new Set();
  for (let i = 0; i < byteIdx; i++) pickerDone.add(i);

  // Update picker bytes (âncora de animação, memory order)
  const pb = $('rpb-' + name);
  if (pb) pb.innerHTML = renderByteStrip(name, { compact: true, memoryOrder: true,
    activePos: byteIdx, doneSet: pickerDone,
    byteCount: regWidthBytes(name), transferCount });
  updatePickerVal(name);
}

// Highlight byte being SENT during STORE
// hexPos  = display-order index (para o reg card)
// byteIdx = memory-order index A+i (para o picker)
function storeHighlight(name, hexPos, transferCount = transferWidth(name), byteIdx = hexPos) {
  // Update reg card bytes (visualização, display order)
  const b = $('rcb-' + name);
  if (b) b.innerHTML = renderByteStrip(name, { activePos: hexPos, transferCount });

  // Update picker bytes (âncora de animação, memory order)
  const pb = $('rpb-' + name);
  if (pb) pb.innerHTML = renderByteStrip(name, { compact: true, memoryOrder: true,
    activePos: byteIdx, byteCount: regWidthBytes(name), transferCount });
  pulseRegister(name);
}

function setLoading(name, on) {
  $('rc-' + name)?.classList.toggle('rc-loading', on);
  $('r' + name)?.classList.toggle('rc-loading', on);
  if (!on) updateRegCard(name);
}

// ─────────────────────────────────────────────────────────
// SIDEBAR PICKER
// ─────────────────────────────────────────────────────────
function syncPicker() {
  [...gpRegs(), ...extRegs(), ...spRegs()].forEach(name => {
    updatePickerVal(name);
    updatePickerBytes(name);
  });
}
function updatePickerVal(n) {
  const e = $('rpv-' + n); if (!e) return;
  e.textContent = isSpReg(n) ? '0x' + fmtA(getReg(n)) : regHex(n);
}
function updatePickerBytes(n) {
  const e = $('rpb-' + n); if (!e || isSpReg(n)) return;
  e.innerHTML = renderByteStrip(n, {
    compact: true,
    memoryOrder: true,
    byteCount: regWidthBytes(n),
    transferCount: regWidthBytes(n),
  });
}

// ─────────────────────────────────────────────────────────
// VALUE PREVIEW
// ─────────────────────────────────────────────────────────
function refreshPreview() {
  const c = $('valPreview'); if (!c) return;
  const n = transferWidth(S.reg), bs = regBytes(S.reg, n);
  const ord = orderedBytes(bs, S.endian);
  c.innerHTML = ord.map((b, i) => {
    const f = i === 0, l = i === n - 1;
    let cls = 'vp-byte';
    if (f && S.endian === 'little') cls += ' lsb';
    if (f && S.endian === 'big') cls += ' msb';
    if (l && S.endian === 'little' && n > 1) cls += ' msb';
    if (l && S.endian === 'big' && n > 1) cls += ' lsb';
    const lbl = (f && S.endian === 'little') ? ' LSB' : (f && S.endian === 'big') ? ' MSB' :
      (l && S.endian === 'little' && n > 1) ? ' MSB' : (l && S.endian === 'big' && n > 1) ? ' LSB' : '';
    return `<span class="${cls}">${hex8(b)}${lbl}</span>`;
  }).join('');
}

// ─────────────────────────────────────────────────────────
// BYTE BREAKDOWN
// ─────────────────────────────────────────────────────────
function refreshBreakdown() {
  const c = $('byteBreakdown'); if (!c) return;
  const n = transferWidth(S.reg), addr = parseInt($('addrInput').value || '0', 16) & 0x3F;
  const bs = regBytes(S.reg, n);
  const ord = orderedBytes(bs, S.endian);
  c.innerHTML = ord.map((b, i) => {
    const ma = addr + i, f = i === 0, l = i === n - 1;
    let cls = '', role = '—';
    if (f && S.endian === 'little') { cls = 'bb-lsb'; role = 'LSB'; }
    if (f && S.endian === 'big') { cls = 'bb-msb'; role = 'MSB'; }
    if (l && S.endian === 'little' && n > 1) { cls = 'bb-msb'; role = 'MSB'; }
    if (l && S.endian === 'big' && n > 1) { cls = 'bb-lsb'; role = 'LSB'; }
    return `<div class="bb-row">
      <span class="bb-addr">0x${fmtA(ma)}</span>
      <span class="bb-hex ${cls}">${hex8(b)}</span>
      <span class="bb-bin">${b.toString(2).padStart(8, '0')}</span>
      <span class="bb-label">${role}</span></div>`;
  }).join('');
}

// ─────────────────────────────────────────────────────────
// MEMORY GRID
// ─────────────────────────────────────────────────────────
function renderMemGrid() {
  const g = $('memGrid'), a = $('memAddrBar');
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
  for (const bpAddr of S.breakpoints) {
    const instr = decodeAt(bpAddr & 0x3F);
    const sz = Math.max(instr.size || 1, 1);
    for (let i = 0; i < sz; i++) bpBytes.add(bpAddr + i);
  }
  g.innerHTML = '';
  a.innerHTML = '';
  const tag = $('addrDirTag');
  if (tag) tag.textContent = `0x${fmtMemA(topAddr)}..0x${fmtMemA(bottomAddr)} · total ${formatStackSize(totalBytes)}`;
  a.style.setProperty('--mem-row-count', String(rowCount));
  a.style.setProperty('--mem-cell-h', `${cellPx}px`);
  a.style.setProperty('--mem-cell-w', `${cellPx}px`);
  a.style.minHeight = `${addrHeightPx}px`;
  g.style.setProperty('--mem-row-count', String(rowCount));
  g.style.setProperty('--mem-cell-h', `${cellPx}px`);
  g.style.setProperty('--mem-cell-w', `${cellPx}px`);
  g.style.minHeight = `${gridHeightPx}px`;

  for (let r = 0; r < rowCount; r++) {
    const rowBase = base + (r * 8);
    const l = document.createElement('div');
    l.className = 'addr-lbl';
    l.textContent = '0x' + fmtMemA(rowBase);
    addrFrag.appendChild(l);
    for (let c = 0; c < 8; c++) {
      const addr = rowBase + c;
      if (addr >= totalBytes) break;
      const cell = document.createElement('div');
      cell.className = 'mem-cell'; cell.dataset.addr = addr;
      cell.title = t('mem.cell.title', fmtMemA(addr));
      cell.textContent = hex8(memByteAt(addr));
      const st = memStateAt(addr);
      if (st) cell.classList.add(st);
      if (addr === S.memSelectedAddr) cell.classList.add('mc-selected');
      if (addr < 64 && bpBytes.has(addr)) cell.classList.add('mc-bp');
      memCellRefs[addr] = cell;
      gridFrag.appendChild(cell);
    }
  }


  a.appendChild(addrFrag);
  g.appendChild(gridFrag);

  // Painel de breakpoints — sempre visível, lista todos, destaca o atingido
  const bpStatus = $('memBpStatus');
  if (bpStatus) {
    if (S.breakpoints.size > 0) {
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
  if (!mem || !asm) return;
  // Remove height override so mem can express its natural size
  asm.style.height = '';
  asm.style.alignSelf = 'start';
  mem.style.alignSelf = 'start';
  // After the browser reflows mem at its natural height, pin asm to match
  requestAnimationFrame(() => {
    const h = mem.getBoundingClientRect().height;
    if (h > 0) {
      asm.style.height = h + 'px';
      asm.style.alignSelf = 'start';
    }
  });
}

function editMemCell(addr) {
  const cell = memEl(addr);
  if (!cell || cell.classList.contains('is-editing')) return;
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
    cell.className = 'mem-cell' + (prevState ? ' ' + prevState : '');
    cell.textContent = prevVal;
  }

  function commit() {
    const raw = inp.value.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
    const val = parseInt(raw || '0', 16) & 0xFF;
    writeMem(addr, val, 'mc-written');
    if (addr < 64) renderAsmTrace();
    renderStackView();
    lg('sys', t('log.sys.mem_edit', fmtMemA(addr), hex8(val)));
  }

  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); restore(); }
    else if (e.key.length === 1 && !/[0-9a-fA-F]/.test(e.key) && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
    }
  });
  inp.addEventListener('blur', () => {
    if (cell.classList.contains('is-editing')) commit();
  });
}

function writeAssembledBytes(addr, src, oldSizeHint, bytesHint) {
  const baseAddr = addr & 0x3F;
  const bytes = bytesHint || assemble(src, baseAddr);
  if (!bytes) return null;

  const oldSize = Math.max(oldSizeHint || decodeAt(baseAddr).size || 1, 1);
  for (let i = 0; i < bytes.length; i++) writeMem((baseAddr + i) & 0x3F, bytes[i], 'mc-written');
  if (bytes.length < oldSize) {
    for (let i = bytes.length; i < oldSize; i++) writeMem((baseAddr + i) & 0x3F, 0x90, 'mc-written');
  }

  renderAsmTrace();
  renderStackView();
  syncPicker();
  renderRegCards();
  refreshPreview();
  refreshBreakdown();

  return { bytes, oldSize, baseAddr };
}

function editAsmLine(line) {
  if (!line || line.dataset.editing) return;
  const asmEl = line.querySelector('.asm-line-asm');
  if (!asmEl) return;

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
    if (!src) { cancel(); return; }
    const validation = updateInlineValidation();
    if (!validation.ok) {
      setStatus(t('status.asm_invalid', fmtA(addr), validation.error), 'lbl-error');
      lg('error', t('log.error.asm_invalid_listing', fmtA(addr), validation.error));
      requestAnimationFrame(() => { input.focus(); input.select(); });
      return;
    }
    const result = writeAssembledBytes(addr, src, oldSize, validation.bytes);

    delete line.dataset.editing;
    line.classList.remove('asm-line-editing');
    setPC(addr);
    lg('sys', t('log.sys.asm_edit', fmtA(addr), src));
    if (result.bytes.length < result.oldSize) {
      lg('sys', t('log.sys.nop_fill', fmtA(addr), fmtA((addr + result.oldSize - 1) & 0x3F)));
    } else if (result.bytes.length > result.oldSize) {
      lg('error', t('log.error.asm_grew', fmtA(addr), result.oldSize, result.bytes.length));
    }
  }

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
  input.addEventListener('input', updateInlineValidation);
  input.addEventListener('blur', () => {
    if (line.dataset.editing) commit();
  });
  updateInlineValidation();
}

// ─────────────────────────────────────────────────────────
// SETTERS (called from HTML + App object)
// ─────────────────────────────────────────────────────────
function setEndian(e) {
  S.endian = e;
  $('eLittle').classList.toggle('active', e === 'little');
  $('eBig').classList.toggle('active', e === 'big');
  $('endianHint').innerHTML = e === 'little'
    ? '<span class="eh-arrow">0x0000</span> ← byte menos significativo (LSB)'
    : '<span class="eh-arrow">0x0000</span> ← byte mais significativo (MSB)';
  renderRegCards();
  renderRegPicker();
  renderStackView();
  syncPicker();
  refreshPreview(); refreshBreakdown();
  lg('sys', t('log.sys.format', e.toUpperCase()));
}

function setSize(s) {
  S.size = s;
  ['byte', 'word', 'dword', 'qword'].forEach(x => {
    const id = 's' + x[0].toUpperCase() + x.slice(1);
    $(id)?.classList.toggle('active', x === s);
  });
  // QWORD only available in x64 mode; clamp to dword otherwise
  if (s === 'qword' && !is64()) { S.size = 'dword'; doSetSize('dword'); return; }
  renderRegCards();
  renderRegPicker();
  syncPicker();
  refreshPreview(); refreshBreakdown();
  lg('sys', t('log.sys.size', s.toUpperCase(), sizeN() * 8));
}

function selectReg(name) {
  S.reg = name;
  [...gpRegs(), ...extRegs(), ...spRegs()].forEach(r => {
    $('r' + r)?.classList.toggle('active', r === name);
  });
  const maxHex = Math.min(sizeN() * 2, regWidthBytes(name) * 2);
  const v = isSpReg(name) ? fmtA(getReg(name)) : regHex(name).slice(-maxHex);
  $('valInput').value = v;
  refreshPreview(); refreshBreakdown();
  lg('sys', t('log.sys.reg_selected', name));
}

function renderRegPicker() {
  const picker = $('regPicker'); if (!picker) return;
  const gp = gpRegs(), sp = spRegs(), ext = extRegs();
  const all = [...gp, ...ext, ...sp];
  picker.innerHTML = '';
  for (const name of all) {
    const isSp = isSpReg(name);
    const role = isSp ? ` rpbtn-${stackRoleClass(name)}` : '';
    const btn = document.createElement('button');
    btn.className = 'rpbtn' + (isSp ? ' rpbtn-sp' : '') + role + (name === S.reg ? ' active' : '');
    btn.id = 'r' + name;
    btn.onclick = (e) => { if (!e.target.closest('.rc-edit-input')) App.selectReg(name); };
    const val = isSp ? '0x' + fmtA(getReg(name)) : regHex(name);
    btn.innerHTML = `<span class="rp-main">
        <span class="rp-name">${name}</span>
        <span class="rp-val rp-val-editable" id="rpv-${name}" title="${t('ui.reg.picker.title')}">${val}</span>
      </span>
      ${isSp ? '' : `<span class="rp-bytes" id="rpb-${name}">${renderByteStrip(name, {
      compact: true,
      memoryOrder: true,
      byteCount: regWidthBytes(name),
      transferCount: regWidthBytes(name),
    })}</span>`}`;
    btn.querySelector('.rp-val').addEventListener('click', e => {
      e.stopPropagation();
      makeRegisterEditable(btn.querySelector('.rp-val'), name);
    });
    picker.appendChild(btn);
  }
  syncRegChangedClasses();
}

function setArch(arch) {
  S.arch = arch;
  $('archIA32')?.classList.toggle('active', arch === 'ia32');
  $('archX64')?.classList.toggle('active', arch === 'x64');

  // Add QWORD button visibility
  const sQ = $('sQword'); if (sQ) sQ.style.display = arch === 'x64' ? '' : 'none';

  // Default operand size follows the selected architecture in the UI
  if (arch === 'x64') S.size = 'qword';
  else if (S.size === 'qword') S.size = 'dword';

  // Granularidade padrão por arquitetura: DWord (IA-32) / QWord (x64)
  S.stackGranularity = arch === 'x64' ? 'qword' : 'dword';

  resetStatsState();
  resetCoreRegisters();
  S.reg = arch === 'x64' ? 'RAX' : 'EAX';
  S.halt = false;
  S.progRunning = false;
  loadDefaultProgram(false, arch);

  renderRegCards();
  renderRegPicker();
  renderMemGrid();
  setPC(demoProgramForArch(arch).entry);
  renderStackView();
  doSetSize(S.size);
  syncPicker(); refreshStats(); refreshPreview(); refreshBreakdown();
  updatePickerVal(S.reg);
  doSelectReg(S.reg);
  $('clockDisplay').textContent = '—';
  $('opsDisplay').textContent = '0';
  setCpuState('idle');
  const chip = $('archDisplay'); if (chip) chip.textContent = arch === 'x64' ? 'x86-64' : 'IA-32';
  const stackLbl = $('stackArchLbl'); if (stackLbl) stackLbl.textContent = `STACK  ${arch === 'x64' ? 'RSP/RBP' : 'ESP/EBP'}`;
  const asmPh = $('asmInput'); if (asmPh) asmPh.placeholder = t(arch === 'x64' ? 'asm.hint.placeholder.x64' : 'asm.hint.placeholder.ia32');
  refreshAsmValidation();
  setStatus(t('status.demo_arch', arch === 'x64' ? 'x86-64' : 'IA-32'), 'lbl-done');
  lg('sys', t('log.sys.arch', arch === 'x64' ? 'x86-64' : 'IA-32'));
  lg('sys', demoProgramForArch(arch).listing.join(' | '));
}

// ─────────────────────────────────────────────────────────
// STORE
// ─────────────────────────────────────────────────────────
async function doStore() {
  if (S.busy) return;
  clearFaultLatch();
  S.busy = true; setBusy(true);
  const reg = S.reg, addr = readAddr(), n = transferWidth(reg), t0 = performance.now();
  const ord = regBytes(reg, n);
  const asm = asmForOp('store-start', { reg, addr, val: regHex(reg) });
  if (!mapAccessFits(addr, n)) {
    reportWidthOverflow(`STORE ${reg}`, addr, n, asm);
    S.busy = false; setBusy(false);
    return;
  }
  setPC(addr, { traceAutoScroll: false });
  lg('store', t('log.store.start', reg, regHex(reg), fmtA(addr), S.size.toUpperCase(), S.endian.toUpperCase()), asm);
  setStatus(t('status.store_start', n, fmtA(addr)), 'lbl-store');

  for (let i = 0; i < n; i++) {
    const ma = addr + i;
    if (ma >= 64) { lg('error', t('log.error.addr_range', fmtA(ma))); break; }
    const hexPos = displayPosForTransferByte(reg, i, n);
    storeHighlight(reg, hexPos, n, i);
    setPC(ma, { traceAutoScroll: false });
    setMemSt(ma, 'mc-active');
    await animPacket('store', ord[i], ma, { regName: reg, byteIdx: i, transferCount: n });
    writeMem(ma, ord[i], 'mc-active');
    lg('store', t('log.store.byte', fmtA(ma), hex8(ord[i]), i + 1, n),
      asmForOp('store-byte', { byteAddr: ma, byteVal: ord[i], byteIdx: i, byteCount: n }));
    await sleep(S.speed * 0.18);
    S.memState[ma] = 'mc-written'; setMemSt(ma, 'mc-written');
  }
  updateRegCard(reg);
  const ms = Math.round(performance.now() - t0);
  recOp('store', ms);
  setPC((addr + n) & 0x3F, { traceAutoScroll: false });
  setStatus(t('status.store_done', ms), 'lbl-done');
  lg('store', t('log.store.done', ms));
  renderStackView();
  refreshStats(); refreshBreakdown();
  S.busy = false; setBusy(false);
}

// ─────────────────────────────────────────────────────────
// LOAD
// ─────────────────────────────────────────────────────────
async function doLoad() {
  if (S.busy) return;
  clearFaultLatch();
  S.busy = true; setBusy(true);
  const reg = S.reg, addr = readAddr(), n = transferWidth(reg), t0 = performance.now();
  const asm = asmForOp('load-start', { reg, addr });
  if (!mapAccessFits(addr, n)) {
    reportWidthOverflow(`LOAD ${reg}`, addr, n, asm);
    S.busy = false; setBusy(false);
    return;
  }
  setPC(addr, { traceAutoScroll: false });
  lg('load', t('log.load.start', fmtA(addr), reg, S.size.toUpperCase(), S.endian.toUpperCase()), asm);
  setStatus(t('status.load_start', n, fmtA(addr)), 'lbl-load');

  const raw = [];
  for (let i = 0; i < n; i++) { const ma = addr + i; raw.push(ma < 64 ? S.mem[ma] : 0); }

  // Zero register + show loading state
  setRegParts(reg, 0, 0); setLoading(reg, true);
  const partialLittle = new Array(n).fill(0);

  for (let i = 0; i < n; i++) {
    const ma = addr + i; if (ma >= 64) break;
    setPC(ma, { traceAutoScroll: false }); setMemSt(ma, 'mc-active');
    await animPacket('load', raw[i], ma, { regName: reg, byteIdx: i, transferCount: n });

    partialLittle[i] = raw[i] & 0xFF;
    setRegFromBytes(reg, partialLittle);

    // Live register update — value builds up byte by byte
    liveUpdate(reg, 0, i, n);

    lg('load', t('log.load.byte', reg, i, fmtA(ma), hex8(raw[i]), regHex(reg)),
      asmForOp('load-byte', { byteAddr: ma, byteIdx: i, partial: regHex(reg) }));
    await sleep(S.speed * 0.18);
    S.memState[ma] = 'mc-written'; setMemSt(ma, 'mc-written');
  }

  setLoading(reg, false);
  updatePickerVal(reg);
  updatePickerBytes(reg);
  const finalHex = regHex(reg);
  $('valInput').value = finalHex.slice(-Math.min(sizeN() * 2, regWidthBytes(reg) * 2));
  const ms = Math.round(performance.now() - t0);
  recOp('load', ms);
  setPC((addr + n) & 0x3F, { traceAutoScroll: false });
  setStatus(t('status.load_done', reg, finalHex, ms), 'lbl-done');
  lg('load', t('log.load.done', reg, finalHex, ms));
  renderStackView();
  refreshStats(); refreshPreview(); refreshBreakdown();
  S.busy = false; setBusy(false);
}
// ─────────────────────────────────────────────────────────
// STACK VIEW
// ─────────────────────────────────────────────────────────
function distanceUp(from, to) {
  return Math.max(0, to - from);
}

function inActiveFrame(addr, sp, bp) {
  if (sp === bp) return false;
  const total = distanceUp(sp, bp);
  const dist = distanceUp(sp, addr);
  return dist > 0 && dist < total;
}

function frameAddressesDesc() {
  const sp = S.regs.ESP >>> 0;
  const bp = S.regs.EBP >>> 0;
  const ret = bp + ptrSize();

  if (sp === bp) {
    const out = [];
    const top = Math.min(S.stackSize - 1, sp + 3);
    const bottom = Math.max(0, sp - 4);
    for (let addr = top; addr >= bottom; addr--) out.push(addr);
    return out;
  }

  const start = Math.min(S.stackSize - 1, ret + 2);
  const end = Math.max(0, sp - 2);
  const out = [];
  let cur = start;
  while (out.length < 20 && cur >= end) {
    out.push(cur);
    if (cur === end) break;
    cur -= 1;
  }
  return out;
}

function stackRowMeta(addr) {
  const sp = S.regs.ESP >>> 0;
  const bp = S.regs.EBP >>> 0;
  const ret = bp + ptrSize();
  const tags = [];

  if (addr === sp) tags.push({ cls: 'sp', text: `${is64() ? 'RSP' : 'ESP'} topo` });
  if (addr === bp) tags.push({ cls: 'bp', text: `${is64() ? 'RBP' : 'EBP'} base` });
  if (sp !== bp && addr === ret) tags.push({ cls: 'ret', text: 'retorno' });
  if (addr === S.pc) tags.push({ cls: 'pc', text: 'PC' });
  if (inActiveFrame(addr, sp, bp)) tags.push({ cls: 'frame', text: 'frame ativo' });

  const priority = ['sp', 'bp', 'ret', 'pc', 'frame'];
  const primary = tags.find(tag => priority.includes(tag.cls))?.cls || 'default';
  return { primary, tags };
}

function stackGranBytes() {
  switch (S.stackGranularity) {
    case 'word': return 2;
    case 'dword': return 4;
    case 'qword': return 8;
    default: return 1;
  }
}

function stackGroupHex(baseAddr, n) {
  // Lê n bytes a partir de baseAddr em little-endian e retorna string hex
  let val = 0;
  for (let i = n - 1; i >= 0; i--) val = (val * 256) + (S.stackMem[baseAddr + i] || 0);
  return val.toString(16).padStart(n * 2, '0').toUpperCase();
}

function renderStackView() {
  const view = $('stackView');
  if (!view) return;

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
    : Array.from({ length: Math.min(64, S.stackSize) }, (_, i) => (S.stackSize - 1) - i);

  // Ao agrupar, filtrar para que apenas o endereço base de cada grupo apareça
  let list;
  if (gran === 1) {
    list = rawList;
  } else {
    const seen = new Set();
    list = [];
    for (const addr of rawList) {
      const base = addr - (addr % gran);
      if (!seen.has(base)) { seen.add(base); list.push(base); }
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
    ${renderStackTrace()}
    <div class="stack-list">${rows}</div>`;

  const stackLbl = $('stackArchLbl');
  if (stackLbl) stackLbl.textContent = `STACK  ${spName}/${bpName}`;
  syncStackSizeUI();
  syncStackCfgUI();
  scheduleCenterPaneLayout();
}

// Sincroniza os botões ativos do painel de configuração
function syncStackCfgUI() {
  // Modo: FULL / FRAME
  const modeFull = $('stackModeFull');
  const modeFrame = $('stackModeFrame');
  if (modeFull) modeFull.classList.toggle('stack-cfg-mode-btn-active', S.stackMode !== 'frame');
  if (modeFrame) modeFrame.classList.toggle('stack-cfg-mode-btn-active', S.stackMode === 'frame');

  // Granularidade
  const granIds = { byte: 'stackGranByte', word: 'stackGranWord', dword: 'stackGranDword', qword: 'stackGranQword' };
  for (const [val, id] of Object.entries(granIds)) {
    const el = $(id);
    if (el) el.classList.toggle('stack-cfg-gran-btn-active', S.stackGranularity === val);
  }
}

function toggleStackCfg() {
  const panel = $('stackCfg');
  const toggle = $('stackCfgToggle');
  if (!panel) return;
  const isOpen = panel.classList.toggle('stack-cfg-open');
  panel.setAttribute('aria-hidden', String(!isOpen));
  if (toggle) toggle.setAttribute('aria-expanded', String(isOpen));
}

function setStackMode(mode) {
  if (mode !== 'full' && mode !== 'frame') return;
  S.stackMode = mode;
  renderStackView();
}

// Mantém toggleStackMode para compatibilidade interna
function toggleStackMode() {
  S.stackMode = S.stackMode === 'frame' ? 'full' : 'frame';
  renderStackView();
}

function setStackGranularity(val) {
  const valid = ['byte', 'word', 'dword', 'qword'];
  if (!valid.includes(val)) return;
  S.stackGranularity = val;
  renderStackView();
}

const stackRowEl = addr => $('stackView')?.querySelector(`.stack-row[data-stack-addr="${addr}"]`);
const stackByteEl = addr => stackRowEl(addr)?.querySelector('.stack-row-byte') || null;

function activeRegisterAnchor(dir, opts = {}) {
  const regName = opts.regName || S.reg;
  const transferCount = opts.transferCount || transferWidth(regName);
  const exactByte = registerByteAnchor(regName, opts.byteIdx, transferCount);
  const bytes = $('rpb-' + regName);
  if (dir === 'store') {
    return exactByte || bytes?.querySelector('.rp-byte-arriving, .rp-byte-done') || $('rpv-' + regName) || $('r' + regName);
  }
  return exactByte || bytes?.querySelector('.rp-byte-arriving, .rp-byte-done') || $('rpv-' + regName) || $('r' + regName);
}

function setMemOpIndicator(addr, dir) {
  const cell = memEl(addr);
  if (!cell) return;
  cell.classList.remove('mc-op-store', 'mc-op-load');
  cell.classList.add(dir === 'load' ? 'mc-op-load' : 'mc-op-store');
}

function clearMemOpIndicator(addr) {
  const cell = memEl(addr);
  if (!cell) return;
  cell.classList.remove('mc-op-store', 'mc-op-load');
}

function setStackOpIndicator(addr, dir) {
  const cell = stackByteEl(addr);
  if (!cell) return;
  cell.classList.remove('stack-byte-op-store', 'stack-byte-op-load');
  cell.classList.add(dir === 'load' ? 'stack-byte-op-load' : 'stack-byte-op-store');
}

function clearStackOpIndicator(addr) {
  const cell = stackByteEl(addr);
  if (!cell) return;
  cell.classList.remove('stack-byte-op-store', 'stack-byte-op-load');
}

function animIndicator(surface, addr, dir, active) {
  if (surface === 'stack') {
    if (active) setStackOpIndicator(addr, dir);
    else clearStackOpIndicator(addr);
    return;
  }
  if (active) setMemOpIndicator(addr, dir);
  else clearMemOpIndicator(addr);
}

function animTargetAnchor(surface, addr) {
  if (surface === 'stack') return stackByteEl(addr) || stackRowEl(addr);
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
async function animPacket(dir, bv, targetIdx, opts = {}) {
  const stage = $('animStage'), svg = $('animSVG');
  const surface = opts.surface === 'stack' ? 'stack' : 'mem';
  const regAnchor = activeRegisterAnchor(dir, opts);
  const targetAnchor = animTargetAnchor(surface, targetIdx);
  if (!stage || !svg || !regAnchor || !targetAnchor) { await sleep(Math.max(S.speed * 0.4, 80)); return; }

  const sr = stage.getBoundingClientRect();
  const rr = regAnchor.getBoundingClientRect();
  const tr = targetAnchor.getBoundingClientRect();
  const sourceRect = dir === 'store' ? rr : tr;
  const destRect = dir === 'store' ? tr : rr;
  const start = rectEdgePoint(sourceRect, destRect, sr);
  const end = rectEdgePoint(destRect, sourceRect, sr);

  const col = dir === 'store' ? '#4ade80' : '#60a5fa';
  const mk = dir === 'store' ? 'url(#arrowG)' : 'url(#arrowB)';
  animIndicator(surface, targetIdx, dir, true);

  const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  [['x1', start.x], ['y1', start.y], ['x2', end.x], ['y2', end.y],
  ['stroke', col], ['stroke-width', '1.8'], ['stroke-dasharray', '5 4'],
  ['stroke-linecap', 'round'], ['opacity', '0.52'], ['marker-end', mk]].forEach(([k, v]) => ln.setAttribute(k, v));
  svg.appendChild(ln);

  const pkt = document.createElement('div');
  pkt.className = `anim-packet pkt-${dir}`;
  pkt.textContent = hex8(bv);
  pkt.style.cssText = `left:${start.x}px;top:${start.y}px;`;
  stage.appendChild(pkt);

  const dur = Math.max(S.speed * 0.58, 110), t0 = performance.now();
  await new Promise(res => {
    function step(now) {
      const t = Math.min((now - t0) / dur, 1), e = ease(t);
      pkt.style.left = (start.x + (end.x - start.x) * e) + 'px';
      pkt.style.top = (start.y + (end.y - start.y) * e) + 'px';
      t < 1 ? requestAnimationFrame(step) : (pkt.remove(), ln.remove(), animIndicator(surface, targetIdx, dir, false), res());
    }
    requestAnimationFrame(step);
  });
}


// ─────────────────────────────────────────────────────────
// SAVE / LOAD
// ─────────────────────────────────────────────────────────
function saveSim() {
  const data = {
    version: 10, state: {
      endian: S.endian, size: S.size, reg: S.reg, arch: S.arch, stackMode: S.stackMode, stackSize: S.stackSize, stackSizeInputUnit: S.stackSizeInputUnit, sidebarPanelWidth: S.sidebarPanelWidth, sidebarPanelManual: S.sidebarPanelManual, stackPanelWidth: S.stackPanelWidth, stackPanelManual: S.stackPanelManual, codeMemSplitWidth: S.codeMemSplitWidth, codeMemSplitManual: S.codeMemSplitManual, centerPaneHeights: { ...S.centerPaneHeights }, collapsedSections: { ...S.collapsedSections }, speed: S.speed,
      memViewBase: S.memViewBase,
      regs: { ...S.regs }, mem: Array.from(S.mem), memState: [...S.memState], stackMem: Array.from(S.stackMem || []), stackState: Array.from((S.stackState || new Map()).entries()),
      stats: { ...S.stats, loadTimes: [...S.stats.loadTimes], storeTimes: [...S.stats.storeTimes] }, pc: S.pc
    }
  };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = `memsim_${Date.now()}.json`; a.click();
  lg('sys', 'Simulação salva.');
}

function loadSim(e) {
  const file = e.target.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = ev => {
    try {
      const d = JSON.parse(ev.target.result).state;
      S.endian = d.endian; S.size = d.size; S.reg = d.reg;
      if (d.stackMode) S.stackMode = d.stackMode;
      if (Number.isFinite(d.stackSize)) S.stackSize = normalizeStackSizeBytes(d.stackSize);
      S.stackSizeInputUnit = normalizeStackSizeUnit(d.stackSizeInputUnit || preferredStackSizeUnit(S.stackSize));
      S.sidebarPanelManual = !!d.sidebarPanelManual;
      S.stackPanelManual = !!d.stackPanelManual;
      S.codeMemSplitManual = !!d.codeMemSplitManual;
      if (S.sidebarPanelManual && Number.isFinite(d.sidebarPanelWidth)) S.sidebarPanelWidth = clamp(d.sidebarPanelWidth, 220, 420);
      if (S.stackPanelManual && Number.isFinite(d.stackPanelWidth)) S.stackPanelWidth = clamp(d.stackPanelWidth, 220, 520);
      if (S.codeMemSplitManual && Number.isFinite(d.codeMemSplitWidth)) S.codeMemSplitWidth = d.codeMemSplitWidth;
      if (d.centerPaneHeights && typeof d.centerPaneHeights === 'object') {
        Object.keys(CENTER_PANE_CONFIG).forEach(key => {
          const height = parseInt(d.centerPaneHeights[key], 10);
          if (Number.isFinite(height)) S.centerPaneHeights[key] = height;
        });
      }
      if (d.collapsedSections && typeof d.collapsedSections === 'object') {
        S.collapsedSections = { ...d.collapsedSections };
      }
      if (Number.isFinite(d.speed)) S.speed = normalizeSpeed(d.speed);
      if (Number.isFinite(d.memViewBase)) S.memViewBase = 0;
      if (d.arch) S.arch = d.arch;
      Object.assign(S.regs, d.regs);
      S.mem = new Uint8Array(d.mem); S.memState = d.memState;
      ensureStackMem();
      if (Array.isArray(d.stackMem) && d.stackMem.length === S.stackSize) S.stackMem = new Uint8Array(d.stackMem);
      else S.stackMem.fill(0);
      S.stackState = Array.isArray(d.stackState) ? new Map(d.stackState) : new Map();
      syncLowMemoryToStack();
      Object.assign(S.stats, d.stats); S.pc = d.pc;
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
      renderRegCards(); renderRegPicker(); renderMemGrid(); setPC(S.pc);
      renderStackView();
      syncSpeedUI();
      syncStackSizeUI();
      syncPicker(); refreshStats(); refreshPreview(); refreshBreakdown();
      $('opsDisplay').textContent = S.stats.ops;
      $('clockDisplay').textContent = '—';
      lg('sys', 'Simulação carregada.');
    } catch (err) { lg('error', 'Falha: ' + err.message); }
  };
  r.readAsText(file); e.target.value = '';
}

// ─────────────────────────────────────────────────────────
// HELP
// ─────────────────────────────────────────────────────────
function showHelp(page, tabEl) {
  $('helpBody').innerHTML = t(`help.${page}`) || '';
  $$('.htab').forEach(tab => tab.classList.remove('active'));
  if (tabEl) tabEl.classList.add('active');
}
function closeHelp() { $('helpBg').classList.remove('open'); }


// Backward-compatible aliases (for HTML onclick and test harness)
const doSetArch = setArch;
const doSetEndian = setEndian;
const doSetSize = setSize;
const doSelectReg = selectReg;
