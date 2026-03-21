#!/usr/bin/env tsx
/**
 * Red Alert Audio Extraction Script
 *
 * Extracts .AUD sound effects and voice lines from:
 *   1. gamedata.data -> SOUNDS.MIX + SPEECH.MIX (freeware RA)
 *   2. Aftermath expansion files at /tmp/ra_ant_extract/am_expand2_unpack/ (if present)
 *
 * Decodes Westwood IMA ADPCM (type 99) to standard WAV files.
 * Outputs browser-compatible 16-bit PCM WAV files to public/ra/audio/.
 *
 * Usage: npx tsx scripts/extract-ra-audio.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { MixFile } from './ra-assets/mix.js';
import { extractAllMIX } from './ra-assets/gamedata.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');
const GAMEDATA_PATH = join(PROJECT_ROOT, 'public/ra/gamedata.data');
const GAMEDATA_JS = join(PROJECT_ROOT, 'public/ra/gamedata.js');
const OUTPUT_DIR = join(PROJECT_ROOT, 'public/ra/audio');
const AFTERMATH_DIR = '/tmp/ra_ant_extract/am_expand2_unpack';

// === IMA ADPCM Tables ===

const IMA_STEP_TABLE: number[] = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17,
  19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
  50, 55, 60, 66, 73, 80, 88, 97, 107, 118,
  130, 143, 157, 173, 190, 209, 230, 253, 279, 307,
  337, 371, 408, 449, 494, 544, 598, 658, 724, 796,
  876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066,
  2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358,
  5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899,
  15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
];

const IMA_INDEX_TABLE: number[] = [
  -1, -1, -1, -1, 2, 4, 6, 8,
  -1, -1, -1, -1, 2, 4, 6, 8,
];

// === AUD Decoding ===

interface AudHeader {
  sampleRate: number;
  dataSize: number;
  outputSize: number;
  flags: number;
  type: number;
  isStereo: boolean;
  is16Bit: boolean;
}

function parseAudHeader(buf: Buffer): AudHeader {
  return {
    sampleRate: buf.readUInt16LE(0),
    dataSize: buf.readUInt32LE(2),
    outputSize: buf.readUInt32LE(6),
    flags: buf[10],
    type: buf[11],
    isStereo: (buf[10] & 0x01) !== 0,
    is16Bit: (buf[10] & 0x02) !== 0,
  };
}

function decodeNibble(
  nibble: number,
  state: { predictor: number; stepIndex: number }
): number {
  const step = IMA_STEP_TABLE[state.stepIndex];
  let diff = step >> 3;
  if (nibble & 4) diff += step;
  if (nibble & 2) diff += step >> 1;
  if (nibble & 1) diff += step >> 2;
  if (nibble & 8) state.predictor -= diff;
  else state.predictor += diff;
  if (state.predictor > 32767) state.predictor = 32767;
  if (state.predictor < -32768) state.predictor = -32768;
  state.stepIndex += IMA_INDEX_TABLE[nibble];
  if (state.stepIndex < 0) state.stepIndex = 0;
  if (state.stepIndex > 88) state.stepIndex = 88;
  return state.predictor;
}

/** Decode a type 99 (IMA ADPCM) AUD buffer to 16-bit signed PCM samples */
function decodeAudToSamples(buf: Buffer): { samples: Int16Array; sampleRate: number; channels: number } {
  const header = parseAudHeader(buf);

  if (header.type !== 99) {
    throw new Error(`Unsupported AUD type ${header.type}, only type 99 (IMA ADPCM) supported`);
  }

  const channels = header.isStereo ? 2 : 1;
  const totalSamples = header.is16Bit
    ? Math.floor(header.outputSize / 2)
    : header.outputSize;

  const samples = new Int16Array(totalSamples);
  let samplePos = 0;
  const state = { predictor: 0, stepIndex: 0 };
  let offset = 12;

  while (offset + 8 <= buf.length && samplePos < totalSamples) {
    const chunkCompSize = buf.readUInt16LE(offset);
    const _chunkOutSize = buf.readUInt16LE(offset + 2);
    const chunkId = buf.readUInt32LE(offset + 4);
    offset += 8;

    if (chunkId !== 0x0000deaf) break;

    const chunkEnd = Math.min(offset + chunkCompSize, buf.length);

    while (offset < chunkEnd && samplePos < totalSamples) {
      const byte = buf[offset++];
      const lo = byte & 0x0f;
      const hi = (byte >> 4) & 0x0f;
      samples[samplePos++] = decodeNibble(lo, state);
      if (samplePos < totalSamples) {
        samples[samplePos++] = decodeNibble(hi, state);
      }
    }
  }

  return { samples: samples.subarray(0, samplePos), sampleRate: header.sampleRate, channels };
}

