# Intel x86/x64 Memory & Stack Lab

Simulador visual interativo de memoria, registradores, stack e execucao de instrucoes para arquiteturas Intel IA-32 e x86-64. A execucao segue little-endian; existe um toggle `BIG/LITTLE` experimental apenas para fins comparativos/visuais.

Auditoria tecnica e escopo validado: [INTEL_SUBSET_AUDIT.md](INTEL_SUBSET_AUDIT.md)

---

## Opcao 1: Use online

https://psylinux.github.io/intel-simulator/

## Opcao 2: Rode localmente

```bash
# Windows: clique duplo em index.html
# Mac/Linux:
open index.html

# OU servir via Python:
python3 -m http.server 8080
# Acesse: http://localhost:8080
```

---

## Features (v0.1)

### Arquitetura e CPU
- Suporte a **IA-32** e **x86-64** com conjunto de registradores dinamico
- Registradores de uso geral: EAX/RAX, EBX/RBX, ECX/RCX, EDX/RDX, ESI/RSI, EDI/RDI, ESP/RSP, EBP/RBP
- Registrador de instrucao (EIP/RIP) atualizado a cada passo
- Flags de CPU: ZF, SF, CF, OF, PF

### Assembler e Execucao
- Editor de assembly inline com syntax highlighting
- Assembler proprio para o subset Intel implementado
- Modos de execucao: **FETCH**, **STEP** (instrucao a instrucao) e **RUN** (continuo com velocidade ajustavel)
- Halt automatico em erros de bounds de stack

### Instrucoes suportadas
- Movimentacao: `MOV`, `XCHG`
- Aritmetica: `ADD`, `SUB`, `INC`, `DEC`, `MUL`, `IMUL`, `DIV`, `IDIV`, `NEG`
- Logica: `AND`, `OR`, `XOR`, `NOT`, `SHL`, `SHR`
- Controle de fluxo: `JMP`, `JE`, `JNE`, `JL`, `JLE`, `JG`, `JGE`, `CALL`, `RET`
- Stack: `PUSH`, `POP`
- Outros: `NOP`, `HLT`, `CMP`, `TEST`

### Memoria
- Espaco de memoria dedicado com visualizacao celula a celula
- Stack memory separada com tamanho configuravel (B ou KB)
- Animacoes byte a byte para operacoes STORE e LOAD
- Highlight de celulas ativas durante operacoes de memoria e stack
- Exibicao dos bytes de cada instrucao como chips individuais

### Backtrace e Call Frames
- **BACKTRACE** visual com pilha de chamadas (cresce para cima, como uma pilha de pratos)
- Rastreamento de call frames com enderecos de retorno, slots de stack e site de chamada
- Identificacao visual por cor: enderecos de retorno em **vermelho**, pseudo-instrucoes em **roxo**
- Profundidade maxima de 9 frames rastreados

### Interface
- Layout com paineis redimensionaveis (sidebar, stack, trace, memoria)
- Assembly trace com scroll automatico para a instrucao atual
- Animacoes de transferencia de dados entre registradores byte a byte
- Highlight de registradores alterados apos cada instrucao
- Visualizacao pseudo-codigo (C-like) para cada instrucao
- Salvar/carregar simulacoes como JSON
- Versionamento com cache busting automatico

---

## Estrutura

```
intel-simulator/
├── index.html              <- Interface HTML
├── css/style.css           <- Estilos
├── js/app.js               <- Logica completa do simulador
├── INTEL_SUBSET_AUDIT.md   <- Auditoria do subset implementado
└── README.md
```
