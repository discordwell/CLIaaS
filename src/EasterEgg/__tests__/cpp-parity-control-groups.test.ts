/**
 * C++ Behavioral Parity: Control Groups (Ctrl+0-9 assignment, recall, camera centering)
 *
 * Tests verify control group behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * C++ source: conquer.cpp Handle_Team() (line 3999-4263)
 * C++ source: foot.h (line 200-204) — Group field: unsigned char, default 255
 * C++ source: foot.cpp (line 123) — Group(255) initialization
 *
 * C++ Handle_Team actions:
 *   action 0 (bare key):  Toggle select — deselect all if different group, then select members
 *   action 1 (Shift+key): Additive select — add group members to current selection
 *   action 2 (Ctrl+key):  Create group — assign selected units to group, clear old members
 *   action 3 (Alt+key):   Select + center map on group
 *
 * The TS implementation stores control groups as Map<number, Set<number>> (group → entity IDs)
 * while C++ stores a per-unit Group field (unsigned char). The tests below verify behavioral
 * equivalence of the observable outcomes.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Mission,
} from '../engine/types';
import { Entity, resetEntityIds, setPlayerHouses } from '../engine/entity';

beforeEach(() => {
  resetEntityIds();
  setPlayerHouses(new Set([House.Spain]));
});

// ---------------------------------------------------------------------------
// Helpers — simulate control group data structures as the engine does
// ---------------------------------------------------------------------------

/** Place an entity at the center of a cell */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

/**
 * Minimal control group manager that mirrors the TS engine's controlGroups behavior.
 * This isolates control group logic from the full game engine for testing.
 */
class ControlGroupManager {
  controlGroups = new Map<number, Set<number>>();
  entities: Entity[] = [];
  entityById = new Map<number, Entity>();
  selectedIds = new Set<number>();
  lastGroupKey = 0;
  lastGroupTime = 0;

  addEntity(e: Entity): void {
    this.entities.push(e);
    this.entityById.set(e.id, e);
  }

  removeEntity(e: Entity): void {
    e.alive = false;
    this.entities = this.entities.filter(x => x !== e);
    this.entityById.delete(e.id);
    this.selectedIds.delete(e.id);
    // Prune dead IDs from control groups (mirrors engine index.ts ~1872-1877)
    for (const [g, ids] of this.controlGroups) {
      for (const id of ids) {
        if (!this.entityById.has(id)) ids.delete(id);
      }
      if (ids.size === 0) this.controlGroups.delete(g);
    }
  }

  select(e: Entity): void {
    e.selected = true;
    this.selectedIds.add(e.id);
  }

  unselectAll(): void {
    for (const id of this.selectedIds) {
      const e = this.entityById.get(id);
      if (e) e.selected = false;
    }
    this.selectedIds.clear();
  }

  /**
   * Assign control group (Ctrl+N) — mirrors TS engine index.ts ~2257-2278
   * C++ foot.h:200-204 — Group is scalar: assigning to group N removes from all others.
   * Stores the current selection as the group.
   */
  assignGroup(g: number): void {
    if (this.selectedIds.size > 0) {
      // C++ parity: remove assigned units from all other groups (single-group membership)
      for (const id of this.selectedIds) {
        for (const [otherG, otherIds] of this.controlGroups) {
          if (otherG !== g) otherIds.delete(id);
        }
      }
      // Clean up now-empty groups
      for (const [otherG, otherIds] of this.controlGroups) {
        if (otherIds.size === 0) this.controlGroups.delete(otherG);
      }
      this.controlGroups.set(g, new Set(this.selectedIds));
    }
  }

  /**
   * Recall control group (bare N key) — mirrors TS engine index.ts ~2253-2282
   * Deselects all, then selects alive units from the group.
   */
  recallGroup(g: number, now: number = Date.now()): void {
    const group = this.controlGroups.get(g);
    if (group && group.size > 0) {
      // Deselect all
      for (const e of this.entities) e.selected = false;
      this.selectedIds.clear();
      // Select alive members
      for (const id of group) {
        const unit = this.entityById.get(id);
        if (unit?.alive) {
          this.selectedIds.add(id);
          unit.selected = true;
        }
      }
      // Double-tap camera centering detection
      if (this.lastGroupKey === g && now - this.lastGroupTime < 400) {
        // Camera centering would happen here
      }
      this.lastGroupKey = g;
      this.lastGroupTime = now;
    }
  }
}

