# Intel x86/x64 Memory & Stack Lab: auditoria de conformidade do subset Intel

Este documento registra o que foi validado no simulador contra o Intel SDM, quais verificacoes automatizadas existem hoje e quais limites impedem qualquer afirmacao de conformidade total com as arquiteturas Intel x86 e x86-64.

## Escopo realmente validado

O simulador implementa um subset didatico, nao a arquitetura inteira. As validacoes automatizadas cobrem o comportamento deste subset:

- `MOV r32, imm32`
- `MOV r64, imm64` com `REX.W`
- `MOV reg, reg`
- `MOV [mem], reg` e `MOV reg, [mem]` no formato absoluto simplificado `[disp8]`
- `PUSH reg`
- `POP reg`
- `CALL rel32`
- `RET`
- `JMP SHORT rel8`
- `FETCH` com avanço do `IP`/`RIP` para a proxima instrucao
- falhas de `opcode invalido`
- falhas de `decode inconsistente`
- falhas de largura fora do mapa de 64 bytes
- deteccao de `RET` corrompido no modelo didatico de `CALL`/`RET`
- validacao do assembler para o subset suportado

## Regras Intel conferidas

As verificacoes foram alinhadas com as regras relevantes do Intel SDM para o subset acima:

- Ordem de bytes: em Intel x86/x86-64, inteiros multibyte sao armazenados em little-endian; o byte menos significativo vai para o menor endereco.
- `MOV`: copia o operando-fonte para o operando-destino.
- `PUSH`: decrementa o stack pointer e depois grava o operando no topo da pilha.
- `POP`: le o topo da pilha para o destino e so depois incrementa o stack pointer.
- `CALL`: grava o endereco de retorno na pilha e transfere o controle para o destino.
- `RET`: transfere o controle para o endereco de retorno lido no topo da pilha.
- `EIP`/`RIP`: apontam para a proxima instrucao; no simulador, `FETCH` avanca o contador para a instrucao sequencial antes da fase de `DECODE/EXECUTE`.

## Evidencias automatizadas

Arquivo de validacao: [tools/validate-intel-subset.js](tools/validate-intel-subset.js)

O script automatiza testes para:

- semantica little-endian real em `STORE`, `LOAD`, `PUSH`, `POP`, `CALL` e `RET`
- larguras de ponteiro corretas em `IA-32` e `x86-64`
- reconstrução correta de registradores a partir de bytes em memoria
- deteccao de `opcode invalido`, `ModRM` inconsistente, overflow de largura e `RET` corrompido
- mensagens do validador ASM para casos invalidos representativos

Execucao:

```bash
node tools/validate-intel-subset.js
```

**Cobertura atual: 227 testes, 0 falhas.**

## O que ainda impede qualquer alegacao de conformidade total

Mesmo com os testes acima, o simulador nao pode ser descrito como "exato" ou "completamente conforme" a toda a arquitetura Intel x86/x86-64. Os limites principais sao estes:

- implementa apenas um subset pequeno da ISA
- usa um mapa de memoria circular de 64 bytes, o que nao corresponde ao modelo real de enderecamento Intel
- nao modela `FLAGS/EFLAGS/RFLAGS`
- nao modela excecoes, interrupcoes, faults/traps/aborts reais
- nao modela privilegio, `CPL`, anéis, `HLT` privilegiado, `IOPL`, `SMEP/SMAP`, etc.
- nao modela segmentacao, paging, TLB, memoria virtual ou enderecos canonicos
- nao modela operand-size/address-size overrides alem do subset necessario
- simplifica `CALL`/`RET` para um ambiente didatico sem ABI, prologo/epilogo reais ou stack alignment arquitetural
- os comandos standalone `STORE` e `LOAD` sao operacoes pedagogicas da interface, nao instrucoes nativas da ISA Intel

## Referencias Intel usadas

- Intel SDM landing page: https://www.intel.com/content/www/us/en/developer/articles/technical/intel-sdm.html
- Intel 64 and IA-32 Architectures Software Developer's Manual, Volume 1: https://cdrdv2.intel.com/v1/dl/getContent/671436
- Intel 64 and IA-32 Architectures Software Developer's Manual, Volume 2A: https://cdrdv2.intel.com/v1/dl/getContent/671110
- Intel 64 and IA-32 Architectures Software Developer's Manual, Volume 2B: https://cdrdv2.intel.com/v1/dl/getContent/671199

## Conclusao tecnica

Depois desta auditoria, o simulador pode ser descrito de forma precisa assim:

- fiel ao Intel SDM no subset implementado e validado automaticamente
- nao apto a alegar conformidade total com toda a arquitetura x86/x86-64
