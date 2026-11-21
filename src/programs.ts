/** As "figuras" da trilha: cada uma é um experimento com programa e modelo pré-configurados. */
import type { SessionConfig } from './core/session';

export interface Figure {
  id: string;
  group: string;
  title: string;
  subtitle: string;
  tagline: string;
  config: SessionConfig;
  intro: string;
  source: string;
}

const SOMA = `# Soma de 1 a 10 com um laço.
# Resultado: a0 = 55, também gravado em "total".
.data
total:  .word 0

.text
        li   t0, 10          # contador
        li   a0, 0           # acumulador
loop:   add  a0, a0, t0
        addi t0, t0, -1
        bnez t0, loop        # desvio tomado 9 vezes
        la   t1, total
        sw   a0, 0(t1)
        ecall                # fim
`;

const DEPENDENCIAS = `# Cadeia de dependências: cada instrução usa o resultado da anterior.
# Sem forwarding, cada par custa 2 bolhas. Com forwarding, nenhuma.
        li   t0, 5
        addi t1, t0, 1       # precisa de t0
        add  t2, t1, t1      # precisa de t1
        sub  t3, t2, t0      # precisa de t2
        xor  t4, t3, t2      # precisa de t3
        ecall
`;

const LOAD_USE = `# Load-use: mesmo com forwarding, o valor de um lw
# só existe no fim de MEM. A instrução seguinte espera um ciclo.
.data
vetor:  .word 7, 11, 13

.text
        la   s0, vetor
        lw   t0, 0(s0)
        add  t1, t0, t0      # usa t0 logo depois do lw: 1 bolha
        lw   t2, 4(s0)
        nop                  # um nop aqui evita a bolha (o compilador faria isso)
        add  t3, t2, t2
        lw   t4, 8(s0)
        addi t5, zero, 1     # instrução independente também esconde a latência
        add  t6, t4, t5
        ecall
`;

const DESVIOS = `# Desvios: o pipeline aposta em "não tomado".
# Cada desvio tomado descarta as 2 instruções buscadas depois dele.
        li   t0, 0
        li   t1, 4
loop:   addi t0, t0, 1
        blt  t0, t1, loop    # tomado 3 vezes, não tomado 1 vez
        j    fim             # salto sempre tomado: 2 bolhas
        li   t2, 99          # nunca executa
fim:    mv   a0, t0
        ecall
`;

const FIBONACCI = `# Fibonacci: grava os 12 primeiros termos em "fib".
.data
fib:    .space 48

.text
        la   s0, fib
        li   t0, 0           # f(n-2)
        li   t1, 1           # f(n-1)
        li   t3, 12          # quantos termos
loop:   sw   t0, 0(s0)
        add  t2, t0, t1
        mv   t0, t1
        mv   t1, t2
        addi s0, s0, 4
        addi t3, t3, -1
        bnez t3, loop
        ecall
`;

const BUBBLE = `# Bubble sort de 8 números com chamada de função.
.data
v:      .word 42, 7, 19, 3, 88, 25, 1, 60
n:      .word 8

.text
main:   la   a0, v
        la   t0, n
        lw   a1, 0(t0)
        call sort
        ecall

# sort(a0 = endereço, a1 = tamanho)
sort:   addi t0, a1, -1      # i = n - 1
outer:  blez t0, done
        li   t1, 0           # j = 0
        mv   t2, a0          # p = &v[0]
inner:  bge  t1, t0, next
        lw   t3, 0(t2)
        lw   t4, 4(t2)
        ble  t3, t4, noswap
        sw   t4, 0(t2)
        sw   t3, 4(t2)
noswap: addi t1, t1, 1
        addi t2, t2, 4
        j    inner
next:   addi t0, t0, -1
        j    outer
done:   ret
`;

