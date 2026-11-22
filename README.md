# Bancada RISC-V

Simulador didático de um processador **RISC-V RV32I**, com dois modelos de execução lado a lado:

- **Monociclo**: a referência. Cada instrução atravessa o caminho de dados em um ciclo.
- **Pipeline de 5 estágios** (IF, ID, EX, MEM, WB): hazards de dados com e sem **forwarding**, bolha de **load-use**, desvios resolvidos em EX com predição "não tomado" e **flush**.

A interface desenha o caminho de dados como uma placa isométrica em traço de nanquim. Cada estágio é um chip, as instruções aparecem em etiquetas e os forwardings acendem trilhas na placa.

## Rodar

Requisitos: [Node.js](https://nodejs.org) 20 ou mais recente.

```bash
npm install
npm run dev        # abre em http://localhost:5173
npm test           # testes do núcleo
npm run build      # gera dist/ (site estático, pode ir para o GitHub Pages)
```

### Com Docker

Só precisa do [Docker Desktop](https://www.docker.com/products/docker-desktop/). Na pasta do projeto:

```bash
docker compose up --build    # monta a imagem (roda os testes e o build) e sobe o servidor
```

Abra http://localhost:8080. Para parar: `Ctrl+C` ou `docker compose down`.

Sem o compose, o equivalente é `docker build -t bancada-riscv .` e `docker run -p 8080:80 bancada-riscv`.

A imagem é feita em duas etapas: o Node instala as dependências, roda `npm test` e gera o `dist/` (se um teste falhar, a imagem não é criada); depois só o `dist/` vai para um nginx leve.

## O que tem

| Parte | Onde |
| --- | --- |
| Decodificação RV32I, disassembler | `src/core/isa.ts` |
| Semântica das instruções (compartilhada pelos dois modelos) | `src/core/exec.ts` |
| Montador: rótulos, `.data`/`.text`, `.word`/`.half`/`.byte`/`.space`/`.asciz`, pseudoinstruções (`li`, `la`, `mv`, `j`, `call`, `ret`, `beqz`, `bgt`…), erros com linha | `src/core/assembler.ts` |
| Monociclo | `src/core/single.ts` |
| Pipeline de 5 estágios | `src/core/pipeline.ts` |
| Sessão: histórico para **voltar no tempo** (estado + diário de escritas na memória) | `src/core/session.ts` |
| Trilha de experimentos ("Fig. 01…08") | `src/programs.ts` |
| Interface (SVG isométrico gerado por código, sem imagens) | `src/ui/` |

Mapa de memória: código a partir de `0x0000`, dados a partir de `0x1000`, pilha (`sp`) começa em `0xfff0`. `ecall`, `ebreak` ou uma palavra inválida encerram o programa quando chegam a WB.

## Como sabemos que está certo

- **Codificações conferidas** contra o GNU `as` (`tests/assembler.test.ts`).
- **Temporização** do pipeline verificada caso a caso: N + 4 ciclos sem conflitos, 2 bolhas por dependência sem forwarding, 1 bolha de load-use, 2 instruções descartadas por desvio tomado (`tests/pipeline.test.ts`).
- **Teste diferencial**: 300 programas aleatórios (ALU, loads/stores de todos os tamanhos, desvios) rodam no monociclo e no pipeline com e sem forwarding, e os três precisam terminar com os mesmos registradores e a mesma memória (`tests/differential.test.ts`). Desligar um caminho de forwarding no código faz esse teste falhar na hora.
- **Voltar no tempo** testado: voltar até o ciclo 0 restaura registradores, memória e PC byte a byte.

## Atalhos

`→` passo · `←` voltar · `espaço` roda/pausa · `E` vista explodida · `Ctrl+Enter` monta o código do editor.

## Próximos passos

- Predição de desvio configurável (1 bit, 2 bits, BTB) com taxa de acerto.
- Cache L1 configurável (associatividade, LRU, write-back) com AMAT.
- Rodar a suíte oficial `riscv-tests` (rv32ui) e programas em C compilados com GCC.
- Tomasulo como terceiro modelo.
