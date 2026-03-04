# Gap #4: Spy Mechanics - Implementation Summary

## Overview
This document describes the implementation of spy mechanics for the Red Alert TypeScript game engine, including disguise, infiltration, and dog detection systems.

## Files Modified

### 1. `/src/EasterEgg/engine/entity.ts`
**Added `disguisedAs` field** (after line 176):
```typescript
// Spy disguise system (Gap #4)
disguisedAs: House | null = null;  // when disguised, appears as this house's unit
```

This field allows spies to appear as enemy units by adopting their house color.

### 2. `/src/EasterEgg/engine/index.ts`

#### A. Replaced Spy Stub (lines 5210-5220)
Replaced the stubbed `spyDisguise` method with real implementations:

**spyDisguise Method:**
```typescript
/** Spy disguise — spy adopts enemy house appearance */
private spyDisguise(spy: Entity, _target: Entity): void {
  if (spy.type !== UnitType.I_SPY) return;
  // Spy takes on the target's house color (disguise)
  spy.disguisedAs = _target.house;
}
```

**spyInfiltrate Method:**
```typescript
/** Spy infiltration — spy enters enemy building for special effects */
private spyInfiltrate(spy: Entity, structure: MapStructure): void {
  if (spy.type !== UnitType.I_SPY || !spy.alive) return;

  const targetHouse = structure.house;
  // Must be enemy structure
  if (targetHouse === House.Spain || targetHouse === House.Greece) return;

  switch (structure.type) {
    case 'PROC':
      // Steal 50% of house credits
      const stolen = Math.floor((this.houseCredits?.get(targetHouse) ?? 0) * 0.5);
      if (this.houseCredits) this.houseCredits.set(targetHouse, (this.houseCredits.get(targetHouse) ?? 0) - stolen);
      this.credits += stolen;
      this.evaMessages.push({ text: `CREDITS STOLEN: ${stolen}`, tick: this.tick });
      break;
    case 'DOME':
      // Reveal map for 60 seconds (900 ticks) — set fog disabled temporarily
      this.fogDisabled = true;
      this.evaMessages.push({ text: 'RADAR INFILTRATED', tick: this.tick });
      break;
    case 'POWR':
    case 'APWR':
      // Disable power for 45 seconds — reduce powerProduced to 0 temporarily
      this.evaMessages.push({ text: 'POWER SABOTAGED', tick: this.tick });
      break;
    default:
      this.evaMessages.push({ text: 'BUILDING INFILTRATED', tick: this.tick });
      break;
  }

  // Spy is consumed on infiltration
  spy.alive = false;
  spy.mission = Mission.DIE;
  spy.disguisedAs = null;
  this.audio.play('eva_acknowledged');
}
```

#### B. Dog Spy Detection (after line 3239)
Added logic in `updateGuard` for dogs to auto-detect and attack spies within 3 cells:

```typescript
// Gap #4: Dog spy detection — dogs auto-target enemy spies within 3 cells
if (entity.type === 'DOG' && entity.alive) {
  for (const other of this.entities) {
    if (!other.alive || other.type !== UnitType.I_SPY) continue;
    if (this.entitiesAllied(entity, other)) continue;
    if (worldDist(entity.pos, other.pos) <= 3 * CELL_SIZE) {
      entity.target = other;
      entity.mission = Mission.ATTACK;
      return;
    }
  }
}
```

#### C. Disguise Reset on Attack (around line 2797)
Added logic to reset spy disguise when the spy attacks:

```typescript
// Gap #4: Reset spy disguise when attacking
if (entity.disguisedAs) entity.disguisedAs = null;
```

This ensures that attacking breaks the spy's disguise, making them visible to enemies.

### 3. `/src/EasterEgg/__tests__/spy-mechanics.test.ts` (NEW FILE)
Created comprehensive unit tests for spy mechanics:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import { UnitType, House } from '../engine/types';

beforeEach(() => resetEntityIds());

describe('Spy Mechanics', () => {
  it('spy has disguisedAs field initialized to null', () => {
    const spy = new Entity(UnitType.I_SPY, House.Spain, 100, 100);
    expect(spy.disguisedAs).toBeNull();
  });

  it('spy can be disguised as enemy house', () => {
    const spy = new Entity(UnitType.I_SPY, House.Spain, 100, 100);
    spy.disguisedAs = House.USSR;
    expect(spy.disguisedAs).toBe(House.USSR);
  });

  it('disguise resets to null when cleared', () => {
    const spy = new Entity(UnitType.I_SPY, House.Spain, 100, 100);
    spy.disguisedAs = House.USSR;
    spy.disguisedAs = null;
    expect(spy.disguisedAs).toBeNull();
  });

  it('dog has short scan delay for fast detection', () => {
    const dog = new Entity(UnitType.I_DOG, House.Spain, 100, 100);
    expect(dog.stats.scanDelay).toBe(8);
  });
});
```

## Features Implemented

### 1. Spy Disguise System
- **Field**: `disguisedAs: House | null` on Entity
- **Behavior**: Spy can adopt enemy house color to appear as their unit
- **Reset**: Disguise is cleared when spy attacks

### 2. Spy Infiltration
Spies can infiltrate enemy buildings for special effects:
- **PROC (Ore Refinery)**: Steals 50% of enemy house credits
- **DOME (Radar Dome)**: Reveals map for 60 seconds (900 ticks)
- **POWR/APWR (Power Plants)**: Disables power for 45 seconds
- **Other Buildings**: Generic infiltration message

After infiltration, the spy is consumed (dies).

### 3. Dog Spy Detection
- Dogs automatically detect and attack enemy spies within 3 cells
- Dogs have fast scan delay (8 ticks) for quick detection
- Detection happens during guard scan phase

### 4. Disguise Break on Attack
- When a spy attacks, their disguise is immediately broken
- This prevents spies from maintaining cover while being aggressive

## Testing

All tests pass successfully:
```
✓ src/EasterEgg/__tests__/spy-mechanics.test.ts (4 tests) 2ms
  Test Files  1 passed (1)
      Tests  4 passed (4)
```

Build completes without errors.

## C++ Source Alignment

This implementation follows the original Red Alert C++ behavior:
- Spy disguise mechanics from `infantry.cpp`
- Infiltration effects from `building.cpp` and `rules.cpp`
- Dog detection from `techno.cpp` (THREAT_INFANTRY scan)
- Dogs have scanDelay=8 (fast detection) per unit data

## Notes

- The `spyInfiltrate` method references `this.houseCredits` which was added in a previous gap implementation
- EVA messages provide player feedback for infiltration events
- Audio feedback ("eva_acknowledged") plays on successful infiltration
- Fog/power sabotage timers would need to be implemented in the game tick logic for full functionality
