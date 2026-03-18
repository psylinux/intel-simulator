# Intel x86/x64 Memory & Stack Lab

Simulador visual interativo de memória, registradores, stack e execução de instruções para arquiteturas Intel IA-32 e x86-64. A execução segue little-endian; existe um toggle `BIG/LITTLE` experimental apenas para fins comparativos/visuais.

Auditoria técnica e escopo validado: [INTEL_SUBSET_AUDIT.md](INTEL_SUBSET_AUDIT.md)

---

## Opção 1: Use online

https://psylinux.github.io/intel-simulator/

## Opção 2: Rode localmente

```bash
# Windows: clique duplo em index.html
# Mac/Linux:
open index.html

# OU servir via Python:
python3 -m http.server 8080
# Acesse: http://localhost:8080
```

## Testes

```bash
npm test
```

Para rodar só a suíte de breakpoint/regressão:

```bash
npm run test:breakpoint
```

---

## Funcionalidades (v0.1)

### Arquitetura e CPU
- Suporte a **IA-32** e **x86-64** com conjunto de registradores dinâmico
- Registradores de uso geral: EAX/RAX, EBX/RBX, ECX/RCX, EDX/RDX, ESI/RSI, EDI/RDI, ESP/RSP, EBP/RBP
- Registrador de instrução (EIP/RIP) atualizado a cada passo
- Flags de CPU: ZF, SF, CF, OF, PF

### Assembler e Execução
- Editor de assembly inline com destaque de sintaxe
- Assembler próprio para o subset Intel implementado
- Modos de execução: **FETCH**, **STEP** (instrução a instrução) e **RUN** (contínuo com velocidade ajustável)
- Halt automático em erros de bounds de stack

### Instruções suportadas
- Movimentação: `MOV`, `XCHG`
- Aritmética: `ADD`, `SUB`, `INC`, `DEC`, `MUL`, `IMUL`, `DIV`, `IDIV`, `NEG`
- Lógica: `AND`, `OR`, `XOR`, `NOT`, `SHL`, `SHR`
- Controle de fluxo: `JMP`, `JE`, `JNE`, `JL`, `JLE`, `JG`, `JGE`, `CALL`, `RET`
- Stack: `PUSH`, `POP`
- Outros: `NOP`, `HLT`, `CMP`, `TEST`

### Memória
- Espaço de memória dedicado com visualização célula a célula
- Stack memory separada com tamanho configurável (B ou KB)
- Animações byte a byte para operações STORE e LOAD
- Highlight de células ativas durante operações de memória e stack
- Exibição dos bytes de cada instrução como chips individuais

### Backtrace e Call Frames
- **BACKTRACE** visual com pilha de chamadas (cresce para cima, como uma pilha de pratos)
- Rastreamento de call frames com endereços de retorno, slots de stack e site de chamada
- Identificação visual por cor: endereços de retorno em **vermelho**, pseudo-instruções em **roxo**
- Profundidade máxima de 9 frames rastreados

### Interface
- Layout com painéis redimensionáveis (sidebar, stack, trace, memória)
- Assembly trace com scroll automático para a instrução atual
- Animações de transferência de dados entre registradores byte a byte
- Highlight de registradores alterados após cada instrução
- Visualização pseudo-código (C-like) para cada instrução
- Salvar/carregar simulações como JSON
- Versionamento com cache busting automático

---

## Estrutura

```
intel-simulator/
├── index.html              <- Interface HTML
├── css/style.css           <- Estilos
├── js/app.js               <- Lógica completa do simulador
├── INTEL_SUBSET_AUDIT.md   <- Auditoria do subset implementado
└── README.md
```
