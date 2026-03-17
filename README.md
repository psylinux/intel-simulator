# Intel x86/x64 Memory & Stack Lab

Simulador visual interativo de memoria, registradores e stack para arquiteturas Intel x86/x64. A execucao do subset Intel implementado segue little-endian; o toggle `BIG/LITTLE` existe como modo comparativo/visual da interface.

Auditoria tecnica e escopo validado: [INTEL_SUBSET_AUDIT.md](INTEL_SUBSET_AUDIT.md)

---
## Opção 1: Use online

https://psylinux.github.io/memory-endianness-simulator/


## Opção 2: Faça o download do projeto e rode localmente

```bash
# Windows: clique duplo em index.html
# Mac/Linux:
open index.html

# OU usar Python para servir localmente:
python3 -m http.server 8080
# Acesse: http://localhost:8080
```

---

## 🎮 Como usar

### Painel Esquerdo (controles)

| Controle    | Descrição                                     |
| ----------- | --------------------------------------------- |
| FORMATO     | Alterna entre Little Endian e Big Endian      |
| TAMANHO     | BYTE (8-bit), WORD (16-bit), DWORD (32-bit)   |
| REGISTRADOR | Seleciona EAX, EBX, ECX ou EDX (default: EAX) |
| VALOR       | Digite o valor hex a armazenar                |
| ENDEREÇO    | Endereço de memória destino/fonte             |
| VELOCIDADE  | Ajusta a velocidade da animação               |

### Operações

- **STORE** → Escreve o registrador na memória, byte a byte com animação
- **LOAD** → Lê da memória para o registrador, construindo o valor em tempo real
- **FETCH** → Simula busca de instrução, avança o PC
- **CLEAR** → Reinicia tudo

### Dicas

- Clique em qualquer célula de memória para selecionar aquele endereço
- Use DWORD para ver a diferença completa entre Little e Big Endian
- Reduza a velocidade para acompanhar cada byte individualmente
- O registrador de destino no LOAD vai se preenchendo byte a byte ao vivo
- Salve (💾) e carregue (📂) simulações como arquivos JSON

---

## 📁 Estrutura

```
memsim/
├── index.html          ← Interface HTML
├── css/style.css       ← Estilos (blueprint técnico azul-aço)
├── js/app.js           ← Lógica completa do simulador
└── README.md
```
