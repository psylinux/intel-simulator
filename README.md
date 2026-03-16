# MEM·SIM — Memory Endianness Simulator

Simulador visual interativo de armazenamento em memória com animações byte a byte, suporte a Little Endian e Big Endian, e interface de estilo blueprint técnico.

---
## Abra direto no navegador

```bash
# Abrir o arquivo index.html diretamente:
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
