/**
 * C++ Behavioral Parity: vessel INI facing initialization.
 *
 * C++ VesselClass constructs SecondaryFacing from the default PrimaryFacing,
 * then VesselClass::Read_INI applies the scenario facing to PrimaryFacing.
 * It does not apply the INI facing to SecondaryFacing. Turreted vessels loaded
 * from a scenario therefore can start with body facing != turret facing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadScenario } from '../engine/scenario';
import { COS_TABLE_256, Dir, House, SIN_TABLE_256, UnitType } from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';

function installScenarioFetch(): void {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.pathname
        : input.url;
    const path = resolve(__dirname, '../../../public', url.replace(/^\//, ''));
    try {
      const text = readFileSync(path, 'utf8');
      return { ok: true, text: async () => text };
    } catch {
      return { ok: false, status: 404, text: async () => 'Not found' };
    }
  });
}

describe('vessel scenario INI facing initialization (C++ VesselClass::Read_INI)', () => {
  beforeEach(() => {
    resetEntityIds();
    installScenarioFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('SCG07EA turreted PT boats load body facing from INI but keep turret north', async () => {
    const scenario = await loadScenario('SCG07EA');
    const pts = scenario.entities.filter(e =>
      e.type === UnitType.V_PT &&
      e.house === House.Greece &&
      e.isNavalUnit &&
      e.hasTurret);

    expect(pts).toHaveLength(2);
    for (const pt of pts) {
      expect(pt.bodyFacing256).toBe(64);
      expect(pt.facing).toBe(Dir.E);
      expect(pt.desiredFacing).toBe(Dir.E);

      // C++ starts VesselClass::SecondaryFacing at the constructor default.
      // Combat_AI later rotates it toward TarCom; Can_Fire returns FIRE_ROTATING
      // until it catches up.
      expect(pt.turretFacing256).toBe(0);
      expect(pt.desiredTurretFacing256).toBe(0);
      expect(pt.turretFacing).toBe(Dir.N);
      expect(pt.desiredTurretFacing).toBe(Dir.N);
      expect(pt.turretFacing32).toBe(0);
      expect(pt.prevTurretFacing32).toBe(0);
    }
  });

  it('PT Fire_Coord applies VesselClass offsets for secondary DepthCharge', () => {
    const pt = new Entity(UnitType.V_PT, House.Greece, 0, 0);
    pt.leptonX = 4992;
    pt.leptonY = 13696;
    pt.syncPosFromLeptons();
    pt.bodyFacing256 = 64;
    pt.facing = Dir.E;
    pt.turretFacing256 = 63;
    pt.turretFacing = Dir.E;
    pt.turretFacing32 = 8;

    const move = (coord: { lx: number; ly: number }, dir256: number, dist: number) => ({
      lx: coord.lx + ((COS_TABLE_256[dir256 & 0xFF] * dist) >> 7),
      ly: coord.ly - ((SIN_TABLE_256[dir256 & 0xFF] * dist) >> 7),
    });
    let expected = { lx: 4992, ly: 13696 };
    expected = move(expected, 64, 0x0080);
    expected = move(expected, 0, 0x0020);
    expected = move(expected, 63, 0x0010);

    // C++ vessel.cpp:1177-1180 ignores `which`; both 2Inch and DepthCharge use
    // PrimaryFacing 0x80, north 0x20, then Turret_Facing 0x10.
    expect(pt.fireCoordForWeapon(pt.weapon2)).toEqual(expected);
    expect(pt.fireCoordForWeapon(pt.weapon2).lx).toBeGreaterThan(pt.leptonX + 120);
  });
});