/** Encode 16-bit PCM samples as a WAV file (RIFF) */
function encodeWav(samples: Int16Array, sampleRate: number, channels: number): Buffer {
  const dataBytes = samples.length * 2;
  const headerSize = 44;
  const buf = Buffer.alloc(headerSize + dataBytes);

  // RIFF header
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);     // file size - 8
  buf.write('WAVE', 8);

  // fmt chunk
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);                // chunk size
  buf.writeUInt16LE(1, 20);                 // PCM format
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * 2, 28); // byte rate
  buf.writeUInt16LE(channels * 2, 32);      // block align
  buf.writeUInt16LE(16, 34);                // bits per sample

  // data chunk
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);

  // Write samples as little-endian int16
  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(samples[i], headerSize + i * 2);
  }

  return buf;
}

// === Audio manifest mapping ===
// Maps from our SoundName identifiers to source AUD filenames.
// Priority: Aftermath files first, then SOUNDS.MIX, then SPEECH.MIX.

interface AudioSource {
  /** Our output filename (without extension) */
  outputName: string;
  /** Source options in priority order: [source, audFilename] */
  sources: Array<{
    from: 'aftermath' | 'sounds' | 'speech';
    audFile: string;
  }>;
}

const AUDIO_SOURCES: AudioSource[] = [
  // === Weapon sounds ===
  // C++ audio.cpp SFX table cross-reference:
  { outputName: 'rifle', sources: [{ from: 'sounds', audFile: 'GUN27.AUD' }] },         // audio.cpp:119 VOC_GUN_RIFLE "Rifle shot"
  { outputName: 'machinegun', sources: [{ from: 'sounds', audFile: 'GUN11.AUD' }] },     // audio.cpp:116 VOC_GUN_5 "5 round gun burst (slow)"
  { outputName: 'cannon', sources: [{ from: 'sounds', audFile: 'CANNON1.AUD' }] },       // audio.cpp:102 VOC_CANNON1 "Cannon sound (medium)"
  { outputName: 'artillery', sources: [{ from: 'sounds', audFile: 'CANNON2.AUD' }] },    // audio.cpp:103 VOC_CANNON2 "Cannon sound (short)"
  { outputName: 'teslazap', sources: [{ from: 'sounds', audFile: 'TESLA1.AUD' }] },      // audio.cpp:144 VOC_TESLA_ZAP "Tesla zap effect"
  { outputName: 'grenade', sources: [{ from: 'sounds', audFile: 'GRENADE1.AUD' }] },     // audio.cpp:115 VOC_GRENADE_TOSS
  { outputName: 'bazooka', sources: [{ from: 'sounds', audFile: 'MISSILE1.AUD' }] },     // audio.cpp:131 VOC_MISSILE_1 "Missile with high tech effect"

  // === Ant-specific sounds (Aftermath expansion) ===
  { outputName: 'mandible', sources: [{ from: 'aftermath', audFile: 'ANTBITE.AUD' }] },
  { outputName: 'die_ant', sources: [{ from: 'aftermath', audFile: 'ANTDIE.AUD' }] },
  { outputName: 'fireball', sources: [{ from: 'aftermath', audFile: 'BUZZY1.AUD' }] },

  // === Dog sounds ===
  { outputName: 'dogjaw', sources: [{ from: 'sounds', audFile: 'DOGY1.AUD' }] },         // audio.cpp:110 VOC_DOG_BARK "Dog bark" (attack sound)
  { outputName: 'select_dog', sources: [{ from: 'sounds', audFile: 'DOGW7.AUD' }] },
  { outputName: 'move_ack_dog', sources: [{ from: 'sounds', audFile: 'DOGY1.AUD' }] }, // audio.cpp:110 VOC_DOG_BARK "Dog bark"

  // === Explosions ===
  // C++ audio.cpp: VOC_GUN_5=GUN5, VOC_KABOOM1=KABOOM1, VOC_KABOOM22=KABOOM22, VOC_KABOOM25=KABOOM25
  // NOTE: TANK01.AUD is VOX_MADTANK_DEPLOYED speech ("M.A.D. Tank Deployed"), NOT an explosion.
  { outputName: 'explode_sm', sources: [{ from: 'sounds', audFile: 'KABOOM30.AUD' }] },    // audio.cpp:150 VOC_KABOOM30 "Short explosion (HE)"
  { outputName: 'explode_lg', sources: [{ from: 'sounds', audFile: 'KABOOM22.AUD' }] },   // audio.cpp:127 VOC_KABOOM22 "Long explosion (sharp)"
  { outputName: 'building_explode', sources: [{ from: 'sounds', audFile: 'CRMBLE2.AUD' }] }, // audio.cpp:155 VOC_CRUMBLE "Building crumble"

  // === Flamethrower ===
  { outputName: 'flamethrower', sources: [{ from: 'sounds', audFile: 'FIREBL3.AUD' }] }, // audio.cpp:113 VOC_FIRE_LAUNCH "Fireball launch sound"

  // === Unit acknowledgments (Aftermath Stavros voices) ===
  { outputName: 'move_ack', sources: [
    { from: 'aftermath', audFile: 'STAVMOV.AUD' },
    { from: 'sounds', audFile: 'KEEPEM1.AUD' },
  ]},
  { outputName: 'attack_ack', sources: [
    { from: 'aftermath', audFile: 'STAVCMDR.AUD' },
    { from: 'sounds', audFile: 'TUFFGUY1.AUD' },
  ]},
  { outputName: 'select', sources: [
    { from: 'aftermath', audFile: 'STAVYES.AUD' },
    { from: 'sounds', audFile: 'ONIT1.AUD' },
  ]},
  { outputName: 'move_ack_infantry', sources: [
    { from: 'sounds', audFile: 'KEEPEM1.AUD' },
  ]},
  { outputName: 'move_ack_vehicle', sources: [
    { from: 'sounds', audFile: 'ONIT1.AUD' },
  ]},
  { outputName: 'select_infantry', sources: [
    { from: 'aftermath', audFile: 'STAVCRSE.AUD' },
    { from: 'sounds', audFile: 'ROKROLL1.AUD' },
  ]},
  { outputName: 'select_vehicle', sources: [
    { from: 'sounds', audFile: 'TUFFGUY1.AUD' },
  ]},

  // === UI / building sounds ===
  { outputName: 'heal', sources: [{ from: 'sounds', audFile: 'HEAL2.AUD' }] },
  { outputName: 'sell', sources: [{ from: 'sounds', audFile: 'CASHTURN.AUD' }] },
  { outputName: 'repair', sources: [{ from: 'sounds', audFile: 'BUILD5.AUD' }] },
  { outputName: 'crate_pickup', sources: [{ from: 'sounds', audFile: 'CASHUP1.AUD' }] },
  { outputName: 'tesla_charge', sources: [{ from: 'sounds', audFile: 'TSLACHG2.AUD' }] }, // audio.cpp:143 VOC_TESLA_POWER_UP "Hum charge up"

  // === EVA voice lines (SPEECH.MIX) ===
  { outputName: 'eva_acknowledged', sources: [
    { from: 'sounds', audFile: 'ACKNO.AUD' },      // audio.cpp:77 VOC_ACKNOWL "acknowledged"
  ]},
  { outputName: 'eva_unit_lost', sources: [
    { from: 'speech', audFile: 'UNITLST1.AUD' },   // audio.cpp:505 VOX_UNIT_LOST "unit lost"
  ]},
  { outputName: 'eva_base_attack', sources: [
    { from: 'speech', audFile: 'BASEATK1.AUD' },    // audio.cpp:492 VOX_BASE_UNDER_ATTACK
  ]},
  { outputName: 'eva_construction_complete', sources: [
    { from: 'speech', audFile: 'CONSCMP1.AUD' },    // audio.cpp:479 VOX_CONSTRUCTION "construction complete"
  ]},
  { outputName: 'eva_unit_ready', sources: [
    { from: 'speech', audFile: 'UNITRDY1.AUD' },
  ]},
  { outputName: 'eva_low_power', sources: [
    { from: 'speech', audFile: 'LOPOWER1.AUD' },
  ]},
  { outputName: 'eva_new_options', sources: [
    { from: 'speech', audFile: 'NEWOPT1.AUD' },
  ]},
  { outputName: 'eva_building', sources: [
    { from: 'speech', audFile: 'ABLDGIN1.AUD' },
  ]},
  { outputName: 'eva_mission_accomplished', sources: [
    { from: 'speech', audFile: 'MISNWON1.AUD' },
  ]},
  { outputName: 'eva_reinforcements', sources: [
    { from: 'speech', audFile: 'REINFOR1.AUD' },
  ]},
  { outputName: 'eva_mission_warning', sources: [
    { from: 'speech', audFile: 'MISNLST1.AUD' },
  ]},

  // === Victory / defeat ===
  { outputName: 'victory_fanfare', sources: [
    { from: 'speech', audFile: 'MISNWON1.AUD' },
  ]},
  { outputName: 'defeat_sting', sources: [
    { from: 'speech', audFile: 'MISNLST1.AUD' },
  ]},
];

