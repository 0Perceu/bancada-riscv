/** Memória de 64 KiB endereçada por byte, little-endian, com diário para desfazer escritas. */
export const MEM_SIZE = 0x10000;
export const TEXT_BASE = 0x0000;
export const DATA_BASE = 0x1000;
export const STACK_TOP = 0xfff0;

export class Memory {
  readonly bytes = new Uint8Array(MEM_SIZE);
  private journal: Array<[number, number]> | null = null;

  private at(addr: number) {
    return addr & (MEM_SIZE - 1);
  }

  read8(addr: number): number {
    return this.bytes[this.at(addr)];
  }

  write8(addr: number, value: number) {
    const a = this.at(addr);
    if (this.journal) this.journal.push([a, this.bytes[a]]);
    this.bytes[a] = value & 0xff;
  }

  read16(addr: number) {
    return this.read8(addr) | (this.read8(addr + 1) << 8);
  }

  read32(addr: number) {
    return (this.read8(addr) | (this.read8(addr + 1) << 8) | (this.read8(addr + 2) << 16) | (this.read8(addr + 3) << 24)) | 0;
  }

  write16(addr: number, value: number) {
    this.write8(addr, value);
    this.write8(addr + 1, value >> 8);
  }

  write32(addr: number, value: number) {
    this.write8(addr, value);
    this.write8(addr + 1, value >> 8);
    this.write8(addr + 2, value >> 16);
    this.write8(addr + 3, value >> 24);
  }

  /** Começa a registrar o valor antigo de cada byte escrito. */
  beginJournal() {
    this.journal = [];
  }

  endJournal(): Array<[number, number]> {
    const j = this.journal ?? [];
    this.journal = null;
    return j;
  }

  undo(entries: Array<[number, number]>) {
    for (let i = entries.length - 1; i >= 0; i--) this.bytes[entries[i][0]] = entries[i][1];
  }
}