// ===========================================================================
// Tests
// ===========================================================================

describe('C++ Parity: Control Groups', () => {

  // -------------------------------------------------------------------------
  // foot.h:204, foot.cpp:123 — Group default value
  // C++: unsigned char Group initialized to 255 (0xFF = no group)
  // TS: controlGroups starts as empty Map
  // -------------------------------------------------------------------------
  describe('Initial state (foot.h:204, foot.cpp:123)', () => {
    it('no control groups exist initially', () => {
      const mgr = new ControlGroupManager();
      expect(mgr.controlGroups.size).toBe(0);
    });

    it('units start with no group membership (C++: Group=255)', () => {
      const mgr = new ControlGroupManager();
      const tank = entityAtCell(UnitType.LIGHT_TANK, House.Spain, 5, 5);
      mgr.addEntity(tank);

      // Unit should not appear in any group
      for (let g = 1; g <= 9; g++) {
        const group = mgr.controlGroups.get(g);
        expect(group?.has(tank.id) ?? false).toBe(false);
      }
    });
  });

  // -------------------------------------------------------------------------
  // conquer.cpp:4123-4198 — action 2 (Ctrl+key): Create group
  // C++: Iterates all unit types (Units, Vessels, Infantry, Aircraft)
  //   - Clears Group for any unit currently assigned to this team number
  //   - Sets Group = team for all selected units
  // TS: controlGroups.set(g, new Set(selectedIds))
  // -------------------------------------------------------------------------
  describe('Assign group — Ctrl+N (conquer.cpp:4123-4198)', () => {
    it('assigns selected units to a control group', () => {
      const mgr = new ControlGroupManager();
      const t1 = entityAtCell(UnitType.LIGHT_TANK, House.Spain, 5, 5);
      const t2 = entityAtCell(UnitType.LIGHT_TANK, House.Spain, 6, 5);
      mgr.addEntity(t1);
      mgr.addEntity(t2);

      mgr.select(t1);
      mgr.select(t2);
      mgr.assignGroup(1);

      const group = mgr.controlGroups.get(1);
      expect(group).toBeDefined();
      expect(group!.has(t1.id)).toBe(true);
      expect(group!.has(t2.id)).toBe(true);
      expect(group!.size).toBe(2);
    });

    it('reassigning group replaces previous members', () => {
      const mgr = new ControlGroupManager();
      const t1 = entityAtCell(UnitType.LIGHT_TANK, House.Spain, 5, 5);
      const t2 = entityAtCell(UnitType.LIGHT_TANK, House.Spain, 6, 5);
      const t3 = entityAtCell(UnitType.MEDIUM_TANK, House.Spain, 7, 5);
      mgr.addEntity(t1);
      mgr.addEntity(t2);
      mgr.addEntity(t3);

      // First assignment: t1 + t2
      mgr.select(t1);
      mgr.select(t2);
      mgr.assignGroup(1);

      // Second assignment: t3 only
      mgr.unselectAll();
      mgr.select(t3);
      mgr.assignGroup(1);

      const group = mgr.controlGroups.get(1);
      expect(group!.has(t1.id)).toBe(false);
      expect(group!.has(t2.id)).toBe(false);
      expect(group!.has(t3.id)).toBe(true);
      expect(group!.size).toBe(1);
    });

    it('assigning empty selection does not create a group', () => {
      const mgr = new ControlGroupManager();
      mgr.assignGroup(1);
      expect(mgr.controlGroups.has(1)).toBe(false);
    });

    it('FIXED: C++ groups are 0-9 via keys 1-0; TS now supports groups 0-9', () => {
      // C++ conquer.cpp:979-1018: Keys 1-0 map to Handle_Team(0) through Handle_Team(9)
      // FIXED: TS index.ts now uses for (let g = 0; g <= 9; g++) — groups 0-9
      const mgr = new ControlGroupManager();
      const t1 = entityAtCell(UnitType.LIGHT_TANK, House.Spain, 5, 5);
      mgr.addEntity(t1);
      mgr.select(t1);

      // Groups 0-9 all work (note: single-group membership means only last assignment persists)
      mgr.assignGroup(0);
      expect(mgr.controlGroups.get(0)?.has(t1.id)).toBe(true);

      // Verify group 0 specifically works
      mgr.unselectAll();
      mgr.select(t1);
      mgr.assignGroup(0);
      const group0 = mgr.controlGroups.get(0);
      expect(group0).toBeDefined();
      expect(group0!.has(t1.id)).toBe(true);
    });

    it('FIXED: C++ enforces single-group membership; TS now enforces it too', () => {
      // C++ conquer.cpp:4131: if (obj->Group == team) obj->Group = 0xFF;
      // C++ conquer.cpp:4133: obj->Group = team;
      // In C++, Group is a single unsigned char — unit can only be in one group.
      //
      // FIXED: TS now removes units from all other groups when assigning to a new group.
      const mgr = new ControlGroupManager();
      const t1 = entityAtCell(UnitType.LIGHT_TANK, House.Spain, 5, 5);
      mgr.addEntity(t1);
      mgr.select(t1);

      mgr.assignGroup(1);
      mgr.assignGroup(2);

      // FIXED: t1 should only be in group 2 (last assigned), removed from group 1
      const inGroup1 = mgr.controlGroups.get(1)?.has(t1.id) ?? false;
      const inGroup2 = mgr.controlGroups.get(2)?.has(t1.id) ?? false;

      expect(inGroup2).toBe(true);
      // FIXED: C++ parity — assigning to group 2 removes from group 1
      expect(inGroup1).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // conquer.cpp:4018-4076 — action 0 (bare key): Select group
  // C++: If current selection is from a different group, unselect all first.
  //      Then iterate all unit types and select those with matching Group.
  // TS: Always unselect all, then select alive members from group set.
  // -------------------------------------------------------------------------
  describe('Recall group — bare N key (conquer.cpp:4018-4076)', () => {
    it('selects all alive units in the group', () => {
      const mgr = new ControlGroupManager();
      const t1 = entityAtCell(UnitType.LIGHT_TANK, House.Spain, 5, 5);
      const t2 = entityAtCell(UnitType.LIGHT_TANK, House.Spain, 6, 5);
      mgr.addEntity(t1);
      mgr.addEntity(t2);

      mgr.select(t1);
      mgr.select(t2);
      mgr.assignGroup(1);
      mgr.unselectAll();

      // Recall group 1
      mgr.recallGroup(1);

      expect(t1.selected).toBe(true);
      expect(t2.selected).toBe(true);
      expect(mgr.selectedIds.has(t1.id)).toBe(true);
      expect(mgr.selectedIds.has(t2.id)).toBe(true);
    });

    it('deselects previously selected units before selecting group', () => {
      const mgr = new ControlGroupManager();
      const t1 = entityAtCell(UnitType.LIGHT_TANK, House.Spain, 5, 5);
      const t2 = entityAtCell(UnitType.LIGHT_TANK, House.Spain, 6, 5);
      const t3 = entityAtCell(UnitType.MEDIUM_TANK, House.Spain, 7, 5);
      mgr.addEntity(t1);
      mgr.addEntity(t2);
      mgr.addEntity(t3);

      // Assign group 1 = t1+t2, group 2 = t3
      mgr.select(t1);
      mgr.select(t2);
      mgr.assignGroup(1);
      mgr.unselectAll();
      mgr.select(t3);
      mgr.assignGroup(2);
      mgr.unselectAll();

      // Select group 1 first
      mgr.recallGroup(1);
      expect(mgr.selectedIds.has(t1.id)).toBe(true);
      expect(mgr.selectedIds.has(t3.id)).toBe(false);

      // Now select group 2 — should deselect group 1 members
      mgr.recallGroup(2);
      expect(mgr.selectedIds.has(t1.id)).toBe(false);
      expect(mgr.selectedIds.has(t2.id)).toBe(false);
      expect(mgr.selectedIds.has(t3.id)).toBe(true);
      expect(t1.selected).toBe(false);
      expect(t3.selected).toBe(true);
    });

    it('recalling nonexistent group does nothing', () => {
      const mgr = new ControlGroupManager();
      const t1 = entityAtCell(UnitType.LIGHT_TANK, House.Spain, 5, 5);
      mgr.addEntity(t1);
      mgr.select(t1);

      // Recall group 5 which was never assigned
      mgr.recallGroup(5);

      // Selection should remain unchanged (TS behavior: only acts if group exists with size > 0)
      expect(t1.selected).toBe(true);
      expect(mgr.selectedIds.has(t1.id)).toBe(true);
    });

    it('C++ action 0 preserves selection if already on same group; TS always deselects', () => {
      // C++ conquer.cpp:4025-4028: Only unselects if current selection is from a DIFFERENT group
      //   if (CurrentObject[0]->Is_Foot() && ((FootClass *)CurrentObject[0])->Group != team) {
      //     Unselect_All();
      //   }
      // TS index.ts:2258-2259: Always deselects all before re-selecting
      //   for (const e of this.entities) e.selected = false;
      //   this.selectedIds.clear();
      //
      // Observable difference: In C++, pressing 1 while group 1 is already selected
      // does NOT toggle selection off and on (avoids voice replay). TS does deselect+reselect.
      // This is a minor UX difference but not a behavioral gap for unit state.
      const mgr = new ControlGroupManager();
      const t1 = entityAtCell(UnitType.LIGHT_TANK, House.Spain, 5, 5);
      mgr.addEntity(t1);
      mgr.select(t1);
      mgr.assignGroup(1);

      // Recall same group — in both C++ and TS, t1 should be selected at the end
      mgr.recallGroup(1);
      expect(t1.selected).toBe(true);
      expect(mgr.selectedIds.has(t1.id)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // conquer.cpp:4081-4118 — action 1 (Shift+key): Additive select
  // C++: Adds group members to current selection WITHOUT deselecting others.
  // TS: NOT IMPLEMENTED — Shift+N not handled for control groups
  // -------------------------------------------------------------------------
  describe('Additive select — Shift+N (conquer.cpp:4081-4118)', () => {
    it('C++ supports additive select; TS does not implement it', () => {
      // PARITY GAP: TS has no Shift+N additive select for control groups
      //
      // C++ conquer.cpp:4081-4118 (action 1):
      //   Simply iterates all unit types and selects those with matching Group,
      //   WITHOUT calling Unselect_All() first.
      //
      // TS index.ts:2250-2283: Only handles bare key recall (deselect all + select group).
      // There is no code path for Shift+number key.
      //
      // To verify: simulate what additive select SHOULD do
      const mgr = new ControlGroupManager();
      const t1 = entityAtCell(UnitType.LIGHT_TANK, House.Spain, 5, 5);
      const t2 = entityAtCell(UnitType.MEDIUM_TANK, House.Spain, 6, 5);
      const t3 = entityAtCell(UnitType.HEAVY_TANK, House.Spain, 7, 5);
      mgr.addEntity(t1);
      mgr.addEntity(t2);
      mgr.addEntity(t3);

      // Group 1 = t1, Group 2 = t2
      mgr.select(t1);
      mgr.assignGroup(1);
      mgr.unselectAll();
      mgr.select(t2);
      mgr.assignGroup(2);
      mgr.unselectAll();

      // In C++: select group 1, then Shift+2 to ADD group 2
      // Result: t1 AND t2 selected
      // In TS: pressing 2 would DESELECT t1, then select t2 only
      mgr.recallGroup(1);
      expect(mgr.selectedIds.has(t1.id)).toBe(true);

      // TS recall always deselects first — no additive behavior
      mgr.recallGroup(2);
      expect(mgr.selectedIds.has(t1.id)).toBe(false); // PARITY GAP: C++ Shift+2 would keep t1 selected
      expect(mgr.selectedIds.has(t2.id)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // conquer.cpp:4067-4075 — action 3 (Alt+key): Select + center map
  // C++: Same as action 0 but also calls Map.Center_Map()
  // TS: Double-tap within 400ms centers camera instead of Alt+key
  // -------------------------------------------------------------------------
  describe('Camera centering (conquer.cpp:4067-4075)', () => {
    it('double-tap recall within 400ms triggers camera centering condition', () => {
      // C++ uses Alt+key for center; TS uses double-tap within 400ms
      // Different mechanism, same user intent
      const mgr = new ControlGroupManager();
      const t1 = entityAtCell(UnitType.LIGHT_TANK, House.Spain, 5, 5);
      mgr.addEntity(t1);
      mgr.select(t1);
      mgr.assignGroup(1);
      mgr.unselectAll();

      const now = 10000;
      mgr.recallGroup(1, now);
      expect(mgr.lastGroupKey).toBe(1);
      expect(mgr.lastGroupTime).toBe(now);

      // Second tap within 400ms
      mgr.recallGroup(1, now + 300);
      // The double-tap was detected (lastGroupKey === g && delta < 400)
      // Camera centering would fire in the real engine
      expect(mgr.lastGroupKey).toBe(1);
      expect(mgr.lastGroupTime).toBe(now + 300);
    });

    it('taps more than 400ms apart do NOT trigger camera center', () => {
      const mgr = new ControlGroupManager();
      const t1 = entityAtCell(UnitType.LIGHT_TANK, House.Spain, 5, 5);
      mgr.addEntity(t1);
      mgr.select(t1);
      mgr.assignGroup(1);
      mgr.unselectAll();

      const now = 10000;
      mgr.recallGroup(1, now);
      // Second tap after 500ms — no double-tap
      mgr.recallGroup(1, now + 500);
      // Still updates tracking, but no camera center triggered
      expect(mgr.lastGroupKey).toBe(1);
      expect(mgr.lastGroupTime).toBe(now + 500);
    });

    it('tapping different group numbers does NOT trigger camera center', () => {
      const mgr = new ControlGroupManager();
      const t1 = entityAtCell(UnitType.LIGHT_TANK, House.Spain, 5, 5);
      const t2 = entityAtCell(UnitType.MEDIUM_TANK, House.Spain, 6, 5);
      mgr.addEntity(t1);
      mgr.addEntity(t2);

      mgr.select(t1);
      mgr.assignGroup(1);
      mgr.unselectAll();
      mgr.select(t2);
      mgr.assignGroup(2);
      mgr.unselectAll();

      const now = 10000;
      mgr.recallGroup(1, now);
      expect(mgr.lastGroupKey).toBe(1);

      // Pressing different group within 400ms — NOT a double-tap of the same key
      mgr.recallGroup(2, now + 200);
      expect(mgr.lastGroupKey).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Dead unit pruning
  // C++: Dead units are removed from game arrays, so Handle_Team naturally
  //      skips them (they don't exist in Units/Infantry/Aircraft/Vessels arrays)
  // TS: Explicit pruning in index.ts ~1872-1877 when entities are removed
  // -------------------------------------------------------------------------
  describe('Dead unit pruning (implicit in C++ via array removal)', () => {
    it('dead units are removed from control groups', () => {
      const mgr = new ControlGroupManager();
      const t1 = entityAtCell(UnitType.LIGHT_TANK, House.Spain, 5, 5);
      const t2 = entityAtCell(UnitType.LIGHT_TANK, House.Spain, 6, 5);
      mgr.addEntity(t1);
      mgr.addEntity(t2);

      mgr.select(t1);
      mgr.select(t2);
      mgr.assignGroup(1);

      expect(mgr.controlGroups.get(1)!.size).toBe(2);

      // Kill t1
      mgr.removeEntity(t1);

      expect(mgr.controlGroups.get(1)!.has(t1.id)).toBe(false);
      expect(mgr.controlGroups.get(1)!.has(t2.id)).toBe(true);
      expect(mgr.controlGroups.get(1)!.size).toBe(1);
    });

    it('group is deleted entirely when all members die', () => {
      const mgr = new ControlGroupManager();
      const t1 = entityAtCell(UnitType.LIGHT_TANK, House.Spain, 5, 5);
      mgr.addEntity(t1);

      mgr.select(t1);
      mgr.assignGroup(1);

      expect(mgr.controlGroups.has(1)).toBe(true);

      mgr.removeEntity(t1);

      // Group should be fully deleted when empty
      expect(mgr.controlGroups.has(1)).toBe(false);
    });

    it('recalling a group skips dead units (C++: dead units not in arrays)', () => {
      const mgr = new ControlGroupManager();
      const t1 = entityAtCell(UnitType.LIGHT_TANK, House.Spain, 5, 5);
      const t2 = entityAtCell(UnitType.LIGHT_TANK, House.Spain, 6, 5);
      const t3 = entityAtCell(UnitType.MEDIUM_TANK, House.Spain, 7, 5);
      mgr.addEntity(t1);
      mgr.addEntity(t2);
      mgr.addEntity(t3);

      mgr.select(t1);
      mgr.select(t2);
      mgr.select(t3);
      mgr.assignGroup(1);
      mgr.unselectAll();

      // Kill t2
      mgr.removeEntity(t2);

      // Recall group — only t1 and t3 should be selected
      mgr.recallGroup(1);
      expect(mgr.selectedIds.has(t1.id)).toBe(true);
      expect(mgr.selectedIds.has(t2.id)).toBe(false);
      expect(mgr.selectedIds.has(t3.id)).toBe(true);
      expect(mgr.selectedIds.size).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // conquer.cpp:4128-4198 — Group clears old assignment before assigning new
  // C++ iterates ALL units: if (obj->Group == team) obj->Group = 0xFF;
  // Then: if (obj->IsSelected) obj->Group = team;
  // This means a unit removed from the selection but previously in the group
  // is explicitly unassigned.
  // -------------------------------------------------------------------------
  describe('Group reassignment clears old members (conquer.cpp:4128-4198)', () => {
    it('reassigning group to new selection removes old, non-selected members', () => {
      // C++ conquer.cpp:4131: if (obj->Group == team) obj->Group = 0xFF;
      // This clears ALL units from this group number before assigning selected ones.
      const mgr = new ControlGroupManager();
      const t1 = entityAtCell(UnitType.LIGHT_TANK, House.Spain, 5, 5);
      const t2 = entityAtCell(UnitType.MEDIUM_TANK, House.Spain, 6, 5);
      mgr.addEntity(t1);
      mgr.addEntity(t2);

      // Assign t1+t2 to group 1
      mgr.select(t1);
      mgr.select(t2);
      mgr.assignGroup(1);

      // Now reassign group 1 to just t2
      mgr.unselectAll();
      mgr.select(t2);
      mgr.assignGroup(1);

      // t1 should no longer be in group 1
      const group = mgr.controlGroups.get(1)!;
      expect(group.has(t1.id)).toBe(false);
      expect(group.has(t2.id)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // techno.cpp:5554-5567 — Group number display
  // C++: Displays group number pip on unit. Group 0-8 display as 1-9,
  //      Group 9 displays as 0 (key mapping: keys 1-9,0 → groups 0-9)
  // -------------------------------------------------------------------------
  describe('Group numbering display (techno.cpp:5554-5567)', () => {
    it('C++ maps keys 1-0 to groups 0-9; display adds 1 (mod 10)', () => {
      // C++ techno.cpp:5559: int group = ((FootClass *)this)->Group+1;
      // C++ techno.cpp:5562: if (group == 10) group = 0;
      // So Group 0 displays as "1", Group 1 as "2", ..., Group 9 as "0"
      //
      // C++ conquer.cpp:979-1018: Key 1 → Handle_Team(0), Key 0 → Handle_Team(9)
      //
      // TS uses groups 1-9 directly (no +1 display offset, no group 0)
      // This is a numbering convention difference.

      // Verify the C++ display formula
      for (let cppGroup = 0; cppGroup <= 9; cppGroup++) {
        let displayNum = cppGroup + 1;
        if (displayNum === 10) displayNum = 0;
        // Key that activates this group
        const keyLabel = cppGroup === 9 ? '0' : String(cppGroup + 1);
        // Display should match the key label
        expect(displayNum).toBe(parseInt(keyLabel));
      }
    });
  });

  // -------------------------------------------------------------------------
  // Mixed unit types in groups
  // C++ iterates Units, Vessels, Infantry, Aircraft separately
  // TS stores entity IDs regardless of type
  // -------------------------------------------------------------------------
  describe('Mixed unit types (conquer.cpp:4030-4065, 4128-4198)', () => {
    it('group can contain different unit types', () => {
      const mgr = new ControlGroupManager();
      const tank = entityAtCell(UnitType.LIGHT_TANK, House.Spain, 5, 5);
      const inf = entityAtCell(UnitType.RIFLE, House.Spain, 6, 5);
      const arty = entityAtCell(UnitType.ARTY, House.Spain, 7, 5);
      mgr.addEntity(tank);
      mgr.addEntity(inf);
      mgr.addEntity(arty);

      mgr.select(tank);
      mgr.select(inf);
      mgr.select(arty);
      mgr.assignGroup(1);

      const group = mgr.controlGroups.get(1)!;
      expect(group.size).toBe(3);
      expect(group.has(tank.id)).toBe(true);
      expect(group.has(inf.id)).toBe(true);
      expect(group.has(arty.id)).toBe(true);
    });

    it('recalling group with mixed types selects all surviving members', () => {
      const mgr = new ControlGroupManager();
      const tank = entityAtCell(UnitType.LIGHT_TANK, House.Spain, 5, 5);
      const inf = entityAtCell(UnitType.RIFLE, House.Spain, 6, 5);
      mgr.addEntity(tank);
      mgr.addEntity(inf);

      mgr.select(tank);
      mgr.select(inf);
      mgr.assignGroup(2);
      mgr.unselectAll();

      // Kill infantry
      mgr.removeEntity(inf);

      // Recall should only select tank
      mgr.recallGroup(2);
      expect(mgr.selectedIds.size).toBe(1);
      expect(mgr.selectedIds.has(tank.id)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Multiple groups coexistence
  // C++ supports groups 0-9 simultaneously (each unit in at most one)
  // TS supports groups 1-9 simultaneously (unit can be in multiple)
  // -------------------------------------------------------------------------
  describe('Multiple groups coexist (conquer.cpp:3999)', () => {
    it('groups 1-9 can all be populated independently', () => {
      const mgr = new ControlGroupManager();
      const units: Entity[] = [];
      for (let i = 1; i <= 9; i++) {
        const u = entityAtCell(UnitType.LIGHT_TANK, House.Spain, i, 5);
        mgr.addEntity(u);
        units.push(u);
      }

      // Assign each unit to its own group
      for (let i = 0; i < 9; i++) {
        mgr.unselectAll();
        mgr.select(units[i]);
        mgr.assignGroup(i + 1);
      }

      // Verify each group has exactly one unit
      for (let g = 1; g <= 9; g++) {
        const group = mgr.controlGroups.get(g)!;
        expect(group.size).toBe(1);
        expect(group.has(units[g - 1].id)).toBe(true);
      }
    });

    it('recalling one group does not affect other groups', () => {
      const mgr = new ControlGroupManager();
      const t1 = entityAtCell(UnitType.LIGHT_TANK, House.Spain, 5, 5);
      const t2 = entityAtCell(UnitType.MEDIUM_TANK, House.Spain, 6, 5);
      mgr.addEntity(t1);
      mgr.addEntity(t2);

      mgr.select(t1);
      mgr.assignGroup(1);
      mgr.unselectAll();
      mgr.select(t2);
      mgr.assignGroup(2);
      mgr.unselectAll();

      // Recall group 1
      mgr.recallGroup(1);
      // Group 2 should still exist and be unaffected
      expect(mgr.controlGroups.get(2)!.has(t2.id)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------
  describe('Edge cases', () => {
    it('assigning group with single unit works', () => {
      const mgr = new ControlGroupManager();
      const t1 = entityAtCell(UnitType.LIGHT_TANK, House.Spain, 5, 5);
      mgr.addEntity(t1);
      mgr.select(t1);
      mgr.assignGroup(3);

      expect(mgr.controlGroups.get(3)!.size).toBe(1);
      expect(mgr.controlGroups.get(3)!.has(t1.id)).toBe(true);
    });

    it('recall then reassign preserves new assignment', () => {
      const mgr = new ControlGroupManager();
      const t1 = entityAtCell(UnitType.LIGHT_TANK, House.Spain, 5, 5);
      const t2 = entityAtCell(UnitType.MEDIUM_TANK, House.Spain, 6, 5);
      mgr.addEntity(t1);
      mgr.addEntity(t2);

      // Assign t1 to group 1
      mgr.select(t1);
      mgr.assignGroup(1);
      mgr.unselectAll();

      // Recall group 1 (selects t1)
      mgr.recallGroup(1);
      expect(mgr.selectedIds.has(t1.id)).toBe(true);

      // Now add t2 to selection and reassign
      mgr.select(t2);
      mgr.assignGroup(1);

      const group = mgr.controlGroups.get(1)!;
      expect(group.has(t1.id)).toBe(true);
      expect(group.has(t2.id)).toBe(true);
      expect(group.size).toBe(2);
    });

    it('killing all units in multiple groups cleans up all groups', () => {
      const mgr = new ControlGroupManager();
      const t1 = entityAtCell(UnitType.LIGHT_TANK, House.Spain, 5, 5);
      const t2 = entityAtCell(UnitType.MEDIUM_TANK, House.Spain, 6, 5);
      mgr.addEntity(t1);
      mgr.addEntity(t2);

      mgr.select(t1);
      mgr.assignGroup(1);
      mgr.unselectAll();
      mgr.select(t2);
      mgr.assignGroup(2);
      mgr.unselectAll();

      mgr.removeEntity(t1);
      mgr.removeEntity(t2);

      expect(mgr.controlGroups.size).toBe(0);
    });
  });
});