function log(msg: string): void {
  console.log(`[audio-extract] ${msg}`);
}

async function main(): Promise<void> {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  // Load MIX files from gamedata
  let soundsMix: MixFile | null = null;
  let speechMix: MixFile | null = null;

  if (existsSync(GAMEDATA_PATH) && existsSync(GAMEDATA_JS)) {
    log('Loading MIX files from gamedata.data...');
    const mixFiles = extractAllMIX(GAMEDATA_PATH, GAMEDATA_JS);

    const soundsData = mixFiles.get('SOUNDS.MIX');
    if (soundsData) {
      soundsMix = MixFile.fromBuffer(soundsData);
      log(`  SOUNDS.MIX: ${soundsMix.entryCount} entries`);
    }

    const speechData = mixFiles.get('SPEECH.MIX');
    if (speechData) {
      speechMix = MixFile.fromBuffer(speechData);
      log(`  SPEECH.MIX: ${speechMix.entryCount} entries`);
    }
  } else {
    log('WARNING: gamedata.data not found, skipping MIX extraction');
  }

  const hasAftermath = existsSync(AFTERMATH_DIR);
  if (hasAftermath) {
    log(`Aftermath expansion files found at ${AFTERMATH_DIR}`);
  } else {
    log('Aftermath expansion files not found, using fallbacks');
  }

  // Extract and decode each audio source
  let extracted = 0;
  let skipped = 0;
  const manifest: Record<string, { file: string; sampleRate: number; duration: number }> = {};

  for (const audio of AUDIO_SOURCES) {
    let audData: Buffer | null = null;
    let foundIn = '';

    // Try each source in priority order
    for (const source of audio.sources) {
      if (source.from === 'aftermath' && hasAftermath) {
        const path = join(AFTERMATH_DIR, source.audFile);
        if (existsSync(path)) {
          audData = readFileSync(path);
          foundIn = `aftermath/${source.audFile}`;
          break;
        }
      } else if (source.from === 'sounds' && soundsMix) {
        const data = soundsMix.readFile(source.audFile);
        if (data) {
          audData = data;
          foundIn = `SOUNDS.MIX/${source.audFile}`;
          break;
        }
      } else if (source.from === 'speech' && speechMix) {
        const data = speechMix.readFile(source.audFile);
        if (data) {
          audData = data;
          foundIn = `SPEECH.MIX/${source.audFile}`;
          break;
        }
      }
    }

    if (!audData) {
      log(`  SKIP ${audio.outputName}: no source found`);
      skipped++;
      continue;
    }

    try {
      const { samples, sampleRate, channels } = decodeAudToSamples(audData);
      const wav = encodeWav(samples, sampleRate, channels);
      const outputFile = `${audio.outputName}.wav`;
      writeFileSync(join(OUTPUT_DIR, outputFile), wav);

      const duration = samples.length / (sampleRate * channels);
      manifest[audio.outputName] = { file: outputFile, sampleRate, duration };

      log(`  ${audio.outputName}: ${samples.length} samples, ${sampleRate}Hz, ${duration.toFixed(2)}s (from ${foundIn})`);
      extracted++;
    } catch (e) {
      log(`  ERROR ${audio.outputName}: ${e}`);
      skipped++;
    }
  }

  // Write audio manifest
  writeFileSync(
    join(OUTPUT_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  log(`\nDone! Extracted ${extracted} audio files, skipped ${skipped}`);
  log(`Audio written to ${OUTPUT_DIR}`);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
