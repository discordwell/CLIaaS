# Easter Egg Development Guide

## Testing Patterns

### Pure Data Module Mocks (Preferred Pattern)

When testing data/config modules (mappings, lookups, static tables), **test them directly** — no mocking needed. This is the cleanest, most reliable approach.

**Example** from `fmv-movies.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { getMissionMovies, hasFMV, getMovieUrl } from '../engine/movies';

// Define test data inline — acts as both test fixture AND documentation
const ALLIED_FMV: [string, string, string][] = [
  ['SCG01EA', 'ally1', 'landing'],
  ['SCG02EA', 'ally2', 'mcv'],
  // ...
];

it('all 11 Allied FMV missions have brief + action entries', () => {
  for (const [id, brief, action] of ALLIED_FMV) {
    const movies = getMissionMovies(id);
    expect(movies, `${id} should have movies`).toBeDefined();
    expect(movies!.brief).toBe(brief);
    expect(movies!.action).toBe(action);
  }
});

// Verify exclusions explicitly — documents what SHOULDN'T match
it('ant missions return undefined', () => {
  expect(getMissionMovies('SCA01EA')).toBeUndefined();
  expect(hasFMV('SCA01EA')).toBe(false);
});
```

**Why this works well:**
1. **No mocking overhead** — pure functions with no side effects don't need mocks
2. **Test data doubles as documentation** — the arrays document the full mapping
3. **Explicit exclusion tests** — proving what *doesn't* have entries is as important as what does
4. **Parameterized assertions with context** — `expect(x, \`${id} should have movies\`)` gives clear failure messages
5. **Separate concerns** — data module has zero DOM/network deps, so tests run in milliseconds

### When to Use This Pattern
- Static lookup tables / config maps
- URL builders, formatters, normalizers
- Any pure function module with no side effects
- Validation logic
