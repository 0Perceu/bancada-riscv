/**
 * Cache L1 configurável (instruções ou dados).
 *
 * Modela só o que importa para o tempo: tag, válido, sujo e a ordem de uso (LRU) de cada linha.
 * Os bytes continuam vindo da memória principal, que é sempre a fonte da verdade; por isso a
 * cache nunca muda o resultado de um programa, só quantos ciclos ele leva. O teste diferencial
 * confere exatamente isso.
 *
 * Política de escrita: write-back com write-allocate. Substituição: LRU.
 */
export interface CacheConfig {
  /** Número de conjuntos (potência de 2). */
  sets: number;
  /** Vias por conjunto (1 = mapeamento direto). */
  ways: number;
  /** Bytes por bloco (potência de 2, mínimo 4). */
  blockBytes: number;
  /** Ciclos extras que uma falta custa (buscar o bloco na memória principal). */
  missPenalty: number;
}

export interface CacheLine {
  valid: boolean;
  dirty: boolean;
  tag: number;
  /** Ciclo lógico do último uso, para o LRU. */
  used: number;
}

export interface CacheStats {
  accesses: number;
  hits: number;
  misses: number;
  writebacks: number;
}

export interface CacheAccess {
  hit: boolean;
  addr: number;
  set: number;
  way: number;
  tag: number;
  offset: number;
  /** Bloco sujo expulso para dar lugar ao novo (custa uma escrita na memória). */
  writeback: boolean;
  /** Ciclos de espera que este acesso causa (0 num acerto). */
  penalty: number;
}

export const DEFAULT_CACHE: CacheConfig = { sets: 4, ways: 1, blockBytes: 16, missPenalty: 4 };

const log2 = (n: number) => Math.round(Math.log2(n));

export class Cache {
  lines: CacheLine[][];
  stats: CacheStats = { accesses: 0, hits: 0, misses: 0, writebacks: 0 };
  last: CacheAccess | null = null;
  private clock = 0;

  constructor(readonly name: string, readonly config: CacheConfig) {
    for (const k of ['sets', 'blockBytes'] as const) {
      const v = config[k];
      if (v < 1 || (v & (v - 1)) !== 0) throw new Error(`${name}: ${k} precisa ser potência de 2`);
    }
    if (config.blockBytes < 4) throw new Error(`${name}: o bloco precisa ter pelo menos 4 bytes`);
    this.lines = Array.from({ length: config.sets }, () =>
      Array.from({ length: config.ways }, () => ({ valid: false, dirty: false, tag: 0, used: 0 })),
    );
  }

  get sizeBytes() {
    return this.config.sets * this.config.ways * this.config.blockBytes;
  }

  get offsetBits() {
    return log2(this.config.blockBytes);
  }

  get indexBits() {
    return log2(this.config.sets);
  }

  /** Divide o endereço em tag | índice | deslocamento. */
  split(addr: number) {
    const a = addr >>> 0;
    const offset = a & (this.config.blockBytes - 1);
    const set = (a >>> this.offsetBits) & (this.config.sets - 1);
    const tag = a >>> (this.offsetBits + this.indexBits);
    return { offset, set, tag };
  }

  /** Endereço do primeiro byte do bloco guardado numa linha. */
  blockAddr(set: number, tag: number) {
    return ((tag << (this.offsetBits + this.indexBits)) | (set << this.offsetBits)) >>> 0;
  }

  /** Acessa um endereço; numa falta o bloco é trazido na hora (o custo vem em `penalty`). */
  access(addr: number, write: boolean): CacheAccess {
    const { offset, set, tag } = this.split(addr);
    const row = this.lines[set];
    this.stats.accesses++;
    this.clock++;
    let way = row.findIndex((l) => l.valid && l.tag === tag);
    let hit = true;
    let writeback = false;
    if (way < 0) {
      hit = false;
      this.stats.misses++;
      way = row.findIndex((l) => !l.valid);
      if (way < 0) {
        way = 0;
        for (let w = 1; w < row.length; w++) if (row[w].used < row[way].used) way = w;
      }
      const victim = row[way];
      if (victim.valid && victim.dirty) {
        writeback = true;
        this.stats.writebacks++;
      }
      row[way] = { valid: true, dirty: false, tag, used: 0 };
    } else {
      this.stats.hits++;
    }
    const line = row[way];
    line.used = this.clock;
    if (write) line.dirty = true;
    const penalty = hit ? 0 : this.config.missPenalty * (writeback ? 2 : 1);
    this.last = { hit, addr: addr >>> 0, set, way, tag, offset, writeback, penalty };
    return this.last;
  }

  snapshot() {
    return structuredClone({ lines: this.lines, stats: this.stats, last: this.last, clock: this.clock });
  }

  restore(s: unknown) {
    const v = structuredClone(s) as ReturnType<Cache['snapshot']>;
    this.lines = v.lines;
    this.stats = v.stats;
    this.last = v.last;
    this.clock = v.clock;
  }
}

export const hitRate = (s: CacheStats) => (s.accesses ? s.hits / s.accesses : 0);
