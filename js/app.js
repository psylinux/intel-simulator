/* ═══════════════════════════════════════════════════════
   MEM·SIM  —  Memory Endianness Simulator
   ═══════════════════════════════════════════════════════ */
'use strict';

// ─────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────
const S = {
  endian: 'little',
  size:   'dword',
  reg:    'EAX',
  speed:  600,
  busy:   false,
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
    ESP: 0x003C,   // stack pointer — topo da memória simulada
    EBP: 0x003C,   // base pointer
  },
  mem:      new Uint8Array(64),
  memState: new Array(64).fill(''),
  stats: {
    ops:0, totalTime:0, loads:0, stores:0,
    loadTimes:[], storeTimes:[], littleOps:0, bigOps:0,
  },
  pc:   0,
  halt: false,   // HLT foi executado
  progRunning: false,
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

// Current register name set based on arch
function gpRegs()  { return is64() ? ['RAX','RBX','RCX','RDX','RSI','RDI'] : ['EAX','EBX','ECX','EDX']; }
function extRegs() { return is64() ? ['R8','R9','R10','R11','R12','R13','R14','R15'] : []; }
function spRegs()  { return is64() ? ['RSP','RBP'] : ['ESP','EBP']; }

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
function setReg(name, val32) {
  val32 = val32>>>0;
  if(is64()) {
    const lo32Map = {RAX:'EAX',RBX:'EBX',RCX:'ECX',RDX:'EDX',RSI:'ESI',RDI:'EDI',RSP:'ESP',RBP:'EBP'};
    if(name==='RSP'){ S.regs.ESP=val32; return; }
    if(name==='RBP'){ S.regs.EBP=val32; return; }
    const lo = lo32Map[name];
    if(lo){ S.regs[lo]=val32; return; }
    if(name.match(/^R\d+$/)) { S.regs[name]=val32; return; }
  }
  S.regs[name]=val32;
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

// ─────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────
function init() {
  buildRegCards();
  buildRegPicker();
  buildMemGrid();
  syncPicker();
  refreshPreview();
  refreshBreakdown();
  refreshStats();
  // Set initial arch button state
  $('archIA32')?.classList.add('active');
  $('archX64') ?.classList.remove('active');
  // Hide QWORD button initially (IA-32 mode)
  $('sQword')?.setAttribute('style','display:none');

  $('speedSlider').addEventListener('input', e => {
    S.speed = +e.target.value;
    $('speedVal').textContent = S.speed+'ms';
  });

  // PC input — manual editing
  $('pcDisplay').addEventListener('input', e => {
    const raw = e.target.value.replace(/[^0-9a-fA-F]/g,'').toUpperCase();
    e.target.value = raw;
  });
  $('pcDisplay').addEventListener('change', e => {
    const addr = parseInt(e.target.value||'0',16)&0x3F;
    e.target.value = fmtA(addr);
    S.pc = addr;
    const ai=$('addrInput');
    if(ai) ai.value = fmtA(addr);
    clearSel();
    memEl(addr)?.classList.add('mc-selected');
    refreshBreakdown();
    lg('sys',`PC definido manualmente: 0x${fmtA(addr)}`);
  });
  $('pcDisplay').addEventListener('keydown', e => {
    if(e.key==='Enter') e.target.blur();
  });

  $('memGrid').addEventListener('click', e => {
    const c = e.target.closest('.mem-cell');
    if(!c) return;
    const idx = +c.dataset.idx;
    // Set both addrInput and PC
    S.pc = idx;
    const pd=$('pcDisplay'); if(pd && document.activeElement!==pd) pd.value=fmtA(idx);
    $('addrInput').value = fmtA(idx);
    clearSel();
    c.classList.add('mc-selected');
    refreshBreakdown();
  });

  $('btnHelp').onclick = () => { $('helpBg').classList.add('open'); showHelp('intro', $$('.htab')[0]); };
  $('btnSave').onclick = saveSim;
  $('btnLoad').onclick = () => $('fileInput').click();
  $('fileInput').onchange = loadSim;

  setStatus('Pronto — selecione uma operação','');
  lg('sys','Simulador iniciado. Registrador padrão: EAX');
}

// ─────────────────────────────────────────────────────────
// REGISTER CARDS
// ─────────────────────────────────────────────────────────
// Make a register value element editable on click
function makeEditable(el, name, isSp) {
  if(el.dataset.editing) return;
  el.dataset.editing = '1';
  const cur = isSp ? fmtA(getReg(name)) : hex32(getReg(name));
  const inp = document.createElement('input');
  inp.className = 'rc-edit-input';
  inp.type = 'text';
  inp.maxLength = isSp ? 4 : 8;
  inp.value = cur;
  inp.spellcheck = false;
  const prevHTML = el.innerHTML;
  el.innerHTML = '';
  el.appendChild(inp);
  inp.focus(); inp.select();

  function commit() {
    const raw = inp.value.replace(/[^0-9a-fA-F]/g,'').toUpperCase();
    const v = parseInt(raw||'0', 16)>>>0;
    setReg(name, v);
    delete el.dataset.editing;
    if(isSp) {
      el.textContent = '0x'+fmtA(getReg(name));
    } else {
      updateRegCard(name);
    }
    updatePickerVal(name);
    // Also sync valInput/preview if this is the selected reg
    if(name===S.reg) {
      const maxHex=Math.min(sizeN()*2,8);
      $('valInput').value = isSp ? fmtA(getReg(name)) : hex32(getReg(name)).slice(8-maxHex);
      refreshPreview(); refreshBreakdown();
    }
    lg('sys', `${name} ← 0x${hex32(v)}`);
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
  if(gpBadge) gpBadge.textContent = is64() ? 'REGISTRADORES DE USO GERAL (64-bit)' : 'REGISTRADORES DE USO GERAL';

  // Main GP reg cards
  const g=$('regCards'); g.innerHTML='';
  g.style.gridTemplateColumns = `repeat(${gp.length}, 1fr)`;
  for(const name of gp) {
    const d=document.createElement('div');
    const sel = name===S.reg;
    d.className='reg-card'+(sel?' rc-selected':'');
    d.id='rc-'+name;
    d.onclick=(e)=>{ if(!e.target.closest('.rc-edit-input')) App.selectReg(name); };
    const val = getReg(name);
    if(is64()) {
      d.innerHTML=`<div class="rc-name">${name}</div>
        <div class="rc-value rc-val64 rc-value-editable" id="rcv-${name}" title="Clique para editar"><span class="rc-hi">00000000</span>${hex32(val)}</div>
        <div class="rc-bytes" id="rcb-${name}">${byteSpans(val)}</div>`;
    } else {
      d.innerHTML=`<div class="rc-name">${name}</div>
        <div class="rc-value rc-value-editable" id="rcv-${name}" title="Clique para editar">${hex32(val)}</div>
        <div class="rc-bytes" id="rcb-${name}">${byteSpans(val)}</div>`;
    }
    d.querySelector('.rc-value').addEventListener('click', e => {
      e.stopPropagation();
      makeEditable(d.querySelector('.rc-value'), name, false);
    });
    g.appendChild(d);
  }

  // R8-R15 extension cards (x64 only)
  const eg=$('extCards'); if(eg) {
    eg.innerHTML='';
    for(const name of ext) {
      const d=document.createElement('div');
      d.className='reg-card rc-ext'+(name===S.reg?' rc-selected':'');
      d.id='rc-'+name;
      d.onclick=(e)=>{ if(!e.target.closest('.rc-edit-input')) App.selectReg(name); };
      const val=getReg(name);
      d.innerHTML=`<div class="rc-name">${name}</div>
        <div class="rc-value rc-val64 rc-value-editable" id="rcv-${name}" title="Clique para editar"><span class="rc-hi">00000000</span>${hex32(val)}</div>
        <div class="rc-bytes" id="rcb-${name}">${byteSpans(val)}</div>`;
      d.querySelector('.rc-value').addEventListener('click', e => {
        e.stopPropagation();
        makeEditable(d.querySelector('.rc-value'), name, false);
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
    d.className='reg-card rc-sp';
    d.id='rc-'+name;
    d.innerHTML=`<div class="rc-name">${name}</div>
      <div class="rc-value rc-value-sp rc-value-editable" id="rcv-${name}" title="Clique para editar">0x${fmtA(getReg(name))}</div>`;
    d.querySelector('.rc-value').addEventListener('click', e => {
      e.stopPropagation();
      makeEditable(d.querySelector('.rc-value'), name, true);
    });
    sg.appendChild(d);
  }
}

function byteSpans(v32, activePos=-1, doneSet=new Set()) {
  const h=hex32(v32);
  const p=[h.slice(0,2),h.slice(2,4),h.slice(4,6),h.slice(6,8)];
  // Labels: p[0]=MSB (DE), p[3]=LSB (EF) for value 0xDEADBEEF
  const lbl=['MSB','','','LSB'];
  return p.map((b,i)=>{
    let c='rc-byte';
    if(i===activePos) c+=' byte-arriving';
    else if(doneSet.has(i)) c+=' byte-done';
    const lblHtml = lbl[i] ? `<span class="rc-blbl rc-blbl-${lbl[i].toLowerCase()}">${lbl[i]}</span>` : '';
    return `<span class="${c}">${b}${lblHtml}</span>`;
  }).join('');
}

function updateRegCard(name) {
  const v=$('rcv-'+name), b=$('rcb-'+name);
  if(!v) return;
  const sp = spRegs();
  if(sp.includes(name)) { v.textContent='0x'+fmtA(getReg(name)); return; }
  const val = getReg(name);
  if(is64()) {
    const hiSpan = v.querySelector('.rc-hi');
    if(hiSpan) {
      hiSpan.textContent='00000000';
      let tn=hiSpan.nextSibling;
      if(tn&&tn.nodeType===3) tn.nodeValue=hex32(val);
      else { const t=document.createTextNode(hex32(val)); v.appendChild(t); }
    } else v.textContent=hex32(val);
  } else {
    v.textContent=hex32(val);
  }
  if(b) b.innerHTML=byteSpans(val);
}

// Live update during LOAD
function liveUpdate(name, partial, byteIdx) {
  const v=$('rcv-'+name);
  if(v) {
    if(is64()) {
      const hi=v.querySelector('.rc-hi');
      if(hi) {
        hi.textContent='00000000';
        // Update the text node after the span
        let tn=hi.nextSibling;
        if(tn&&tn.nodeType===3) tn.nodeValue=hex32(partial);
        else { const t=document.createTextNode(hex32(partial)); v.appendChild(t); }
      } else v.textContent=hex32(partial);
    } else v.textContent=hex32(partial);
  }

  // Which hex display position (0=leftmost/MSB, 3=rightmost/LSB) is arriving?
  const hexPos = S.endian==='little' ? (3-byteIdx) : byteIdx;

  // Build "done" set — already received positions
  const done=new Set();
  if(S.endian==='little') {
    for(let i=hexPos+1;i<=3;i++) done.add(i); // higher index = lower sig = read first
  } else {
    for(let i=0;i<hexPos;i++) done.add(i);
  }

  const b=$('rcb-'+name);
  if(b) b.innerHTML=byteSpans(partial, hexPos, done);

  const card=$('rc-'+name);
  if(card){ card.classList.add('reg-animating'); setTimeout(()=>card?.classList.remove('reg-animating'),420); }
}

// Highlight byte being SENT during STORE
function storeHighlight(name, hexPos) {
  const b=$('rcb-'+name);
  if(!b) return;
  const h=hex32(getReg(name));
  const p=[h.slice(0,2),h.slice(2,4),h.slice(4,6),h.slice(6,8)];
  b.innerHTML=p.map((bv,i)=>`<span class="rc-byte${i===hexPos?' byte-active':''}">${bv}</span>`).join('');
  const card=$('rc-'+name);
  if(card){ card.classList.add('reg-animating'); setTimeout(()=>card?.classList.remove('reg-animating'),420); }
}

function setLoading(name, on) {
  $('rc-'+name)?.classList.toggle('rc-loading', on);
  if(!on) updateRegCard(name);
}

// ─────────────────────────────────────────────────────────
// SIDEBAR PICKER
// ─────────────────────────────────────────────────────────
function syncPicker() { [...gpRegs(),...extRegs(),...spRegs()].forEach(updatePickerVal); }
function updatePickerVal(n) {
  const e=$('rpv-'+n); if(!e) return;
  const sp = spRegs();
  e.textContent = sp.includes(n) ? '0x'+fmtA(getReg(n)) : hex32(getReg(n));
}

// ─────────────────────────────────────────────────────────
// VALUE PREVIEW
// ─────────────────────────────────────────────────────────
function refreshPreview() {
  const c=$('valPreview'); if(!c) return;
  const n=Math.min(sizeN(),4), bs=getBytes(getReg(S.reg),n);
  const ord=S.endian==='little' ? bs : [...bs].reverse();
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
  const n=Math.min(sizeN(),4), addr=parseInt($('addrInput').value||'0',16)&0x3F;
  const bs=getBytes(getReg(S.reg),n);
  const ord=S.endian==='little' ? bs : [...bs].reverse();
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
  g.innerHTML=''; a.innerHTML='<span class="mem-dir-hi">▲ ALTO</span>';
  for(let r=0;r<8;r++) {
    const l=document.createElement('div');
    l.className='addr-lbl';
    l.textContent='0x'+(r*8).toString(16).padStart(4,'0').toUpperCase();
    a.appendChild(l);
    for(let c=0;c<8;c++) {
      const idx=r*8+c, cell=document.createElement('div');
      cell.className='mem-cell'; cell.dataset.idx=idx;
      cell.textContent=hex8(S.mem[idx]);
      if(S.memState[idx]) cell.classList.add(S.memState[idx]);
      g.appendChild(cell);
    }
  }
  a.innerHTML+='<span class="mem-dir-lo">▼ BAIXO</span>';
}

const memEl = idx => $('memGrid').querySelector(`.mem-cell[data-idx="${idx}"]`);

function writeMem(idx, val, st) {
  if(idx<0||idx>=64) return;
  S.mem[idx]=val&0xFF; S.memState[idx]=st||'';
  const el=memEl(idx); if(!el) return;
  el.textContent=hex8(val);
  el.className='mem-cell mc-flash'+(st?' '+st:'');
  setTimeout(()=>{ if(el) el.classList.remove('mc-flash'); },500);
}

function setMemSt(idx, st) {
  if(idx<0||idx>=64) return;
  const el=memEl(idx); if(!el) return;
  el.className='mem-cell'+(st?' '+st:'');
}

function clearSel() { $$('.mc-selected').forEach(c=>c.classList.remove('mc-selected')); }

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
  refreshPreview(); refreshBreakdown();
  lg('sys','Formato: '+e.toUpperCase()+' endian');
}

function doSetSize(s) {
  S.size=s;
  ['byte','word','dword','qword'].forEach(x=>{
    const id='s'+x[0].toUpperCase()+x.slice(1);
    $( id)?.classList.toggle('active',x===s);
  });
  // QWORD only available in x64 mode; clamp to dword otherwise
  if(s==='qword' && !is64()) { S.size='dword'; doSetSize('dword'); return; }
  refreshPreview(); refreshBreakdown();
  lg('sys','Tamanho: '+s.toUpperCase()+' ('+sizeN()*8+' bits)');
}

function doSelectReg(name) {
  S.reg=name;
  [...gpRegs(),...extRegs(),...spRegs()].forEach(r=>{
    $('rc-'+r)?.classList.toggle('rc-selected',r===name);
    $('r'+r)?.classList.toggle('active',r===name);
  });
  const sp = spRegs();
  const maxHex = Math.min(sizeN()*2,8);
  const v = sp.includes(name) ? fmtA(getReg(name)) : hex32(getReg(name)).slice(8-maxHex);
  $('valInput').value=v;
  refreshPreview(); refreshBreakdown();
  lg('sys','Registrador '+name+' selecionado');
}

function buildRegPicker() {
  const picker=$('regPicker'); if(!picker) return;
  const gp=gpRegs(), sp=spRegs(), ext=extRegs();
  const all=[...gp,...ext,...sp];
  picker.innerHTML='';
  for(const name of all) {
    const isSp=sp.includes(name);
    const btn=document.createElement('button');
    btn.className='rpbtn'+(isSp?' rpbtn-sp':'')+(name===S.reg?' active':'');
    btn.id='r'+name;
    btn.onclick=()=>App.selectReg(name);
    const val=getReg(name);
    btn.innerHTML=`<span class="rp-name">${name}</span>
      <span class="rp-val" id="rpv-${name}">${isSp?'0x'+fmtA(val):hex32(val)}</span>`;
    picker.appendChild(btn);
  }
}

function doSetArch(arch) {
  S.arch = arch;
  $('archIA32')?.classList.toggle('active', arch==='ia32');
  $('archX64') ?.classList.toggle('active', arch==='x64');

  // Add QWORD button visibility
  const sQ=$('sQword'); if(sQ) sQ.style.display = arch==='x64' ? '' : 'none';

  // Switch back from qword if switching to ia32
  if(arch==='ia32' && S.size==='qword') doSetSize('dword');

  // Map current register to equivalent in new arch
  const ia32gp = ['EAX','EBX','ECX','EDX','ESI','EDI'];
  const x64gp  = ['RAX','RBX','RCX','RDX','RSI','RDI'];
  if(arch==='x64') {
    const idx = ia32gp.indexOf(S.reg);
    if(idx>=0) S.reg = x64gp[idx];
    if(S.reg==='ESP') S.reg='RSP';
    if(S.reg==='EBP') S.reg='RBP';
  } else {
    const idx = x64gp.indexOf(S.reg);
    if(idx>=0) S.reg = ia32gp[idx];
    if(S.reg==='RSP') S.reg='ESP';
    if(S.reg==='RBP') S.reg='EBP';
    // R8-R15 → default EAX
    if(S.reg.match(/^R\d+$/)) S.reg='EAX';
  }

  buildRegCards();
  buildRegPicker();
  setPC(S.pc);
  syncPicker(); refreshStats(); refreshPreview(); refreshBreakdown();
  updatePickerVal(S.reg);
  doSelectReg(S.reg);
  const chip=$('archDisplay'); if(chip) chip.textContent=arch==='x64'?'x86-64':'IA-32';
  const asmPh=$('asmInput'); if(asmPh) asmPh.placeholder=arch==='x64'?'MOV RAX, 0x1234':'MOV EAX, 0x1234';
  lg('sys','Arquitetura: '+(arch==='x64'?'x86-64':'IA-32'));
}

// ─────────────────────────────────────────────────────────
// STORE
// ─────────────────────────────────────────────────────────
async function doStore() {
  if(S.busy) return;
  S.busy=true; setBusy(true);
  const reg=S.reg, val=getReg(reg), addr=readAddr(), n=Math.min(sizeN(),4), t0=performance.now();
  const ord=ordered(val,n,S.endian);
  setPC(addr);
  lg('store',`STORE ${reg}=0x${hex32(val)} → [0x${fmtA(addr)}] (${S.size.toUpperCase()}, ${S.endian}-endian)`,
     asmForOp('store-start',{reg,addr,val}));
  setStatus(`STORE: gravando ${n} byte(s) em [0x${fmtA(addr)}]...`,'lbl-store');

  for(let i=0;i<n;i++) {
    const ma=addr+i;
    if(ma>=64){lg('error',`Endereço 0x${fmtA(ma)} fora do range`);break;}
    // hexPos: display index of byte being sent
    const hexPos=S.endian==='little'?(n-1-i):i;
    storeHighlight(reg, hexPos);
    setPC(ma);
    setMemSt(ma,'mc-pc');
    await animPacket('store', ord[i], ma);
    writeMem(ma, ord[i], 'mc-active');
    lg('store',`  [0x${fmtA(ma)}] ← 0x${hex8(ord[i])}  (byte ${i+1}/${n})`,
       asmForOp('store-byte',{byteAddr:ma,byteVal:ord[i],byteIdx:i,byteCount:n}));
    await sleep(S.speed*0.18);
    S.memState[ma]='mc-written'; setMemSt(ma,'mc-written');
  }
  updateRegCard(reg);
  const ms=Math.round(performance.now()-t0);
  recOp('store',ms);
  setPC((addr+n)&0x3F);
  setStatus(`STORE concluído — ${ms}ms`,'lbl-done');
  lg('store',`STORE completo em ${ms}ms`);
  refreshStats(); refreshBreakdown();
  S.busy=false; setBusy(false);
}

// ─────────────────────────────────────────────────────────
// LOAD
// ─────────────────────────────────────────────────────────
async function doLoad() {
  if(S.busy) return;
  S.busy=true; setBusy(true);
  const reg=S.reg, addr=readAddr(), n=Math.min(sizeN(),4), t0=performance.now();
  setPC(addr);
  lg('load',`LOAD [0x${fmtA(addr)}] → ${reg} (${S.size.toUpperCase()}, ${S.endian}-endian)`,
     asmForOp('load-start',{reg,addr}));
  setStatus(`LOAD: lendo ${n} byte(s) de [0x${fmtA(addr)}]...`,'lbl-load');

  const raw=[];
  for(let i=0;i<n;i++) { const ma=addr+i; raw.push(ma<64?S.mem[ma]:0); }

  // Zero register + show loading state
  setReg(reg,0); setLoading(reg,true);

  for(let i=0;i<n;i++) {
    const ma=addr+i; if(ma>=64) break;
    setPC(ma); setMemSt(ma,'mc-active');
    await animPacket('load', raw[i], ma);

    // Assemble byte into correct bit position
    let pv=getReg(reg);
    pv = S.endian==='little'
      ? (pv|((raw[i]&0xFF)<<(i*8)))>>>0
      : (pv|((raw[i]&0xFF)<<((n-1-i)*8)))>>>0;
    setReg(reg,pv);

    // Live register update — value builds up byte by byte
    liveUpdate(reg, pv, i);
    updatePickerVal(reg);

    lg('load',`  ${reg}[+${i}] ← [0x${fmtA(ma)}]=0x${hex8(raw[i])}  → ${reg}=0x${hex32(pv)}`,
       asmForOp('load-byte',{byteAddr:ma,byteIdx:i,partial:pv}));
    await sleep(S.speed*0.18);
    S.memState[ma]='mc-written'; setMemSt(ma,'mc-written');
  }

  setLoading(reg,false);
  updatePickerVal(reg);
  const fv=getReg(reg);
  $('valInput').value=hex32(fv).slice(8-Math.min(sizeN()*2,8));
  const ms=Math.round(performance.now()-t0);
  recOp('load',ms);
  setPC((addr+n)&0x3F);
  setStatus(`LOAD concluído: ${reg}=0x${hex32(fv)} — ${ms}ms`,'lbl-done');
  lg('load',`LOAD completo: ${reg}=0x${hex32(fv)} em ${ms}ms`);
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

// Opcode table: byte → { mnem, size (bytes total), decode(mem, pc) }
// Supported subset:
//   0x90        NOP
//   0xF4        HLT
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

  // B8..BF: MOV r32/r64, imm32
  if(op>=0xB8 && op<=0xBF) {
    const regIdx = (op-0xB8) + (rex_b ? 8 : 0);
    const reg = regName(regIdx & 7, rex_b);
    const base = pc+off+1;
    const imm=(S.mem[base&0x3F])|(S.mem[(base+1)&0x3F]<<8)|(S.mem[(base+2)&0x3F]<<16)|(S.mem[(base+3)&0x3F]<<24);
    const immU=imm>>>0;
    return { op, mnem:`${rexPfx}MOV ${reg}, 0x${hex32(immU)}`, size:off+5,
             asm:`MOV ${reg}, 0x${hex32(immU)}`,
             exec:()=>{ setReg(reg,immU); updateRegCard(reg); updatePickerVal(reg); } };
  }
  if(op===0x90) return { op, mnem:'NOP', size:off+1, asm:'NOP', exec:()=>{} };
  if(op===0xF4) return { op, mnem:'HLT', size:off+1, asm:'HLT', exec:()=>{ S.halt=true; } };
  if(op===0xEB) {
    const rel=((S.mem[(pc+off+1)&0x3F])<<24>>24); // signed byte
    const target=(pc+off+2+rel)&0x3F;
    return { op, mnem:`JMP SHORT +${rel} → 0x${fmtA(target)}`, size:off+2, asm:`JMP SHORT 0x${fmtA(target)}`,
             exec:()=>{}, jmpTarget:target };
  }
  if(op===0x89||op===0x8B) {
    const modrm=S.mem[(pc+off+1)&0x3F];
    const mod=(modrm>>6)&3, regIdx=(modrm>>3)&7, rmIdx=modrm&7;
    const rName=regName(regIdx, rex_r), rmName=regName(rmIdx, rex_b);
    const dPtr = is64() ? 'QWORD PTR' : 'DWORD PTR';
    if(mod===3) {
      if(op===0x89) return { op, mnem:`${rexPfx}MOV ${rmName}, ${rName}`, size:off+2, asm:`MOV ${rmName}, ${rName}`,
        exec:()=>{ setReg(rmName,getReg(rName)); updateRegCard(rmName); updatePickerVal(rmName); } };
      else return { op, mnem:`${rexPfx}MOV ${rName}, ${rmName}`, size:off+2, asm:`MOV ${rName}, ${rmName}`,
        exec:()=>{ setReg(rName,getReg(rmName)); updateRegCard(rName); updatePickerVal(rName); } };
    }
    if(mod===0) {
      const addr=S.mem[(pc+off+2)&0x3F]&0x3F;
      if(op===0x89) return { op, mnem:`${rexPfx}MOV [0x${fmtA(addr)}], ${rName}`, size:off+3, asm:`MOV ${dPtr} [0x${fmtA(addr)}], ${rName}`,
        exec:()=>{ const v=getReg(rName); const bs=ordered(v,4,'little'); bs.forEach((b,i)=>writeMem((addr+i)&0x3F,b,'mc-written')); } };
      else return { op, mnem:`${rexPfx}MOV ${rName}, [0x${fmtA(addr)}]`, size:off+3, asm:`MOV ${rName}, ${dPtr} [0x${fmtA(addr)}]`,
        exec:()=>{ let v=0; for(let i=0;i<4;i++) v|=(S.mem[(addr+i)&0x3F]<<(i*8)); setReg(rName,v>>>0); updateRegCard(rName); updatePickerVal(rName); } };
    }
  }
  if(op===0xFF) { // PUSH
    const modrm=S.mem[(pc+off+1)&0x3F]; const mod=(modrm>>6)&3, rmIdx=modrm&7;
    if(mod===3) { const rn=regName(rmIdx, rex_b); return { op, mnem:`${rexPfx}PUSH ${rn}`, size:off+2, asm:`PUSH ${rn}`,
      exec:()=>{ S.regs[spKey]=(S.regs[spKey]-4+64)&0x3F; const v=getReg(rn); const bs=ordered(v,4,'little'); bs.forEach((b,i)=>writeMem((S.regs[spKey]+i)&0x3F,b,'mc-written')); updateRegCard(spName); updatePickerVal(spName); } }; }
  }
  if(op===0x8F) { // POP
    const modrm=S.mem[(pc+off+1)&0x3F]; const mod=(modrm>>6)&3, rmIdx=modrm&7;
    if(mod===3) { const rn=regName(rmIdx, rex_b); return { op, mnem:`${rexPfx}POP ${rn}`, size:off+2, asm:`POP ${rn}`,
      exec:()=>{ let v=0; for(let i=0;i<4;i++) v|=(S.mem[(S.regs[spKey]+i)&0x3F]<<(i*8)); setReg(rn,v>>>0); S.regs[spKey]=(S.regs[spKey]+4)&0x3F; updateRegCard(rn); updateRegCard(spName); updatePickerVal(rn); updatePickerVal(spName); } }; }
  }
  return { op, mnem:`DB 0x${hex8(op)}`, size:1, asm:`; 0x${hex8(op)} (não reconhecido)`, exec:()=>{}, unknown:true };
}

// ─────────────────────────────────────────────────────────
// FETCH + DECODE (novo — mostra opcode e mnemônico)
// ─────────────────────────────────────────────────────────
async function doFetch() {
  if(S.busy) return;
  S.busy=true; setBusy(true);
  const addr=S.pc;                    // IP aponta para a instrução
  const instr=decodeAt(addr);

  // ── FASE 1: FETCH ──────────────────────────────────────
  // Lê bytes da memória → Instruction Register (IR)
  // O IP é incrementado IMEDIATAMENTE para além dos bytes lidos
  // (Intel SDM Vol.1 §6.3: "The EIP register is incremented after each
  //  instruction fetch to point to the next sequential instruction")
  const np=(addr+instr.size)&0x3F;   // novo PC = endereço pós-instrução
  setStatus(`FETCH: IP=0x${fmtA(addr)} → lendo ${instr.size} byte(s) → IR`,'lbl-fetch');
  for(let i=0;i<instr.size;i++){const ma=(addr+i)&0x3F; setMemSt(ma,'mc-pc');}
  lg('info',`FETCH  IP=0x${fmtA(addr)} | opcode=0x${hex8(instr.op)} | ${instr.size} byte(s)`);
  await sleep(S.speed * 0.4);

  // IP avança durante o fetch (antes do decode/execute)
  setPC(np);
  setStatus(`FETCH: IP atualizado → 0x${fmtA(np)}  (instrução no IR)`,'lbl-fetch');
  lg('info',`FETCH  IP ← 0x${fmtA(np)}  (incrementado durante o fetch)`);
  await sleep(S.speed * 0.25);

  // ── FASE 2: DECODE ─────────────────────────────────────
  // Decodifica o conteúdo do IR
  setStatus(`DECODE: ${instr.mnem}`,'lbl-fetch');
  lg('info',`DECODE → ${instr.mnem}`, instr.asm);
  await sleep(S.speed * 0.35);

  for(let i=0;i<instr.size;i++){const ma=(addr+i)&0x3F; setMemSt(ma,S.memState[ma]||'');}
  setStatus(`FETCH+DECODE concluído — IP = 0x${fmtA(np)}`,'lbl-done');
  S.busy=false; setBusy(false);
}

// ─────────────────────────────────────────────────────────
// EXECUTE — núcleo interno (sem setBusy, para uso por doRun)
// ─────────────────────────────────────────────────────────
async function _executeOne() {
  if(S.halt) return;
  const addr=S.pc;
  const instr=decodeAt(addr);

  // ── FASE 1: FETCH ──────────────────────────────────────
  // Lê bytes da memória → IR; IP incrementa imediatamente (Intel SDM §6.3)
  const np_seq = (addr+instr.size)&0x3F;   // PC sequencial (pode ser sobrescrito por JMP)
  setStatus(`FETCH  IP=0x${fmtA(addr)} | ${instr.size}B → IR`,'lbl-fetch');
  for(let i=0;i<instr.size;i++){const ma=(addr+i)&0x3F; setMemSt(ma,'mc-pc');}
  lg('info',`FETCH  IP=0x${fmtA(addr)} opcode=0x${hex8(instr.op)}`);
  await sleep(S.speed * 0.25);

  // IP avança durante o fetch
  setPC(np_seq);
  await sleep(S.speed * 0.1);

  // ── FASE 2: DECODE ─────────────────────────────────────
  setStatus(`DECODE: ${instr.mnem}`,'lbl-fetch');
  lg('info',`DECODE → ${instr.mnem}`, instr.asm);
  await sleep(S.speed * 0.2);

  // ── FASE 3: EXECUTE ────────────────────────────────────
  setStatus(`EXECUTE: ${instr.mnem}`,'lbl-load');
  instr.exec();
  for(let i=0;i<instr.size;i++){const ma=(addr+i)&0x3F; setMemSt(ma,S.memState[ma]||'');}

  // JMP sobrescreve o IP que foi incrementado durante o fetch
  if(instr.jmpTarget !== undefined) setPC(instr.jmpTarget);

  await sleep(S.speed * 0.2);

  if(instr.unknown) lg('error',`Opcode 0x${hex8(instr.op)} não suportado`);
  else lg('store',`EXEC OK: ${instr.mnem}`, instr.asm);

  if(S.halt) { setStatus('HLT — CPU parada','lbl-error'); lg('error','HLT executado. CPU parada.'); }
  else setStatus(`EXECUTE concluído — IP = 0x${fmtA(S.pc)}`,'lbl-done');

  syncPicker(); refreshStats(); refreshPreview(); refreshBreakdown();
}

async function doExecute() {
  if(S.busy) return;
  if(S.halt){ lg('error','CPU halted. CLEAR para reiniciar.'); return; }
  S.busy=true; setBusy(true);
  await _executeOne();
  S.busy=false; setBusy(false);
}

// ─────────────────────────────────────────────────────────
// PROGRAMA — RUN / STEP
// ─────────────────────────────────────────────────────────
async function doStep() { await doExecute(); }

async function doRun() {
  if(S.busy||S.progRunning) return;
  S.halt=false; S.progRunning=true;
  S.busy=true;
  // Desabilita tudo EXCETO o botão STOP (opRun)
  ['opStore','opLoad','opFetch','opClear','opExecute','opStep','opPush','opPop'].forEach(id=>{
    const b=$(id); if(b) b.disabled=true;
  });
  const runBtn=$('opRun');
  if(runBtn){ runBtn.textContent='STOP'; runBtn.disabled=false; runBtn.onclick=()=>{ S.halt=true; }; }

  while(!S.halt) {
    await _executeOne();
    if(S.halt) break;
    await sleep(S.speed * 0.1);
  }

  S.progRunning=false; S.busy=false;
  setBusy(false);
  if(runBtn){ runBtn.textContent='RUN'; runBtn.onclick=doRun; }
}

// ─────────────────────────────────────────────────────────
// PUSH / POP (standalone, usa ESP)
// ─────────────────────────────────────────────────────────
async function doPush() {
  if(S.busy) return;
  S.busy=true; setBusy(true);
  const reg=S.reg, val=getReg(reg)>>>0;
  const spName = is64() ? 'RSP' : 'ESP';
  S.regs.ESP=(S.regs.ESP-4+64)&0x3F;
  const sp=S.regs.ESP;
  setPC(sp);
  lg('store',`PUSH ${reg}=0x${hex32(val)} → ${spName}=0x${fmtA(sp)}`, `PUSH ${reg}`);
  setStatus(`PUSH: ${reg} → [0x${fmtA(sp)}]`,'lbl-store');
  const bs=ordered(val,4,'little');
  for(let i=0;i<4;i++) {
    const ma=(sp+i)&0x3F;
    setMemSt(ma,'mc-pc');
    await animPacket('store', bs[i], ma);
    writeMem(ma, bs[i], 'mc-written');
    await sleep(S.speed*0.12);
  }
  updateRegCard(spName); updatePickerVal(spName);
  setStatus(`PUSH concluído — ${spName}=0x${fmtA(sp)}`,'lbl-done');
  setPC((sp+4)&0x3F);
  refreshStats(); refreshBreakdown();
  S.busy=false; setBusy(false);
}

async function doPop() {
  if(S.busy) return;
  S.busy=true; setBusy(true);
  const reg=S.reg, spName=is64()?'RSP':'ESP', sp=S.regs.ESP&0x3F;
  setPC(sp);
  lg('load',`POP [0x${fmtA(sp)}] → ${reg}`, `POP ${reg}`);
  setStatus(`POP: [0x${fmtA(sp)}] → ${reg}`,'lbl-load');
  let v=0;
  setReg(reg,0); setLoading(reg,true);
  for(let i=0;i<4;i++) {
    const ma=(sp+i)&0x3F;
    setMemSt(ma,'mc-active');
    await animPacket('load', S.mem[ma], ma);
    v|=(S.mem[ma]<<(i*8));
    setReg(reg,v>>>0);
    liveUpdate(reg, v>>>0, i); updatePickerVal(reg);
    await sleep(S.speed*0.12);
    setMemSt(ma,S.memState[ma]||'');
  }
  setLoading(reg,false);
  S.regs.ESP=(sp+4)&0x3F;
  updateRegCard(reg); updateRegCard(spName); updatePickerVal(spName);
  const fv=getReg(reg);
  $('valInput').value=hex32(fv).slice(8-Math.min(sizeN()*2,8));
  setStatus(`POP concluído — ${reg}=0x${hex32(fv)}`,'lbl-done');
  setPC((sp+4)&0x3F);
  refreshStats(); refreshPreview(); refreshBreakdown();
  S.busy=false; setBusy(false);
}

// ─────────────────────────────────────────────────────────
// ASSEMBLER EMBUTIDO
// Converte instrução Intel (subset) para bytes e grava na memória
// ─────────────────────────────────────────────────────────
function assemble(src) {
  // Normaliza: uppercase, colapsa espaços
  const s = src.trim().toUpperCase().replace(/\s+/g,' ').replace(/,\s*/g,',');
  const tok = s.split(' ');
  const mnem = tok[0];
  const ops  = tok.slice(1).join(' ').split(',').map(x=>x.trim());

  // Build full register lookup (IA-32 + x64 GP + R8-R15)
  const ALL_REGS = [...REG32, ...REG64, ...REG64X];
  const isReg = n => ALL_REGS.includes(n);
  const isImm = n => /^0X[0-9A-F]+$/.test(n)||/^[0-9]+$/.test(n);
  const parseImm = n => (n.startsWith('0X') ? parseInt(n,16) : parseInt(n,10))>>>0;
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
    const rel = ((target - (S.pc+2))+128)&0xFF;
    return [0xEB, rel&0xFF];
  }

  if(mnem==='MOV' && ops.length===2) {
    const [dst,src2]=ops;
    // MOV reg, imm32
    if(isReg(dst) && isImm(src2)) {
      const r=resolveReg(dst); if(!r) return null;
      const v=parseImm(src2);
      return [...rexByte(0,0,0,r.ext), 0xB8+r.idx, v&0xFF,(v>>8)&0xFF,(v>>16)&0xFF,(v>>24)&0xFF];
    }
    // MOV reg, reg
    if(isReg(dst) && isReg(src2)) {
      const rd=resolveReg(dst), rs=resolveReg(src2); if(!rd||!rs) return null;
      return [...rexByte(0,rs.ext,0,rd.ext), 0x89, modrm(3,rs.idx,rd.idx)];
    }
    // MOV [addr], reg  (strip QWORD PTR / DWORD PTR if present)
    const dstClean = dst.replace(/(?:QWORD|DWORD|WORD|BYTE)\s*PTR\s*/,'');
    const src2Clean = src2.replace(/(?:QWORD|DWORD|WORD|BYTE)\s*PTR\s*/,'');
    const mAddr=/^\[(?:0X)?([0-9A-F]+)\]$/.exec(dstClean);
    if(mAddr && isReg(src2Clean)) {
      const rs=resolveReg(src2Clean); if(!rs) return null;
      const addr=parseInt(mAddr[1],16)&0x3F;
      return [...rexByte(0,rs.ext,0,0), 0x89, modrm(0,rs.idx,0), addr];
    }
    // MOV reg, [addr]
    const mAddr2=/^\[(?:0X)?([0-9A-F]+)\]$/.exec(src2Clean);
    if(isReg(dstClean) && mAddr2) {
      const rd=resolveReg(dstClean); if(!rd) return null;
      const addr=parseInt(mAddr2[1],16)&0x3F;
      return [...rexByte(0,rd.ext,0,0), 0x8B, modrm(0,rd.idx,0), addr];
    }
  }
  return null; // não reconhecido
}

async function doAssemble() {
  const inp=$('asmInput'); if(!inp) return;
  const src=inp.value.trim(); if(!src) return;
  const bytes=assemble(src);
  if(!bytes){ lg('error',`ASM: não reconhecido — "${src}"`); return; }
  const addr=S.pc;
  lg('sys',`ASM: "${src}" → [${bytes.map(b=>'0x'+hex8(b)).join(', ')}] @ 0x${fmtA(addr)}`);
  for(let i=0;i<bytes.length;i++) writeMem((addr+i)&0x3F, bytes[i], 'mc-written');
  setPC((addr+bytes.length)&0x3F);
  inp.value='';
}

// ─────────────────────────────────────────────────────────
// CLEAR
// ─────────────────────────────────────────────────────────
function doClear() {
  S.mem.fill(0); S.memState.fill('');
  // Reset all GP registers
  S.regs.EAX=0xDEADBEEF; S.regs.EBX=0xCAFEBABE; S.regs.ECX=0x12345678; S.regs.EDX=0xABCD1234;
  S.regs.ESI=0; S.regs.EDI=0;
  S.regs.RAX_hi=0; S.regs.RBX_hi=0; S.regs.RCX_hi=0; S.regs.RDX_hi=0;
  S.regs.RSI_hi=0; S.regs.RDI_hi=0;
  ['R8','R9','R10','R11','R12','R13','R14','R15'].forEach(r=>{ S.regs[r]=0; S.regs[r+'_hi']=0; });
  S.regs.ESP=0x003C; S.regs.EBP=0x003C;
  S.halt=false; S.progRunning=false;
  // Reset selected register to arch default
  S.reg = is64() ? 'RAX' : 'EAX';
  buildRegCards(); buildMemGrid(); setPC(0);
  $('valInput').value=hex32(getReg(S.reg)).slice(8-Math.min(sizeN()*2,8));
  syncPicker(); refreshPreview(); refreshBreakdown();
  const runBtn=$('opRun'); if(runBtn){runBtn.textContent='RUN'; runBtn.onclick=doRun;}
  setStatus('Memória e registradores limpos','lbl-done');
  lg('sys','Reiniciado.', asmForOp('clear',{}));
}

// ─────────────────────────────────────────────────────────
// ANIMATION
// ─────────────────────────────────────────────────────────
async function animPacket(dir, bv, memIdx) {
  const stage=$('animStage'), svg=$('animSVG');
  const rc=$('rc-'+S.reg), mc=memEl(memIdx);
  if(!stage||!svg||!rc||!mc){ await sleep(Math.max(S.speed*0.4,80)); return; }

  const sr=stage.getBoundingClientRect();
  const rr=rc.getBoundingClientRect();
  const mr=mc.getBoundingClientRect();

  const px=r=>Math.max(10,Math.min(sr.width-10,  r.left+r.width/2 -sr.left));
  const py=r=>Math.max(8, Math.min(sr.height-8,  r.top +r.height/2-sr.top));

  const x1=dir==='store'?px(rr):px(mr), y1=dir==='store'?py(rr):py(mr);
  const x2=dir==='store'?px(mr):px(rr), y2=dir==='store'?py(mr):py(rr);

  const col=dir==='store'?'#4ade80':'#60a5fa';
  const mk =dir==='store'?'url(#arrowG)':'url(#arrowB)';

  const ln=document.createElementNS('http://www.w3.org/2000/svg','line');
  [['x1',x1],['y1',y1],['x2',x2],['y2',y2],
   ['stroke',col],['stroke-width','1.5'],['stroke-dasharray','5 4'],
   ['opacity','0.38'],['marker-end',mk]].forEach(([k,v])=>ln.setAttribute(k,v));
  svg.appendChild(ln);

  const pkt=document.createElement('div');
  pkt.className=`anim-packet pkt-${dir}`;
  pkt.textContent=hex8(bv);
  pkt.style.cssText=`left:${x1}px;top:${y1}px;`;
  stage.appendChild(pkt);

  const dur=Math.max(S.speed*0.58,110), t0=performance.now();
  await new Promise(res=>{
    function step(now){
      const t=Math.min((now-t0)/dur,1), e=ease(t);
      pkt.style.left=(x1+(x2-x1)*e)+'px';
      pkt.style.top =(y1+(y2-y1)*e)+'px';
      t<1 ? requestAnimationFrame(step) : (pkt.remove(),ln.remove(),res());
    }
    requestAnimationFrame(step);
  });
}

// ─────────────────────────────────────────────────────────
// PC / STATUS / LOG / STATS
// ─────────────────────────────────────────────────────────
function setPC(addr){
  S.pc=addr&0x3F;
  const pd=$('pcDisplay');
  if(pd && document.activeElement!==pd) pd.value=fmtA(S.pc);
  const ai=$('addrInput');
  if(ai && document.activeElement!==ai) {
    ai.value=fmtA(S.pc);
    clearSel();
    memEl(S.pc)?.classList.add('mc-selected');
    refreshBreakdown();
  }
}
function setStatus(msg,cls){
  const el=$('animLabel'); if(!el) return;
  el.textContent=msg; el.className=cls||'';
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
      return `; [0x${fmtA(ctx.byteAddr)}] → ${ctx.reg}[byte ${ctx.byteIdx}]  (parcial: 0x${hex32(ctx.partial)})`;
    case 'fetch':
      return `; ${ipReg()} = 0x${fmtA(ctx.addr)}  →  fetch  →  ${ipReg()} = 0x${fmtA(ctx.newPC)}`;
    case 'clear':
      return is64() ? `XOR RAX, RAX  ; (padrão: reinicia regs e memória)` : `XOR EAX, EAX  ; (padrão: reinicia regs e memória)`;
    default:
      return null;
  }
}

function lg(type, msg, asm) {
  const out=$('logOutput'); if(!out) return;
  const d=document.createElement('div');
  d.className='le le-'+type;
  const ts=new Date().toTimeString().slice(0,8);
  if(asm) {
    d.innerHTML=`<span class="le-ts">[${ts}]</span> <span class="le-msg">${msg}</span>`+
                `<span class="le-asm">; asm: <code>${asm}</code></span>`;
  } else {
    d.textContent=`[${ts}] ${msg}`;
  }
  out.appendChild(d); out.scrollTop=out.scrollHeight;
}
function doClearLog(){ const o=$('logOutput'); if(o) o.innerHTML=''; }

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

function setBusy(on){['opStore','opLoad','opFetch','opClear','opExecute','opStep','opRun','opPush','opPop'].forEach(id=>{const b=$(id);if(b)b.disabled=on;});}
function readAddr(){return parseInt($('addrInput').value||'0',16)&0x3F;}

// ─────────────────────────────────────────────────────────
// SAVE / LOAD
// ─────────────────────────────────────────────────────────
function saveSim(){
  const data={version:4,state:{
    endian:S.endian,size:S.size,reg:S.reg,arch:S.arch,
    regs:{...S.regs},mem:Array.from(S.mem),memState:[...S.memState],
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
      if(d.arch) S.arch=d.arch;
      Object.assign(S.regs,d.regs);
      S.mem=new Uint8Array(d.mem); S.memState=d.memState;
      Object.assign(S.stats,d.stats); S.pc=d.pc;
      doSetEndian(S.endian); doSetArch(S.arch); doSetSize(S.size); doSelectReg(S.reg);
      buildRegCards(); buildRegPicker(); buildMemGrid(); setPC(S.pc);
      syncPicker(); refreshStats(); refreshPreview(); refreshBreakdown();
      lg('sys','Simulação carregada.');
    }catch(err){ lg('error','Falha: '+err.message); }
  };
  r.readAsText(file); e.target.value='';
}

// ─────────────────────────────────────────────────────────
// HELP
// ─────────────────────────────────────────────────────────
const HELP={
  intro:`<h3>O QUE É ENDIANNESS?</h3>
<p>Endianness define a <strong>ordem dos bytes</strong> na qual um valor multi-byte é armazenado na memória. A questão central é: qual byte vai para o endereço mais baixo?</p>
<p>Os dois formatos principais são <span class="hl">Little Endian</span> e <span class="hl-b">Big Endian</span>.</p>
<div class="info-box">💡 O nome vem de "As Viagens de Gulliver" — a guerra entre os que quebram o ovo pelo lado pequeno (<em>little-endians</em>) e os que o quebram pelo lado grande (<em>big-endians</em>).</div>
<p><strong>CPUs x86/x64</strong> (Intel, AMD) → Little Endian<br>
<strong>Protocolos TCP/IP</strong> → Big Endian ("network byte order")<br>
<strong>ARM</strong> → bi-endian (configurável)</p>`,

  little:`<h3>LITTLE ENDIAN</h3>
<p>O byte <span class="hl">menos significativo (LSB)</span> fica no <strong>menor endereço</strong> de memória.</p>
<p>Exemplo: valor <span class="hl">0xDEADBEEF</span> a partir de 0x0000:</p>
<div class="mem-diagram">
  <div class="md-cell md-addr"></div>
  <div class="md-cell md-hdr">+0</div><div class="md-cell md-hdr">+1</div>
  <div class="md-cell md-hdr">+2</div><div class="md-cell md-hdr">+3</div>
  <div class="md-cell md-addr">0x0000</div>
  <div class="md-cell md-lsb">EF</div><div class="md-cell md-mid">BE</div>
  <div class="md-cell md-mid">AD</div><div class="md-cell md-msb">DE</div>
</div>
<p><strong style="color:var(--grn)">EF</strong> (LSB) → 0x0000 &nbsp;|&nbsp; <strong style="color:var(--blu)">DE</strong> (MSB) → 0x0003</p>
<div class="info-box">✓ Usado por: x86, x64, ARM (padrão), RISC-V<br>✓ Vantagem: extensão de inteiros sem alterar o endereço base</div>`,

  big:`<h3>BIG ENDIAN</h3>
<p>O byte <span class="hl-b">mais significativo (MSB)</span> fica no <strong>menor endereço</strong> de memória.</p>
<p>Exemplo: valor <span class="hl-b">0xDEADBEEF</span> a partir de 0x0000:</p>
<div class="mem-diagram">
  <div class="md-cell md-addr"></div>
  <div class="md-cell md-hdr">+0</div><div class="md-cell md-hdr">+1</div>
  <div class="md-cell md-hdr">+2</div><div class="md-cell md-hdr">+3</div>
  <div class="md-cell md-addr">0x0000</div>
  <div class="md-cell md-msb">DE</div><div class="md-cell md-mid">AD</div>
  <div class="md-cell md-mid">BE</div><div class="md-cell md-lsb">EF</div>
</div>
<p><strong style="color:var(--blu)">DE</strong> (MSB) → 0x0000 &nbsp;|&nbsp; <strong style="color:var(--grn)">EF</strong> (LSB) → 0x0003</p>
<div class="info-box">✓ Usado por: SPARC, PowerPC, TCP/IP<br>✓ Vantagem: dump de memória legível da esquerda para direita</div>`,

  ops:`<h3>OPERAÇÕES</h3>
<p><span class="hl">STORE</span> — Grava o valor do registrador na memória, byte a byte. O nibble sendo enviado fica destacado e um pacote animado voa até a célula de memória.</p>
<p><span class="hl-b">LOAD</span> — Lê bytes da memória para o registrador. O registrador começa em zero e é preenchido byte a byte em tempo real — você vê o valor se construindo!</p>
<p><span style="color:var(--amb)">FETCH</span> — Simula busca de instrução. O PC avança automaticamente.</p>
<p><span style="color:var(--red)">CLEAR</span> — Reinicia memória e registradores.</p>
<div class="info-box">💡 Clique em qualquer célula de memória para selecionar aquele endereço.<br>
💡 Use DWORD para ver o efeito completo Little vs Big Endian.<br>
💡 Reduza a velocidade para acompanhar cada byte com calma.<br>
💡 Salve 💾 e carregue 📂 simulações para compartilhar.</div>`
};

function showHelp(page, tabEl){
  $('helpBody').innerHTML=HELP[page]||'';
  $$('.htab').forEach(t=>t.classList.remove('active'));
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
  doFetch,
  doClear,
  doExecute,
  doStep,
  doRun,
  doPush,
  doPop,
  doAssemble,
  clearLog:   doClearLog,
  showHelp,
  closeHelp,
};

document.addEventListener('DOMContentLoaded', init);
