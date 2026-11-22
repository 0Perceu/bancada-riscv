# Bancada RISC-V

Simulador didático de um processador **RISC-V RV32I**, com dois modelos de execução lado a lado:

- **Monociclo**: a referência. Cada instrução atravessa o caminho de dados em um ciclo.
- **Pipeline de 5 estágios** (IF, ID, EX, MEM, WB): hazards de dados com e sem **forwarding**, bolha de **load-use**, desvios resolvidos em EX com predição "não tomado" e **flush**.

- **Caches L1 de instruções e de dados**, configuráveis (conjuntos, vias, tamanho do bloco, penalidade de falta), com LRU e write-back. Uma falta na I-cache põe bolhas no pipeline; uma falta na D-cache congela o pipeline até o bloco chegar.

A interface tem duas vistas do processador:

- **Bancada**: o pipeline como uma placa isométrica em traço de nanquim. Cada estágio é um chip, as instruções aparecem em etiquetas, os forwardings acendem trilhas e as caches (I$ e D$) acendem em acerto ou falta.
- **Caminho de dados**: todos os componentes da microarquitetura desenhados explicitamente (PC, somador +4, memória de instruções/I-cache, controle, banco de registradores, gerador de imediato, multiplexadores, ALU, somador de desvio, memória de dados/D-cache, mux de write-back, unidade de forwarding, unidade de hazard e os registradores de pipeline IF/ID, ID/EX, EX/MEM, MEM/WB). A cada ciclo acendem os fios usados e aparecem os valores que passam por eles.

Um painel mostra o conteúdo de cada cache (válido, sujo, tag, bloco e dados), a divisão do endereço em tag/índice/deslocamento, a taxa de acerto e o AMAT.

## Rodar com Docker (recomendado para avaliar)

Requisito: [Docker](https://docs.docker.com/get-docker/). Não precisa instalar Node.

```bash
docker compose up --build
# abra http://localhost:8080
```

Ou sem o compose:

```bash
docker build -t bancada-riscv .
docker run --rm -p 8080:80 bancada-riscv
```

O `Dockerfile` tem duas etapas: a primeira instala as dependências, **roda todos os testes** e gera o site; a segunda copia só o site pronto para um nginx. Se algum teste falhar, a imagem não é criada.

## Rodar sem Docker

Requisitos: [Node.js](https://nodejs.org) 20 ou mais recente.

```bash
npm install
npm run dev        # abre em http://localhost:5173
npm test           # testes do núcleo
npm run build      # gera dist/ (site estático, pode ir para o GitHub Pages)
```

## O que tem

| Parte | Onde |
| --- | --- |
| Decodificação RV32I, disassembler | `src/core/isa.ts` |
| Semântica das instruções (compartilhada pelos dois modelos) | `src/core/exec.ts` |
| Montador: rótulos, `.data`/`.text`, `.word`/`.half`/`.byte`/`.space`/`.asciz`, pseudoinstruções (`li`, `la`, `mv`, `j`, `call`, `ret`, `beqz`, `bgt`…), erros com linha | `src/core/assembler.ts` |
| Monociclo | `src/core/single.ts` |
| Pipeline de 5 estágios | `src/core/pipeline.ts` |
| Caches L1 (LRU, write-back, write-allocate) | `src/core/cache.ts` |
| Sessão: histórico para **voltar no tempo** (estado + diário de escritas na memória) | `src/core/session.ts` |
| Trilha de experimentos ("Fig. 01…10") | `src/programs.ts` |
| Bancada isométrica | `src/ui/board.ts` |
| Caminho de dados com todos os componentes | `src/ui/datapath.ts` |
| Interface (SVG gerado por código, sem imagens) | `src/ui/main.ts` |
| Imagem Docker | `Dockerfile`, `docker-compose.yml` |

Mapa de memória: código a partir de `0x0000`, dados a partir de `0x1000`, pilha (`sp`) começa em `0xfff0`. `ecall`, `ebreak` ou uma palavra inválida encerram o programa quando chegam a WB.

## Como sabemos que está certo

- **Codificações conferidas** contra o GNU `as` (`tests/assembler.test.ts`).
- **Temporização** do pipeline verificada caso a caso: N + 4 ciclos sem conflitos, 2 bolhas por dependência sem forwarding, 1 bolha de load-use, 2 instruções descartadas por desvio tomado (`tests/pipeline.test.ts`).
- **Teste diferencial**: 300 programas aleatórios (ALU, loads/stores de todos os tamanhos, desvios) rodam no monociclo e no pipeline com e sem forwarding, e os três precisam terminar com os mesmos registradores e a mesma memória (`tests/differential.test.ts`). Desligar um caminho de forwarding no código faz esse teste falhar na hora.
- **Caches** testadas isoladamente (divisão do endereço, localidade espacial, conflito em mapeamento direto, LRU em 2 vias, write-back) e no pipeline (penalidade exata de uma falta na I-cache e na D-cache). O teste diferencial roda de novo com 4 geometrias de cache diferentes nos dois modelos: a cache só pode mudar o número de ciclos, nunca o resultado (`tests/cache.test.ts`, `tests/differential.test.ts`).
- **Voltar no tempo** testado: voltar até o ciclo 0 restaura registradores, memória e PC byte a byte.

## Atalhos

`→` passo · `←` voltar · `espaço` roda/pausa · `E` vista explodida · `Ctrl+Enter` monta o código do editor.

## Próximos passos

- Predição de desvio configurável (1 bit, 2 bits, BTB) com taxa de acerto.
- Rodar a suíte oficial `riscv-tests` (rv32ui) e programas em C compilados com GCC.
- Tomasulo como terceiro modelo.
