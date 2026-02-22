/**
 * MIX archive reader — ported from RA/mixfile.cpp
 *
 * Red Alert MIX format (extended):
 *   [uint16 first]  — 0 for extended format, otherwise count (TD format)
 *   [uint16 second] — flags: bit0=digest, bit1=encrypted
 *   If encrypted:
 *     [80 bytes RSA-encrypted Blowfish key]
 *     [Blowfish-encrypted header: count + dataSize + index entries]
 *   If not encrypted:
 *     [uint16 count] [uint32 dataSize] [SubBlock × count]
 *   [body data]
 */

import { readFileSync } from 'fs';
import { filenameCRC } from './crc.js';
import { decryptMixHeader } from './mixcrypt.js';

export interface MixEntry {
  crc: number;
  offset: number;
  size: number;
}

export class MixFile {
  private data: Buffer;
  private entries: MixEntry[];
  private bodyOffset: number;

  constructor(data: Buffer) {
    this.data = data;
    this.entries = [];
    this.bodyOffset = 0;
    this.parseHeader();
  }

  static fromFile(path: string): MixFile {
    return new MixFile(readFileSync(path));
  }

  static fromBuffer(buf: Buffer): MixFile {
    return new MixFile(buf);
  }

  private parseHeader(): void {
    const first = this.data.readUInt16LE(0);

    if (first === 0) {
      // Extended RA format
      const second = this.data.readUInt16LE(2);
      const isEncrypted = (second & 0x02) !== 0;

      if (isEncrypted) {
        // Decrypt header using RSA + Blowfish
        const result = decryptMixHeader(this.data);
        this.entries = result.entries;
        this.bodyOffset = result.bodyOffset;
      } else {
        // Extended but not encrypted
        const count = this.data.readUInt16LE(4);
        const _dataSize = this.data.readUInt32LE(6);
        let offset = 10;
        for (let i = 0; i < count; i++) {
          this.entries.push({
            crc: this.data.readInt32LE(offset),
            offset: this.data.readInt32LE(offset + 4),
            size: this.data.readInt32LE(offset + 8),
          });
          offset += 12;
        }
        this.bodyOffset = offset;
      }
    } else {
      // Plain TD format: first word is count
      const count = first;
      const _dataSize = this.data.readUInt32LE(2);
      let offset = 6;
      for (let i = 0; i < count; i++) {
        this.entries.push({
          crc: this.data.readInt32LE(offset),
          offset: this.data.readInt32LE(offset + 4),
          size: this.data.readInt32LE(offset + 8),
        });
        offset += 12;
      }
      this.bodyOffset = offset;
    }

    // Sort by CRC for binary search
    this.entries.sort((a, b) => {
      const ua = a.crc >>> 0;
      const ub = b.crc >>> 0;
      return ua < ub ? -1 : ua > ub ? 1 : 0;
    });
  }

  /** Find an entry by filename */
  findEntry(filename: string): MixEntry | null {
    const crc = filenameCRC(filename);
    // Linear search (binary search is fragile with signed/unsigned CRC comparison)
    for (const entry of this.entries) {
      if (entry.crc === crc) return entry;
    }
    return null;
  }

  /** Read file data by filename */
  readFile(filename: string): Buffer | null {
    const entry = this.findEntry(filename);
    if (!entry) return null;
    const start = this.bodyOffset + entry.offset;
    return this.data.subarray(start, start + entry.size) as Buffer;
  }

  /** List all entries (CRCs only, filenames unknown) */
  listEntries(): MixEntry[] {
    return [...this.entries];
  }

  /** Get entry count */
  get entryCount(): number {
    return this.entries.length;
  }
}