export const FIGURES: Figure[] = [
  {
    id: 'fig01', group: 'Comece aqui', title: 'Monociclo', subtitle: 'uma instrução por ciclo',
    tagline: 'tudo acontece em um único ciclo longo',
    config: { model: 'single', forwarding: true },
    intro: 'No **monociclo**, cada instrução atravessa o caminho de dados inteiro em **um ciclo**. O CPI é sempre 1, mas o período do clock precisa caber a instrução mais lenta (o lw). É a referência de corretude para os outros modelos.',
    source: SOMA,
  },
  {
    id: 'fig02', group: 'Módulo 1 · Pipeline', title: 'Pipeline sem forwarding', subtitle: 'hazards de dados',
    tagline: 'cada dependência espera o WB',
    config: { model: 'pipeline', forwarding: false },
    intro: 'O **pipeline** divide a instrução em 5 estágios e começa uma nova a cada ciclo. Sem **forwarding**, quem depende de um resultado espera em ID até o produtor chegar a WB: **2 bolhas** por dependência imediata.',
    source: DEPENDENCIAS,
  },
  {
    id: 'fig03', group: 'Módulo 1 · Pipeline', title: 'Forwarding', subtitle: 'atalhos EX/MEM e MEM/WB',
    tagline: 'o mesmo programa, sem bolhas',
    config: { model: 'pipeline', forwarding: true },
    intro: 'Com **forwarding**, o resultado sai do latch EX/MEM ou MEM/WB direto para a entrada da ALU, sem esperar o banco de registradores. A mesma cadeia da Fig. 02 roda **sem nenhuma bolha**. Compare os ciclos.',
    source: DEPENDENCIAS,
  },
  {
    id: 'fig04', group: 'Módulo 1 · Pipeline', title: 'Load-use', subtitle: 'a bolha que sobra',
    tagline: 'o dado do lw só existe depois de MEM',
    config: { model: 'pipeline', forwarding: true },
    intro: 'Um **lw** só tem o dado no fim de MEM. Se a instrução seguinte usa o registrador, nem o forwarding resolve: o pipeline insere **1 bolha**. Reordenar o código esconde essa latência.',
    source: LOAD_USE,
  },
  {
    id: 'fig05', group: 'Módulo 2 · Desvios', title: 'Desvios e flush', subtitle: 'predição "não tomado"',
    tagline: 'desvio tomado = 2 instruções jogadas fora',
    config: { model: 'pipeline', forwarding: true },
    intro: 'O desvio só é resolvido em **EX**. Até lá, o pipeline já buscou 2 instruções seguintes. Se o desvio é **tomado**, elas viram **flush** e o PC é corrigido. Cada desvio tomado custa 2 ciclos.',
    source: DESVIOS,
  },
  {
    id: 'fig06', group: 'Módulo 3 · Programas', title: 'Soma em laço', subtitle: 'laço com bnez',
    tagline: 'compare com o monociclo da Fig. 01',
    config: { model: 'pipeline', forwarding: true },
    intro: 'O mesmo programa da Fig. 01, agora no **pipeline**. Repare quantos ciclos o laço perde com os desvios tomados e calcule o CPI.',
    source: SOMA,
  },
  {
    id: 'fig07', group: 'Módulo 3 · Programas', title: 'Fibonacci', subtitle: 'memória + laço',
    tagline: '12 termos gravados na memória',
    config: { model: 'pipeline', forwarding: true },
    intro: 'Grava os 12 primeiros termos de **Fibonacci** na memória. Acompanhe os **sw** na área de dados e os forwardings entre as instruções do laço.',
    source: FIBONACCI,
  },
  {
    id: 'fig08', group: 'Módulo 3 · Programas', title: 'Bubble sort', subtitle: 'função + laços aninhados',
    tagline: 'ordena 8 números com call/ret',
    config: { model: 'pipeline', forwarding: true },
    intro: 'Um **bubble sort** com chamada de função (**call/ret**), laços aninhados, loads seguidos de uso e muitos desvios. É o teste mais completo da trilha.',
    source: BUBBLE,
  },
];
