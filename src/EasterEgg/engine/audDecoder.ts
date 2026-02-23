/**
 * Westwood Studios .AUD file decoder — browser-side IMA ADPCM decompression.
 *
 * Red Alert AUD format (type 99 = IMA ADPCM):
 *   Header (12 bytes):
 *     uint16 sampleRate
 *     uint32 dataSize       (total compressed data size)
 *     uint32 outputSize     (total decompressed size in bytes)
 *     uint8  flags          (bit0=stereo, bit1=16-bit)
 *     uint8  type           (99=IMA ADPCM, 1=WS ADPCM, 0=uncompressed)
 *
 *   Data is chunked:
 *     Chunk header (8 bytes):
 *       uint16 compressedSize
 *       uint16 outputSize
 *       uint32 id            (0x0000DEAF marker)
 *     Chunk data (compressedSize bytes):
 *       IMA ADPCM encoded nibbles, low nibble first
 *
 * Decoder state (predictor + stepIndex) is maintained across chunks.
 * Output is 16-bit signed PCM.
 *
 * References:
 *   - https://wiki.multimedia.cx/index.php/IMA_ADPCM
 *   - https://wiki.multimedia.cx/index.php/Westwood_IMA_ADPCM
 */

// IMA ADPCM step table (89 entries)
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

// IMA ADPCM index adjustment table (16 entries)
const IMA_INDEX_TABLE: number[] = [
  -1, -1, -1, -1, 2, 4, 6, 8,
  -1, -1, -1, -1, 2, 4, 6, 8,
];

export interface AudHeader {
  sampleRate: number;
  dataSize: number;
  outputSize: number;
  flags: number;
  type: number;
  isStereo: boolean;
  is16Bit: boolean;
}

/** Parse a 12-byte AUD file header */
export function parseAudHeader(data: DataView): AudHeader {
  const sampleRate = data.getUint16(0, true);
  const dataSize = data.getUint32(2, true);
  const outputSize = data.getUint32(6, true);
  const flags = data.getUint8(10);
  const type = data.getUint8(11);
  return {
    sampleRate,
    dataSize,
    outputSize,
    flags,
    type,
    isStereo: (flags & 0x01) !== 0,
    is16Bit: (flags & 0x02) !== 0,
  };
}

/** Decode a single IMA ADPCM nibble, updating predictor and stepIndex in-place */
function decodeNibble(
  nibble: number,
  state: { predictor: number; stepIndex: number }
): number {
  const step = IMA_STEP_TABLE[state.stepIndex];

  // Compute difference
  let diff = step >> 3;
  if (nibble & 4) diff += step;
  if (nibble & 2) diff += step >> 1;
  if (nibble & 1) diff += step >> 2;

  // Apply sign
  if (nibble & 8) {
    state.predictor -= diff;
  } else {
    state.predictor += diff;
  }

  // Clamp predictor to 16-bit signed range
  if (state.predictor > 32767) state.predictor = 32767;
  if (state.predictor < -32768) state.predictor = -32768;

  // Update step index
  state.stepIndex += IMA_INDEX_TABLE[nibble];
  if (state.stepIndex < 0) state.stepIndex = 0;
  if (state.stepIndex > 88) state.stepIndex = 88;

  return state.predictor;
}

/**
 * Decode a Westwood IMA ADPCM AUD file to 16-bit signed PCM samples.
 * Works with both ArrayBuffer (browser fetch) and Uint8Array.
 */
export function decodeAud(buffer: ArrayBuffer): {
  samples: Int16Array;
  sampleRate: number;
  channels: number;
} {
  const view = new DataView(buffer);
  const header = parseAudHeader(view);

  if (header.type !== 99) {
    throw new Error(
      `Unsupported AUD type ${header.type}. Only type 99 (IMA ADPCM) is supported.`
    );
  }

  const channels = header.isStereo ? 2 : 1;
  // For 16-bit output, each sample is 2 bytes
  const totalSamples = header.is16Bit
    ? Math.floor(header.outputSize / 2)
    : header.outputSize;

  const samples = new Int16Array(totalSamples);
  let samplePos = 0;

  // Decoder state — maintained across chunks
  const state = { predictor: 0, stepIndex: 0 };
  // For stereo, we'd need separate states, but RA sounds are mono
  const stateR = { predictor: 0, stepIndex: 0 };

  let offset = 12; // skip file header

  while (offset + 8 <= buffer.byteLength && samplePos < totalSamples) {
    // Read chunk header
    const chunkCompSize = view.getUint16(offset, true);
    const _chunkOutSize = view.getUint16(offset + 2, true);
    const chunkId = view.getUint32(offset + 4, true);
    offset += 8;

    if (chunkId !== 0x0000deaf) {
      // Not a valid chunk — stop decoding
      break;
    }

    // Decode chunk data
    const chunkEnd = Math.min(offset + chunkCompSize, buffer.byteLength);

    if (header.isStereo) {
      // Stereo: alternating left/right bytes
      // Each byte = 2 samples for one channel (low nibble, then high nibble)
      let isLeft = true;
      while (offset < chunkEnd && samplePos < totalSamples) {
        const byte = view.getUint8(offset++);
        const st = isLeft ? state : stateR;
        const loNibble = byte & 0x0f;
        const hiNibble = (byte >> 4) & 0x0f;
        samples[samplePos++] = decodeNibble(loNibble, st);
        if (samplePos < totalSamples) {
          samples[samplePos++] = decodeNibble(hiNibble, st);
        }
        isLeft = !isLeft;
      }
    } else {
      // Mono: each byte = 2 samples (low nibble first)
      while (offset < chunkEnd && samplePos < totalSamples) {
        const byte = view.getUint8(offset++);
        const loNibble = byte & 0x0f;
        const hiNibble = (byte >> 4) & 0x0f;
        samples[samplePos++] = decodeNibble(loNibble, state);
        if (samplePos < totalSamples) {
          samples[samplePos++] = decodeNibble(hiNibble, state);
        }
      }
    }
  }

  return {
    samples: samples.subarray(0, samplePos),
    sampleRate: header.sampleRate,
    channels,
  };
}

/**
 * Convert decoded AUD samples to a Web Audio AudioBuffer.
 * Normalizes 16-bit signed PCM to float32 range [-1.0, 1.0].
 */
export function audToAudioBuffer(
  ctx: AudioContext,
  samples: Int16Array,
  sampleRate: number,
  channels: number
): AudioBuffer {
  const audioBuffer = ctx.createBuffer(channels, samples.length / channels, sampleRate);

  if (channels === 1) {
    const channelData = audioBuffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) {
      channelData[i] = samples[i] / 32768;
    }
  } else {
    // Deinterleave stereo
    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.getChannelData(1);
    for (let i = 0; i < samples.length; i += 2) {
      left[i >> 1] = samples[i] / 32768;
      right[i >> 1] = samples[i + 1] / 32768;
    }
  }

  return audioBuffer;
}
