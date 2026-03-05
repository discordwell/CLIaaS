#!/usr/bin/env node
// Copy WIZARD/ from project root into packages/cliaas/WIZARD/ for npm publishing
import { cpSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../../..');
const src = resolve(root, 'WIZARD');
const dest = resolve(__dirname, '..', 'WIZARD');

if (existsSync(src)) {
  cpSync(src, dest, { recursive: true });
  console.log('Copied WIZARD/ into packages/cliaas/WIZARD/');
} else {
  console.warn('WIZARD/ not found at project root — skipping copy');
}
