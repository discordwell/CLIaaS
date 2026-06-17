/**
 * Next.js 16 App Router contract: the `params` and `searchParams` props
 * passed to pages, layouts, and route handlers are Promises and must be
 * awaited (or unwrapped with React's `use()`).
 *
 * A legacy synchronous annotation like `params: { id: string }` compiles in
 * isolation — the mismatch is only asserted by generated `.next/types`
 * harnesses, which `typescript.ignoreBuildErrors` skips during `next build`
 * and which don't exist on a fresh CI checkout. At runtime the property read
 * on the Promise silently yields `undefined`, breaking the page.
 *
 * This guard scans every App Router entrypoint for a non-Promise
 * `params`/`searchParams` type annotation. It only sees inline annotations;
 * if you type props via a named interface, keep the Promise there too.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';

const APP_DIR = path.resolve(__dirname, '../app');
const ENTRYPOINT_FILES = new Set(['page.tsx', 'layout.tsx', 'route.ts']);

function collectEntrypoints(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectEntrypoints(full));
    } else if (ENTRYPOINT_FILES.has(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

describe('Next 16 App Router params contract', () => {
  const entrypoints = collectEntrypoints(APP_DIR);

  it('finds App Router entrypoints to scan', () => {
    expect(entrypoints.length).toBeGreaterThan(100);
  });

  it('types every params/searchParams annotation as a Promise', () => {
    const offenders: string[] = [];

    for (const file of entrypoints) {
      const source = readFileSync(file, 'utf8');
      // Drop correctly-typed annotations, then flag anything left that
      // annotates params/searchParams with an inline object type.
      const remaining = source.replace(
        /\b(?:searchParams|params)\s*:\s*Promise\s*</g,
        '',
      );
      const legacyAnnotation = /\b(?:searchParams|params)\s*:\s*\{/;
      if (legacyAnnotation.test(remaining)) {
        offenders.push(path.relative(APP_DIR, file));
      }
    }

    expect(
      offenders,
      `Legacy synchronous params/searchParams annotation found. ` +
        `In Next 16 these props are Promises — type them as ` +
        `\`params: Promise<{ ... }>\` and \`await\` them (App Router pages ` +
        `silently receive undefined otherwise):\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });
});
