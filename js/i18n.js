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

const I18N = (() => {
  // ── Locales disponíveis ─────────────────────────────────────────────────────
  const AVAILABLE_LOCALES = [
    { code: 'pt-BR', name: 'Português (Brasil)' },
    { code: 'en-US', name: 'English (US)' },
  ];

  // ── Strings embutidas (sem fetch, funciona em file://) ──────────────────────
  const LOCALE_DATA = {
    'pt-BR': {
      "page.title": "Intel x86/x64 Memory & Stack Lab",
      "topbar.subtitle": "Simulador didático de memória, registradores e stack",
      "topbar.pc.title": "Edite o PC manualmente",
      "topbar.btn.help": "Ajuda / Tutorial",
      "topbar.btn.save": "Salvar simulação",
      "topbar.btn.load": "Carregar simulação",
      "topbar.chip.lastop": "LAST OP",
      "topbar.chip.ops": "OPS",
      "topbar.chip.arch": "ARCH",
      "topbar.chip.pc": "PC",
      "sidebar.arch.label": "ARQUITETURA",
      "sidebar.arch.ia32.name": "IA-32",
      "sidebar.arch.ia32.sub": "32-bit · EAX..EDI",
      "sidebar.arch.x64.name": "x86-64",
      "sidebar.arch.x64.sub": "64-bit · RAX..R15",
      "sidebar.endian.label": "ENDIANNESS (EXPERIMENTAL)",
      "sidebar.endian.little.name": "LITTLE",
      "sidebar.endian.little.sub": "LSB primeiro",
      "sidebar.endian.big.name": "BIG",
      "sidebar.endian.big.sub": "MSB primeiro",
      "sidebar.endian.hint.little": "← byte menos significativo (LSB)",
      "sidebar.endian.hint.big": "← byte mais significativo (MSB)",
      "sidebar.reg.label": "REGISTRADORES",
      "sidebar.speed.label": "VELOCIDADE",
      "sidebar.speed.fast": "RÁPIDO",
      "sidebar.speed.slow": "LENTO",
      "editguide.title": "EDICAO RAPIDA",
      "editguide.hint1": "Clique no <strong>PC</strong> e nos <strong>valores dos registradores</strong> para editar. Use <strong>2× clique</strong> no <strong>MAPA DE MEMORIA</strong> para editar bytes.",
      "editguide.hint2": "Edite o programa direto na <strong>LISTAGEM ASM</strong> com <strong>2× clique</strong> em qualquer instrucao.",
      "regs.gp.label": "REGISTRADORES DE USO GERAL",
      "regs.ext.label": "R8 — R15  (x86-64)",
      "regs.sp.label": "PONTEIROS DE PILHA",
      "ctrlbar.cpu.title": "CPU",
      "ctrlbar.speed.title": "VELOCIDADE",
      "ctrlbar.speed.fast": "RÁPIDO",
      "ctrlbar.speed.slow": "LENTO",
      "ctrlbar.mem.title": "MEMÓRIA",
      "ctrlbar.btn.step": "STEP",
      "ctrlbar.btn.run": "RUN",
      "ctrlbar.btn.clear": "CLEAR",
      "ctrlbar.btn.pause": "PAUSE",
      "ctrlbar.btn.stop": "STOP",
      "ctrlbar.btn.back": "BACK",
      "ctrlbar.btn.resume": "RESUME",
      "ctrlbar.btn.next": "NEXT",
      "ctrlbar.btn.store": "STORE",
      "ctrlbar.btn.load": "LOAD",
      "ctrlbar.btn.push": "PUSH",
      "ctrlbar.btn.pop": "POP",
      "mem.section.label": "MAPA DE MEMÓRIA",
      "mem.addrdir": "0x{0}..0x{1} · cresce ↓",
      "mem.legend.active": "Ativo",
      "mem.legend.written": "Escrito",
      "mem.legend.fetch": "Fetch",
      "mem.legend.bp": "BP",
      "mem.cell.title": "Endereco 0x{0} · Shift+Clique para breakpoint",
      "mem.bp.section": "BREAKPOINTS",
      "mem.bp.none": "Nenhum breakpoint definido",
      "mem.bp.clr.title": "Limpar todos os breakpoints",
      "mem.bp.clr.btn": "LIMPAR",
      "asm.section.label": "LISTAGENS DE CODIGO",
      "asm.trace.head.asm": "LISTAGEM ASM",
      "asm.trace.head.pseudo": "PSEUDO-CÓDIGO",
      "asm.hint.placeholder.ia32": "MOV EAX, 0x1234",
      "asm.hint.placeholder.x64": "MOV RAX, 0x1234",
      "asm.bp.set": "Clique para definir breakpoint",
      "asm.bp.remove": "BP #{0} — clique para remover",
      "asm.nav.title": "Clique para navegar · 2× clique para editar",
      "asm.pseudocode.title": "Clique para navegar",
      "log.section.label": "LOG DE OPERAÇÕES",
      "log.clear.btn": "limpar",
      "log.kind.step": "STEP",
      "log.kind.store": "STORE",
      "log.kind.load": "LOAD",
      "log.kind.info": "CPU",
      "log.kind.error": "ERRO",
      "log.kind.sys": "SISTEMA",
      "stack.label.ia32": "STACK  ESP/EBP",
      "stack.label.x64": "STACK  RSP/RBP",
      "stack.cfg.toggle.title": "Configurações da stack",
      "stack.cfg.toggle.btn": "CFG",
      "stack.cfg.header": "CONFIGURAÇÃO DA STACK",
      "stack.cfg.size.label": "Tamanho",
      "stack.cfg.size.bytes": "Bytes",
      "stack.cfg.size.kb": "KB",
      "stack.cfg.size.apply": "Aplicar",
      "stack.cfg.mode.label": "Modo",
      "stack.cfg.mode.full": "FULL",
      "stack.cfg.mode.frame": "FRAME",
      "stack.cfg.gran.label": "Granularidade",
      "stack.cfg.gran.byte": "Byte",
      "stack.cfg.gran.word": "Word",
      "stack.cfg.gran.dword": "DWord",
      "stack.cfg.gran.qword": "QWord",
      "resize.sidebar": "Arraste para ajustar a largura da coluna esquerda",
      "resize.section": "Arraste para ajustar a altura desta seção",
      "resize.codemem": "Arraste para ajustar a largura entre mapa e listagens",
      "resize.stack": "Arraste para ajustar a largura da stack",
      "ui.reg.edit.title": "Clique para editar",
      "ui.reg.picker.title": "Clique para editar",
      "ui.stack.row.title": "Clique para localizar no mapa de memoria · 2× clique para editar",
      "ui.section.collapse": "Minimizar seção",
      "ui.section.expand": "Expandir seção",
      "ui.asm.valid": "Instrucao valida ({0} byte(s))",
      "ui.asm.write.title": "Grava bytes no PC atual. Enter para confirmar.",
      "help.modal.title": "GUIA DE ENDIANNESS",
      "help.tab.intro": "Introdução",
      "help.tab.little": "Little Endian",
      "help.tab.big": "Big Endian",
      "help.tab.ops": "Operações",
      "help.intro": "<h3>O QUE É ENDIANNESS?</h3><p>Endianness define a <strong>ordem dos bytes</strong> na qual um valor multi-byte é armazenado na memória. A questão central é: qual byte vai para o endereço mais baixo?</p><p>Os dois formatos principais são <span class=\"hl\">Little Endian</span> e <span class=\"hl-b\">Big Endian</span>.</p><div class=\"info-box\">💡 O nome vem de \"As Viagens de Gulliver\" — a guerra entre os que quebram o ovo pelo lado pequeno (<em>little-endians</em>) e os que o quebram pelo lado grande (<em>big-endians</em>).</div><p><strong>CPUs x86/x64</strong> (Intel, AMD) → Little Endian<br><strong>Protocolos TCP/IP</strong> → Big Endian (\"network byte order\")<br><strong>ARM</strong> → bi-endian (configurável)</p>",
      "help.little": "<h3>LITTLE ENDIAN</h3><p>O byte <span class=\"hl\">menos significativo (LSB)</span> fica no <strong>menor endereço</strong> de memória.</p><p>Exemplo: valor <span class=\"hl\">0xDEADBEEF</span> a partir de 0x0000:</p><div class=\"mem-diagram\"><div class=\"md-cell md-addr\"></div><div class=\"md-cell md-hdr\">+0</div><div class=\"md-cell md-hdr\">+1</div><div class=\"md-cell md-hdr\">+2</div><div class=\"md-cell md-hdr\">+3</div><div class=\"md-cell md-addr\">0x0000</div><div class=\"md-cell md-lsb\">EF</div><div class=\"md-cell md-mid\">BE</div><div class=\"md-cell md-mid\">AD</div><div class=\"md-cell md-msb\">DE</div></div><p><strong style=\"color:var(--grn)\">EF</strong> (LSB) → 0x0000 &nbsp;|&nbsp; <strong style=\"color:var(--blu)\">DE</strong> (MSB) → 0x0003</p><div class=\"info-box\">✓ Usado por: x86, x64, ARM (padrão), RISC-V<br>✓ Vantagem: extensão de inteiros sem alterar o endereço base</div>",
      "help.big": "<h3>BIG ENDIAN</h3><p>O byte <span class=\"hl-b\">mais significativo (MSB)</span> fica no <strong>menor endereço</strong> de memória.</p><p>Exemplo: valor <span class=\"hl-b\">0xDEADBEEF</span> a partir de 0x0000:</p><div class=\"mem-diagram\"><div class=\"md-cell md-addr\"></div><div class=\"md-cell md-hdr\">+0</div><div class=\"md-cell md-hdr\">+1</div><div class=\"md-cell md-hdr\">+2</div><div class=\"md-cell md-hdr\">+3</div><div class=\"md-cell md-addr\">0x0000</div><div class=\"md-cell md-msb\">DE</div><div class=\"md-cell md-mid\">AD</div><div class=\"md-cell md-mid\">BE</div><div class=\"md-cell md-lsb\">EF</div></div><p><strong style=\"color:var(--blu)\">DE</strong> (MSB) → 0x0000 &nbsp;|&nbsp; <strong style=\"color:var(--grn)\">EF</strong> (LSB) → 0x0003</p><div class=\"info-box\">✓ Usado por: SPARC, PowerPC, TCP/IP<br>✓ No simulador: modo comparativo/visual; a execução Intel real continua little-endian</div>",
      "help.ops": "<h3>OPERAÇÕES</h3><p><span class=\"hl\">STORE</span> — Grava o valor do registrador na memória, byte a byte. O nibble sendo enviado fica destacado e um pacote animado voa até a célula de memória.</p><p><span class=\"hl-b\">LOAD</span> — Lê bytes da memória para o registrador. O registrador começa em zero e é preenchido byte a byte em tempo real — você vê o valor se construindo!</p><p><span style=\"color:var(--amb)\">STEP</span> — Executa o ciclo completo <strong>FETCH → DECODE → EXECUTE</strong>, atualizando PC, registradores, memória e stack conforme a instrução.</p><p><span style=\"color:var(--red)\">CLEAR</span> — Reinicia memória e registradores.</p><div class=\"info-box\">💡 Clique em qualquer célula de memória para selecionar aquele endereço.<br>💡 Em IA-32 as transferências usam DWORD; em x64 usam QWORD.<br>💡 Reduza a velocidade para acompanhar cada byte com calma.<br>💡 Salve 💾 e carregue 📂 simulações para compartilhar.</div>",
      "log.sys.stack_size": "Tamanho da stack ajustado para {0}. {1} reiniciados em 0x{2}. Mapa de memoria agora cobre 0x0000..0x{3}.",
      "log.sys.pc_manual": "PC definido manualmente: 0x{0}",
      "log.sys.stack_located": "Stack 0x{0} localizada no mapa de memoria.",
      "log.sys.pc_moved": "PC movido para a listagem de codigo 0x{0}",
      "log.sys.demo_loaded": "Simulador iniciado com programa demo {0}: main + 2 funcoes que usam a stack.",
      "log.sys.demo_arch": "Programa demo {0} carregado em 0x0000: main + 2 funcoes com uso de stack.",
      "log.sys.reg_set": "{0} ← 0x{1}",
      "log.sys.mem_edit": "[0x{0}] ← 0x{1} (edição manual)",
      "log.sys.asm_edit": "ASM editado em 0x{0}: \"{1}\"",
      "log.sys.nop_fill": "Bytes restantes em 0x{0}..0x{1} preenchidos com NOP.",
      "log.sys.format": "Formato: {0} endian",
      "log.sys.reg_selected": "Registrador {0} selecionado",
      "log.sys.arch": "Arquitetura: {0}",
      "log.sys.step_start": "STEP em 0x{0} — ciclo completo da instrução atual.",
      "log.sys.step_done": "STEP concluído — {0} agora aponta para 0x{1}.",
      "log.sys.bp_hit": "BP #{0} atingido em 0x{1}.",
      "log.sys.demo_reset": "Reiniciado com programa demo.",
      "log.sys.sim_saved": "Simulação salva.",
      "log.sys.sim_loaded": "Simulação carregada.",
      "log.store.start": "STORE {0}=0x{1} → [0x{2}] ({3}, execucao Intel little-endian; visualizacao {4})",
      "log.store.byte": "  [0x{0}] ← 0x{1}  (byte {2}/{3})",
      "log.store.done": "STORE completo em {0}ms",
      "log.store.exec_ok": "EXEC OK: {0}",
      "log.load.start": "LOAD [0x{0}] → {1} ({2}, execucao Intel little-endian; visualizacao {3})",
      "log.load.byte": "  {0}[+{1}] ← [0x{2}]=0x{3}  → {0}=0x{4}",
      "log.load.done": "LOAD completo: {0}=0x{1} em {2}ms",
      "log.info.fetch1": "FETCH  IP=0x{0} | opcode=0x{1} | {2} byte(s) · Intel SDM Vol.1 §6.3",
      "log.info.fetch2": "FETCH  IP ← 0x{0}  (incrementado durante o fetch, Intel SDM Vol.1 §6.3)",
      "log.info.decode": "DECODE → {0}",
      "log.info.fetch_desc": "Busca {0} byte(s) em 0x{1} e carrega a instrução no registrador de instrução.",
      "log.info.fetch_ip": "{0} avança para 0x{1} após o FETCH, antes do efeito da instrução.",
      "log.info.decode_desc": "Os bytes buscados são decodificados como {0}.",
      "log.info.execute_desc": "Aplica os efeitos arquiteturais da instrução decodificada sobre PC, registradores, memória e stack quando necessário.",
      "log.error.addr_range": "Endereço 0x{0} fora do range",
      "log.error.asm_invalid_listing": "ASM inválido na listagem @ 0x{0} — {1}",
      "log.error.asm_grew": "Instrucao em 0x{0} cresceu de {1}B para {2}B e sobrescreveu o fluxo seguinte.",
      "log.error.hlt": "HLT executado. CPU parada.",
      "log.error.cpu_halted": "CPU halted. CLEAR para reiniciar.",
      "log.error.asm_invalid": "ASM inválido em 0x{0} — {1}",
      "log.error.asm_unknown": "ASM: não reconhecido — \"{0}\"",
      "log.error.fail": "Falha: {0}",
      "log.push": "PUSH {0}=0x{1}: {2} decrementa para 0x{3} e o dado segue para o topo da pilha [0x{3}].",
      "log.pop": "POP [0x{0}] → {1}: o dado sai do topo da pilha e {2} sera incrementado apos a leitura.",
      "status.demo_loaded": "Programa demo carregado — main em 0x0000",
      "status.demo_arch": "Programa demo {0} carregado — PC em 0x0000",
      "status.asm_invalid": "ASM inválido em 0x{0} — {1}",
      "status.asm_invalid_short": "ASM inválido — {0}",
      "status.store_start": "STORE: gravando {0} byte(s) em [0x{1}]...",
      "status.store_done": "STORE concluído — {0}ms",
      "status.load_start": "LOAD: lendo {0} byte(s) de [0x{1}]...",
      "status.load_done": "LOAD concluído: {0}=0x{1} — {2}ms",
      "status.fetch1": "FETCH: IP=0x{0} → lendo {1} byte(s) → IR",
      "status.fetch2": "FETCH: IP atualizado → 0x{0}  (instrução no IR)",
      "status.fetch_short": "FETCH  IP=0x{0} | {1}B → IR",
      "status.decode": "DECODE: {0}",
      "status.fetch_decode_done": "FETCH+DECODE concluído — IP = 0x{0}",
      "status.hlt": "HLT — CPU parada",
      "status.execute": "EXECUTE: {0}",
      "status.execute_done": "EXECUTE concluído — IP = 0x{0}",
      "status.execute_revert": "EXECUTE: {0} — revertendo",
      "status.decode_revert": "DECODE: {0} — revertendo",
      "status.fetch_revert": "FETCH  IP=0x{0} — revertendo",
      "status.back_done": "BACK concluído — IP = 0x{0}",
      "status.push_start": "PUSH: {0} → topo da pilha [0x{1}]",
      "status.push_done": "PUSH concluído — {0}=0x{1}",
      "status.pop_start": "POP: topo da pilha [0x{0}] → {1}",
      "status.pop_done": "POP concluído — {0}=0x{1}",
      "status.demo_reset": "Programa demo restaurado — PC em 0x0000"
    },
    'en-US': {
      "page.title": "Intel x86/x64 Memory & Stack Lab",
      "topbar.subtitle": "Didactic simulator of memory, registers and stack",
      "topbar.pc.title": "Edit PC manually",
      "topbar.btn.help": "Help / Tutorial",
      "topbar.btn.save": "Save simulation",
      "topbar.btn.load": "Load simulation",
      "topbar.chip.lastop": "LAST OP",
      "topbar.chip.ops": "OPS",
      "topbar.chip.arch": "ARCH",
      "topbar.chip.pc": "PC",
      "sidebar.arch.label": "ARCHITECTURE",
      "sidebar.arch.ia32.name": "IA-32",
      "sidebar.arch.ia32.sub": "32-bit · EAX..EDI",
      "sidebar.arch.x64.name": "x86-64",
      "sidebar.arch.x64.sub": "64-bit · RAX..R15",
      "sidebar.endian.label": "ENDIANNESS (EXPERIMENTAL)",
      "sidebar.endian.little.name": "LITTLE",
      "sidebar.endian.little.sub": "LSB first",
      "sidebar.endian.big.name": "BIG",
      "sidebar.endian.big.sub": "MSB first",
      "sidebar.endian.hint.little": "← least significant byte (LSB)",
      "sidebar.endian.hint.big": "← most significant byte (MSB)",
      "sidebar.reg.label": "REGISTER",
      "sidebar.speed.label": "SPEED",
      "sidebar.speed.fast": "FAST",
      "sidebar.speed.slow": "SLOW",
      "editguide.title": "QUICK EDIT",
      "editguide.hint1": "Click on <strong>PC</strong> and <strong>register values</strong> to edit. Use <strong>double-click</strong> on the <strong>MEMORY MAP</strong> to edit bytes.",
      "editguide.hint2": "Edit the program directly in the <strong>ASM LISTING</strong> with <strong>double-click</strong> on any instruction.",
      "regs.gp.label": "GENERAL PURPOSE REGISTERS",
      "regs.ext.label": "R8 — R15  (x86-64)",
      "regs.sp.label": "STACK POINTERS",
      "ctrlbar.cpu.title": "CPU",
      "ctrlbar.speed.title": "SPEED",
      "ctrlbar.speed.fast": "FAST",
      "ctrlbar.speed.slow": "SLOW",
      "ctrlbar.mem.title": "MEMORY",
      "ctrlbar.btn.step": "STEP",
      "ctrlbar.btn.run": "RUN",
      "ctrlbar.btn.clear": "CLEAR",
      "ctrlbar.btn.pause": "PAUSE",
      "ctrlbar.btn.stop": "STOP",
      "ctrlbar.btn.back": "BACK",
      "ctrlbar.btn.resume": "RESUME",
      "ctrlbar.btn.next": "NEXT",
      "ctrlbar.btn.store": "STORE",
      "ctrlbar.btn.load": "LOAD",
      "ctrlbar.btn.push": "PUSH",
      "ctrlbar.btn.pop": "POP",
      "mem.section.label": "MEMORY MAP",
      "mem.addrdir": "0x{0}..0x{1} · grows ↓",
      "mem.legend.active": "Active",
      "mem.legend.written": "Written",
      "mem.legend.fetch": "Fetch",
      "mem.legend.bp": "BP",
      "mem.cell.title": "Address 0x{0} · Shift+Click for breakpoint",
      "mem.bp.section": "BREAKPOINTS",
      "mem.bp.none": "No breakpoints defined",
      "mem.bp.clr.title": "Clear all breakpoints",
      "mem.bp.clr.btn": "CLEAR",
      "asm.section.label": "CODE LISTINGS",
      "asm.trace.head.asm": "ASM LISTING",
      "asm.trace.head.pseudo": "PSEUDO-CODE",
      "asm.hint.placeholder.ia32": "MOV EAX, 0x1234",
      "asm.hint.placeholder.x64": "MOV RAX, 0x1234",
      "asm.bp.set": "Click to set breakpoint",
      "asm.bp.remove": "BP #{0} — click to remove",
      "asm.nav.title": "Click to navigate · double-click to edit",
      "asm.pseudocode.title": "Click to navigate",
      "log.section.label": "OPERATIONS LOG",
      "log.clear.btn": "clear",
      "log.kind.step": "STEP",
      "log.kind.store": "STORE",
      "log.kind.load": "LOAD",
      "log.kind.info": "CPU",
      "log.kind.error": "ERROR",
      "log.kind.sys": "SYSTEM",
      "stack.label.ia32": "STACK  ESP/EBP",
      "stack.label.x64": "STACK  RSP/RBP",
      "stack.cfg.toggle.title": "Stack settings",
      "stack.cfg.toggle.btn": "CFG",
      "stack.cfg.header": "STACK CONFIGURATION",
      "stack.cfg.size.label": "Size",
      "stack.cfg.size.bytes": "Bytes",
      "stack.cfg.size.kb": "KB",
      "stack.cfg.size.apply": "Apply",
      "stack.cfg.mode.label": "Mode",
      "stack.cfg.mode.full": "FULL",
      "stack.cfg.mode.frame": "FRAME",
      "stack.cfg.gran.label": "Granularity",
      "stack.cfg.gran.byte": "Byte",
      "stack.cfg.gran.word": "Word",
      "stack.cfg.gran.dword": "DWord",
      "stack.cfg.gran.qword": "QWord",
      "resize.sidebar": "Drag to adjust left column width",
      "resize.section": "Drag to adjust section height",
      "resize.codemem": "Drag to adjust width between map and listings",
      "resize.stack": "Drag to adjust stack width",
      "ui.reg.edit.title": "Click to edit",
      "ui.reg.picker.title": "Click to edit",
      "ui.stack.row.title": "Click to locate in memory map · double-click to edit",
      "ui.section.collapse": "Minimize section",
      "ui.section.expand": "Expand section",
      "ui.asm.valid": "Valid instruction ({0} byte(s))",
      "ui.asm.write.title": "Writes bytes at current PC. Press Enter to confirm.",
      "help.modal.title": "ENDIANNESS GUIDE",
      "help.tab.intro": "Introduction",
      "help.tab.little": "Little Endian",
      "help.tab.big": "Big Endian",
      "help.tab.ops": "Operations",
      "help.intro": "<h3>WHAT IS ENDIANNESS?</h3><p>Endianness defines the <strong>byte order</strong> in which a multi-byte value is stored in memory. The central question is: which byte goes to the lowest address?</p><p>The two main formats are <span class=\"hl\">Little Endian</span> and <span class=\"hl-b\">Big Endian</span>.</p><div class=\"info-box\">💡 The name comes from \"Gulliver's Travels\" — the war between those who break eggs from the small end (<em>little-endians</em>) and those who break from the big end (<em>big-endians</em>).</div><p><strong>x86/x64 CPUs</strong> (Intel, AMD) → Little Endian<br><strong>TCP/IP Protocols</strong> → Big Endian (\"network byte order\")<br><strong>ARM</strong> → bi-endian (configurable)</p>",
      "help.little": "<h3>LITTLE ENDIAN</h3><p>The <span class=\"hl\">least significant byte (LSB)</span> goes to the <strong>lowest address</strong> in memory.</p><p>Example: value <span class=\"hl\">0xDEADBEEF</span> starting at 0x0000:</p><div class=\"mem-diagram\"><div class=\"md-cell md-addr\"></div><div class=\"md-cell md-hdr\">+0</div><div class=\"md-cell md-hdr\">+1</div><div class=\"md-cell md-hdr\">+2</div><div class=\"md-cell md-hdr\">+3</div><div class=\"md-cell md-addr\">0x0000</div><div class=\"md-cell md-lsb\">EF</div><div class=\"md-cell md-mid\">BE</div><div class=\"md-cell md-mid\">AD</div><div class=\"md-cell md-msb\">DE</div></div><p><strong style=\"color:var(--grn)\">EF</strong> (LSB) → 0x0000 &nbsp;|&nbsp; <strong style=\"color:var(--blu)\">DE</strong> (MSB) → 0x0003</p><div class=\"info-box\">✓ Used by: x86, x64, ARM (default), RISC-V<br>✓ Advantage: integer extension without changing the base address</div>",
      "help.big": "<h3>BIG ENDIAN</h3><p>The <span class=\"hl-b\">most significant byte (MSB)</span> goes to the <strong>lowest address</strong> in memory.</p><p>Example: value <span class=\"hl-b\">0xDEADBEEF</span> starting at 0x0000:</p><div class=\"mem-diagram\"><div class=\"md-cell md-addr\"></div><div class=\"md-cell md-hdr\">+0</div><div class=\"md-cell md-hdr\">+1</div><div class=\"md-cell md-hdr\">+2</div><div class=\"md-cell md-hdr\">+3</div><div class=\"md-cell md-addr\">0x0000</div><div class=\"md-cell md-msb\">DE</div><div class=\"md-cell md-mid\">AD</div><div class=\"md-cell md-mid\">BE</div><div class=\"md-cell md-lsb\">EF</div></div><p><strong style=\"color:var(--blu)\">DE</strong> (MSB) → 0x0000 &nbsp;|&nbsp; <strong style=\"color:var(--grn)\">EF</strong> (LSB) → 0x0003</p><div class=\"info-box\">✓ Used by: SPARC, PowerPC, TCP/IP<br>✓ In the simulator: comparative/visual mode; real Intel execution remains little-endian</div>",
      "help.ops": "<h3>OPERATIONS</h3><p><span class=\"hl\">STORE</span> — Writes the register value to memory, byte by byte. The nibble being sent is highlighted and an animated packet flies to the memory cell.</p><p><span class=\"hl-b\">LOAD</span> — Reads bytes from memory into the register. The register starts at zero and is filled byte by byte in real time — you see the value being built!</p><p><span style=\"color:var(--amb)\">STEP</span> — Executes the full <strong>FETCH → DECODE → EXECUTE</strong> cycle, updating PC, registers, memory and stack per the instruction.</p><p><span style=\"color:var(--red)\">CLEAR</span> — Resets memory and registers.</p><div class=\"info-box\">💡 Click any memory cell to select that address.<br>💡 In IA-32 transfers use DWORD; in x64 they use QWORD.<br>💡 Slow down to follow each byte carefully.<br>💡 Save 💾 and load 📂 simulations to share.</div>",
      "log.sys.stack_size": "Stack size adjusted to {0}. {1} reset at 0x{2}. Memory map now covers 0x0000..0x{3}.",
      "log.sys.pc_manual": "PC set manually: 0x{0}",
      "log.sys.stack_located": "Stack 0x{0} located in memory map.",
      "log.sys.pc_moved": "PC moved to code listing 0x{0}",
      "log.sys.demo_loaded": "Simulator started with {0} demo program: main + 2 functions using the stack.",
      "log.sys.demo_arch": "{0} demo program loaded at 0x0000: main + 2 functions with stack usage.",
      "log.sys.reg_set": "{0} ← 0x{1}",
      "log.sys.mem_edit": "[0x{0}] ← 0x{1} (manual edit)",
      "log.sys.asm_edit": "ASM edited at 0x{0}: \"{1}\"",
      "log.sys.nop_fill": "Remaining bytes at 0x{0}..0x{1} filled with NOP.",
      "log.sys.format": "Format: {0} endian",
      "log.sys.reg_selected": "Register {0} selected",
      "log.sys.arch": "Architecture: {0}",
      "log.sys.step_start": "STEP at 0x{0} — full cycle of the current instruction.",
      "log.sys.step_done": "STEP done — {0} now points to 0x{1}.",
      "log.sys.bp_hit": "BP #{0} hit at 0x{1}.",
      "log.sys.demo_reset": "Reset with demo program.",
      "log.sys.sim_saved": "Simulation saved.",
      "log.sys.sim_loaded": "Simulation loaded.",
      "log.store.start": "STORE {0}=0x{1} → [0x{2}] ({3}, Intel little-endian execution; display {4})",
      "log.store.byte": "  [0x{0}] ← 0x{1}  (byte {2}/{3})",
      "log.store.done": "STORE complete in {0}ms",
      "log.store.exec_ok": "EXEC OK: {0}",
      "log.load.start": "LOAD [0x{0}] → {1} ({2}, Intel little-endian execution; display {3})",
      "log.load.byte": "  {0}[+{1}] ← [0x{2}]=0x{3}  → {0}=0x{4}",
      "log.load.done": "LOAD complete: {0}=0x{1} in {2}ms",
      "log.info.fetch1": "FETCH  IP=0x{0} | opcode=0x{1} | {2} byte(s) · Intel SDM Vol.1 §6.3",
      "log.info.fetch2": "FETCH  IP ← 0x{0}  (incremented during fetch, Intel SDM Vol.1 §6.3)",
      "log.info.decode": "DECODE → {0}",
      "log.info.fetch_desc": "Fetches {0} byte(s) at 0x{1} and loads the instruction into the instruction register.",
      "log.info.fetch_ip": "{0} advances to 0x{1} after FETCH, before the instruction takes effect.",
      "log.info.decode_desc": "The fetched bytes are decoded as {0}.",
      "log.info.execute_desc": "Applies the architectural effects of the decoded instruction on PC, registers, memory and stack as needed.",
      "log.error.addr_range": "Address 0x{0} out of range",
      "log.error.asm_invalid_listing": "Invalid ASM in listing @ 0x{0} — {1}",
      "log.error.asm_grew": "Instruction at 0x{0} grew from {1}B to {2}B and overwrote the following flow.",
      "log.error.hlt": "HLT executed. CPU halted.",
      "log.error.cpu_halted": "CPU halted. CLEAR to restart.",
      "log.error.asm_invalid": "Invalid ASM at 0x{0} — {1}",
      "log.error.asm_unknown": "ASM: unrecognized — \"{0}\"",
      "log.error.fail": "Failure: {0}",
      "log.push": "PUSH {0}=0x{1}: {2} decrements to 0x{3} and the data goes to the stack top [0x{3}].",
      "log.pop": "POP [0x{0}] → {1}: data leaves stack top and {2} will be incremented after the read.",
      "status.demo_loaded": "Demo program loaded — main at 0x0000",
      "status.demo_arch": "{0} demo program loaded — PC at 0x0000",
      "status.asm_invalid": "Invalid ASM at 0x{0} — {1}",
      "status.asm_invalid_short": "Invalid ASM — {0}",
      "status.store_start": "STORE: writing {0} byte(s) to [0x{1}]...",
      "status.store_done": "STORE done — {0}ms",
      "status.load_start": "LOAD: reading {0} byte(s) from [0x{1}]...",
      "status.load_done": "LOAD done: {0}=0x{1} — {2}ms",
      "status.fetch1": "FETCH: IP=0x{0} → reading {1} byte(s) → IR",
      "status.fetch2": "FETCH: IP updated → 0x{0}  (instruction in IR)",
      "status.fetch_short": "FETCH  IP=0x{0} | {1}B → IR",
      "status.decode": "DECODE: {0}",
      "status.fetch_decode_done": "FETCH+DECODE done — IP = 0x{0}",
      "status.hlt": "HLT — CPU halted",
      "status.execute": "EXECUTE: {0}",
      "status.execute_done": "EXECUTE done — IP = 0x{0}",
      "status.execute_revert": "EXECUTE: {0} — reverting",
      "status.decode_revert": "DECODE: {0} — reverting",
      "status.fetch_revert": "FETCH  IP=0x{0} — reverting",
      "status.back_done": "BACK done — IP = 0x{0}",
      "status.push_start": "PUSH: {0} → stack top [0x{1}]",
      "status.push_done": "PUSH done — {0}=0x{1}",
      "status.pop_start": "POP: stack top [0x{0}] → {1}",
      "status.pop_done": "POP done — {0}=0x{1}",
      "status.demo_reset": "Demo program restored — PC at 0x0000"
    },
  };

  const LOCALE_STORAGE_KEY = 'intel_sim_locale';
  const DEFAULT_LOCALE = 'pt-BR';

  let _strings = {};
  let _current = DEFAULT_LOCALE;

  // ── Interpolação: t('chave', arg0, arg1, ...) ──────────────────────────────
  function t(key, ...args) {
    const raw = _strings[key];
    if (raw === undefined) {
      // Fallback silencioso para pt-BR; warn só em dev
      const fallback = LOCALE_DATA[DEFAULT_LOCALE]?.[key];
      if (fallback !== undefined) return interpolate(fallback, args);
      return key;
    }
    return interpolate(raw, args);
  }

  function interpolate(str, args) {
    if (!args.length) return str;
    return str.replace(/\{(\d+)\}/g, (_, i) => {
      const v = args[Number(i)];
      return v !== undefined ? v : `{${i}}`;
    });
  }

  // ── Aplica traduções a todos os elementos data-i18n* no DOM ─────────────────
  function applyDOM(root = document) {
    root.querySelectorAll('[data-i18n]').forEach(el => {
      const k = el.getAttribute('data-i18n');
      if (_strings[k] !== undefined) el.textContent = _strings[k];
    });
    root.querySelectorAll('[data-i18n-html]').forEach(el => {
      const k = el.getAttribute('data-i18n-html');
      if (_strings[k] !== undefined) el.innerHTML = _strings[k];
    });
    root.querySelectorAll('[data-i18n-title]').forEach(el => {
      const k = el.getAttribute('data-i18n-title');
      if (_strings[k] !== undefined) el.title = _strings[k];
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const k = el.getAttribute('data-i18n-placeholder');
      if (_strings[k] !== undefined) el.placeholder = _strings[k];
    });
  }

  // ── Carrega um locale (síncrono — dados já embutidos) ───────────────────────
  function load(code) {
    const data = LOCALE_DATA[code];
    if (!data) {
      console.error(`[i18n] Locale "${code}" not found.`);
      return false;
    }
    _strings = data;
    _current = code;
    document.documentElement.lang = code;
    if (_strings['page.title']) document.title = _strings['page.title'];
    localStorage.setItem(LOCALE_STORAGE_KEY, code);
    return true;
  }

  // ── Inicialização ───────────────────────────────────────────────────────────
  function init() {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    const browser = navigator.language;
    const codes = AVAILABLE_LOCALES.map(l => l.code);

    const candidate =
      (saved && codes.includes(saved) ? saved : null) ||
      (codes.includes(browser) ? browser : null) ||
      (codes.find(c => c.startsWith(browser.split('-')[0])) ?? null) ||
      DEFAULT_LOCALE;

    load(candidate);
    applyDOM();
    _syncLangSwitcher();
  }

  // ── Troca de idioma em tempo real ──────────────────────────────────────────
  function setLocale(code) {
    if (code === _current) return;
    const ok = load(code);
    if (ok) {
      applyDOM();
      _syncLangSwitcher();
      document.dispatchEvent(new CustomEvent('i18n:changed', { detail: { locale: code } }));
    }
  }

  function _syncLangSwitcher() {
    const sel = document.getElementById('langSwitcher');
    if (sel) sel.value = _current;
  }

  // ── API pública ─────────────────────────────────────────────────────────────
  return {
    t, init, load, setLocale, applyDOM,
    get current() { return _current; },
    get locales() { return AVAILABLE_LOCALES; },
  };
})();

// Atalho global para uso em app.js
function t(key, ...args) { return I18N.t(key, ...args); }
