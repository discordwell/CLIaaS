/**
 * Parse Emscripten file_packager output to extract MIX files from gamedata.data.
 *
 * gamedata.js contains a metadata JSON with file offsets:
 *   {"files": [{"filename": "/CONQUER.MIX", "start": 309406, "end": 2486453}, ...]}
 */

import { readFileSync } from 'fs';

export interface PackedFile {
  filename: string;
  start: number;
  end: number;
}

/** Parse the file table from gamedata.js */
export function parseGamedataJS(jsPath: string): PackedFile[] {
  const js = readFileSync(jsPath, 'utf-8');

  // Find the loadPackage call with JSON literal (not the function definition)
  const startMarker = 'loadPackage({';
  const startIdx = js.indexOf(startMarker);
  if (startIdx === -1) throw new Error('Could not find loadPackage({ in gamedata.js');

  const jsonStart = startIdx + startMarker.length - 1; // include the opening {
  let depth = 0;
  let jsonEnd = jsonStart;
  for (let i = jsonStart; i < js.length; i++) {
    if (js[i] === '{' || js[i] === '[') depth++;
    else if (js[i] === '}' || js[i] === ']') {
      depth--;
      if (depth === 0) {
        jsonEnd = i + 1;
        break;
      }
    }
  }

  const jsonStr = js.substring(jsonStart, jsonEnd);
  const metadata = JSON.parse(jsonStr) as {
    files: PackedFile[];
    remote_package_size: number;
  };

  return metadata.files;
}

/** Extract a file from gamedata.data by name */
export function extractFromGamedata(
  gamedataPath: string,
  fileTable: PackedFile[],
  filename: string
): Buffer {
  const entry = fileTable.find(
    (f) => f.filename === filename || f.filename === '/' + filename
  );
  if (!entry) {
    throw new Error(`File ${filename} not found in gamedata. Available: ${fileTable.map((f) => f.filename).join(', ')}`);
  }

  const data = readFileSync(gamedataPath);
  return data.subarray(entry.start, entry.end) as Buffer;
}

/** Extract all MIX files from gamedata.data as buffers */
export function extractAllMIX(
  gamedataPath: string,
  jsPath: string
): Map<string, Buffer> {
  const fileTable = parseGamedataJS(jsPath);
  const data = readFileSync(gamedataPath);
  const result = new Map<string, Buffer>();

  for (const entry of fileTable) {
    const name = entry.filename.replace(/^\//, '');
    if (name.endsWith('.MIX')) {
      result.set(name, data.subarray(entry.start, entry.end) as Buffer);
    }
  }

  return result;
}
