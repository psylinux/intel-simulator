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
  regs: {
    EAX: 0xDEADBEEF,
    EBX: 0xCAFEBABE,
    ECX: 0x12345678,
    EDX: 0xABCD1234,
  },
  mem:      new Uint8Array(64),
  memState: new Array(64).fill(''),
  stats: {
    ops:0, totalTime:0, loads:0, stores:0,
    loadTimes:[], storeTimes:[], littleOps:0, bigOps:0,
  },
  pc: 0,
};

// ─────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hex32 = v => ((v>>>0).toString(16).padStart(8,'0')).toUpperCase();
const hex8  = v => ((v&0xFF).toString(16).padStart(2,'0')).toUpperCase();
const fmtA  = n => n.toString(16).padStart(4,'0').toUpperCase();
const ease  = t => t<.5 ? 2*t*t : -1+(4-2*t)*t;
const sizeN = () => S.size==='byte'?1 : S.size==='word'?2 : 4;

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
  buildMemGrid();
  syncPicker();
  refreshPreview();
  refreshBreakdown();
  refreshStats();

  $('speedSlider').addEventListener('input', e => {
    S.speed = +e.target.value;
    $('speedVal').textContent = S.speed+'ms';
  });

  $('valInput').addEventListener('input', () => {
    const raw = $('valInput').value.replace(/[^0-9a-fA-F]/g,'').toUpperCase();
    $('valInput').value = raw.slice(0, sizeN()*2);
    const v = parseInt(raw||'0',16)>>>0;
    S.regs[S.reg] = v;
    updateRegCard(S.reg);
    updatePickerVal(S.reg);
    refreshPreview();
    refreshBreakdown();
  });

  $('addrInput').addEventListener('input', () => {
    const raw = $('addrInput').value.replace(/[^0-9a-fA-F]/g,'').toUpperCase();
    $('addrInput').value = raw;
    clearSel();
    const idx = parseInt(raw||'0',16)&0x3F;
    memEl(idx)?.classList.add('mc-selected');
    refreshBreakdown();
  });

  $('memGrid').addEventListener('click', e => {
    const c = e.target.closest('.mem-cell');
    if(!c) return;
    const idx = +c.dataset.idx;
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
function buildRegCards() {
  const g=$('regCards'); g.innerHTML='';
  for(const name of ['EAX','EBX','ECX','EDX']) {
    const d=document.createElement('div');
    d.className='reg-card'+(name===S.reg?' rc-selected':'');
    d.id='rc-'+name; d.onclick=()=>App.selectReg(name);
    d.innerHTML=`<div class="rc-name">${name}</div>
      <div class="rc-value" id="rcv-${name}">${hex32(S.regs[name])}</div>
      <div class="rc-bytes" id="rcb-${name}">${byteSpans(S.regs[name])}</div>`;
    g.appendChild(d);
  }
}

function byteSpans(v32, activePos=-1, doneSet=new Set()) {
  const h=hex32(v32);
  const p=[h.slice(0,2),h.slice(2,4),h.slice(4,6),h.slice(6,8)];
  return p.map((b,i)=>{
    let c='rc-byte';
    if(i===activePos) c+=' byte-arriving';
    else if(doneSet.has(i)) c+=' byte-done';
    return `<span class="${c}">${b}</span>`;
  }).join('');
}

function updateRegCard(name) {
  const v=$('rcv-'+name), b=$('rcb-'+name);
  if(v) v.textContent=hex32(S.regs[name]);
  if(b) b.innerHTML=byteSpans(S.regs[name]);
}

// Live update during LOAD
function liveUpdate(name, partial, byteIdx) {
  const v=$('rcv-'+name);
  if(v) v.textContent=hex32(partial);

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
  const h=hex32(S.regs[name]);
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
function syncPicker() { ['EAX','EBX','ECX','EDX'].forEach(updatePickerVal); }
function updatePickerVal(n) { const e=$('rpv-'+n); if(e) e.textContent=hex32(S.regs[n]); }

// ─────────────────────────────────────────────────────────
// VALUE PREVIEW
// ─────────────────────────────────────────────────────────
function refreshPreview() {
  const c=$('valPreview'); if(!c) return;
  const n=sizeN(), bs=getBytes(S.regs[S.reg],n);
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
  const n=sizeN(), addr=parseInt($('addrInput').value||'0',16)&0x3F;
  const bs=getBytes(S.regs[S.reg],n);
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
  ['byte','word','dword'].forEach(x=>$('s'+x[0].toUpperCase()+x.slice(1)).classList.toggle('active',x===s));
  const maxN=sizeN()*2, vi=$('valInput');
  vi.maxLength=maxN;
  if(vi.value.length>maxN) vi.value=vi.value.slice(-maxN);
  refreshPreview(); refreshBreakdown();
  lg('sys','Tamanho: '+s.toUpperCase()+' ('+sizeN()*8+' bits)');
}

function doSelectReg(name) {
  S.reg=name;
  ['EAX','EBX','ECX','EDX'].forEach(r=>{
    $('rc-'+r)?.classList.toggle('rc-selected',r===name);
    $('r'+r)?.classList.toggle('active',r===name);
  });
  $('valInput').value=hex32(S.regs[name]).slice(8-sizeN()*2);
  refreshPreview(); refreshBreakdown();
  lg('sys','Registrador '+name+' selecionado');
}

// ─────────────────────────────────────────────────────────
// STORE
// ─────────────────────────────────────────────────────────
async function doStore() {
  if(S.busy) return;
  S.busy=true; setBusy(true);
  const reg=S.reg, val=S.regs[reg], addr=readAddr(), n=sizeN(), t0=performance.now();
  const ord=ordered(val,n,S.endian);
  setPC(addr);
  lg('store',`STORE ${reg}=0x${hex32(val)} → [0x${fmtA(addr)}] (${S.size.toUpperCase()}, ${S.endian}-endian)`);
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
    lg('store',`  [0x${fmtA(ma)}] ← 0x${hex8(ord[i])}  (byte ${i+1}/${n})`);
    await sleep(S.speed*0.18);
    S.memState[ma]='mc-written'; setMemSt(ma,'mc-written');
  }
  updateRegCard(reg);
  const ms=Math.round(performance.now()-t0);
  recOp('store',ms);
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
  const reg=S.reg, addr=readAddr(), n=sizeN(), t0=performance.now();
  setPC(addr);
  lg('load',`LOAD [0x${fmtA(addr)}] → ${reg} (${S.size.toUpperCase()}, ${S.endian}-endian)`);
  setStatus(`LOAD: lendo ${n} byte(s) de [0x${fmtA(addr)}]...`,'lbl-load');

  const raw=[];
  for(let i=0;i<n;i++) { const ma=addr+i; raw.push(ma<64?S.mem[ma]:0); }

  // Zero register + show loading state
  S.regs[reg]=0; setLoading(reg,true);

  for(let i=0;i<n;i++) {
    const ma=addr+i; if(ma>=64) break;
    setPC(ma); setMemSt(ma,'mc-active');
    await animPacket('load', raw[i], ma);

    // Assemble byte into correct bit position
    let pv=S.regs[reg];
    pv = S.endian==='little'
      ? (pv|((raw[i]&0xFF)<<(i*8)))>>>0
      : (pv|((raw[i]&0xFF)<<((n-1-i)*8)))>>>0;
    S.regs[reg]=pv;

    // Live register update — value builds up byte by byte
    liveUpdate(reg, pv, i);
    updatePickerVal(reg);

    lg('load',`  ${reg}[+${i}] ← [0x${fmtA(ma)}]=0x${hex8(raw[i])}  → ${reg}=0x${hex32(pv)}`);
    await sleep(S.speed*0.18);
    S.memState[ma]='mc-written'; setMemSt(ma,'mc-written');
  }

  setLoading(reg,false);
  updatePickerVal(reg);
  $('valInput').value=hex32(S.regs[reg]).slice(8-sizeN()*2);
  const ms=Math.round(performance.now()-t0);
  recOp('load',ms);
  setStatus(`LOAD concluído: ${reg}=0x${hex32(S.regs[reg])} — ${ms}ms`,'lbl-done');
  lg('load',`LOAD completo: ${reg}=0x${hex32(S.regs[reg])} em ${ms}ms`);
  refreshStats(); refreshPreview(); refreshBreakdown();
  S.busy=false; setBusy(false);
}

// ─────────────────────────────────────────────────────────
// FETCH
// ─────────────────────────────────────────────────────────
async function doFetch() {
  if(S.busy) return;
  S.busy=true; setBusy(true);
  const addr=readAddr(), n=sizeN();
  setPC(addr);
  lg('info',`FETCH instrução em [0x${fmtA(addr)}]`);
  setStatus(`FETCH: buscando instrução em [0x${fmtA(addr)}]...`,'lbl-fetch');
  for(let i=0;i<n;i++){const ma=addr+i; if(ma<64) setMemSt(ma,'mc-pc');}
  await sleep(S.speed);
  for(let i=0;i<n;i++){const ma=addr+i; if(ma<64) setMemSt(ma,S.memState[ma]||'');}
  const np=(addr+n)&0x3F; setPC(np);
  setStatus(`FETCH concluído — PC = 0x${fmtA(np)}`,'lbl-done');
  lg('info',`FETCH concluído. PC = 0x${fmtA(np)}`);
  S.busy=false; setBusy(false);
}

// ─────────────────────────────────────────────────────────
// CLEAR
// ─────────────────────────────────────────────────────────
function doClear() {
  S.mem.fill(0); S.memState.fill('');
  S.regs={EAX:0xDEADBEEF,EBX:0xCAFEBABE,ECX:0x12345678,EDX:0xABCD1234};
  buildRegCards(); buildMemGrid(); setPC(0);
  $('valInput').value=hex32(S.regs[S.reg]).slice(8-sizeN()*2);
  syncPicker(); refreshPreview(); refreshBreakdown();
  setStatus('Memória e registradores limpos','lbl-done');
  lg('sys','Reiniciado.');
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
  $('pcDisplay').textContent='0x'+fmtA(addr);
}
function setStatus(msg,cls){
  const el=$('animLabel'); if(!el) return;
  el.textContent=msg; el.className=cls||'';
}
function lg(type,msg){
  const out=$('logOutput'); if(!out) return;
  const d=document.createElement('div');
  d.className='le le-'+type;
  d.textContent=`[${new Date().toTimeString().slice(0,8)}] ${msg}`;
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

function setBusy(on){['opStore','opLoad','opFetch','opClear'].forEach(id=>{const b=$(id);if(b)b.disabled=on;});}
function readAddr(){return parseInt($('addrInput').value||'0',16)&0x3F;}

// ─────────────────────────────────────────────────────────
// SAVE / LOAD
// ─────────────────────────────────────────────────────────
function saveSim(){
  const data={version:3,state:{
    endian:S.endian,size:S.size,reg:S.reg,
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
      Object.assign(S.regs,d.regs);
      S.mem=new Uint8Array(d.mem); S.memState=d.memState;
      Object.assign(S.stats,d.stats); S.pc=d.pc;
      doSetEndian(S.endian); doSetSize(S.size); doSelectReg(S.reg);
      buildRegCards(); buildMemGrid(); setPC(S.pc);
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
  setEndian: doSetEndian,
  setSize:   doSetSize,
  selectReg: doSelectReg,
  doStore,
  doLoad,
  doFetch,
  doClear,
  clearLog: doClearLog,
  showHelp,
  closeHelp,
};

document.addEventListener('DOMContentLoaded', init);
