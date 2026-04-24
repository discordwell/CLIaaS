# Dossier: PCP chain over-fire (mission-timing family)

**Affects:** SCG04EA t24, SCG11EA t19, SCG03EA t238 (presumed same class)
**Prior work:** Round-2 Session 16 added `skipCommence` to chain PCP calls
(benign — no tick movement).

## Symptom

TS fires a Mission_Move/Guard RNG call 1 tick before WASM fires it. The cell
position of the firing entity matches WASM's position; it's a pure timing
difference of when the MissionQueue pops to Mission.

## C++ reference flow

### DriveClass::AI per-tick movement (drive.cpp:1304-1399)

```cpp
void DriveClass::AI(void)
{
  FootClass::AI();
  if (!IsActive || Height > 0) return;

  // ... While_Moving loop ...
  while (actual > PIXEL_LEPTON_W) {    // drive.cpp:719
    actual -= PIXEL_LEPTON_W;
    // ... move one lepton step ...

    if (TrackIndex && RawTracks[tracknum-1].Cell == TrackIndex) {
      Per_Cell_Process(PCP_DURING);              // drive.cpp:737 — midpoint
    }

    // Track-jump path (only if direction changing):
    if (nextface != FACING_NONE && adj && RawTracks[tracknum-1].Jump == TrackIndex) {
      // adj=true iff direction changes
      Stop_Driver();
      IsDriving = true;
      Per_Cell_Process(PCP_END);               // drive.cpp:773 — jump PCP
      IsDriving = false;
      Start_Driver(c);                          // new track
    }
  }

  // At speed budget exhaustion (actual==0):
  Stop_Driver();
  Per_Cell_Process(PCP_END);                   // drive.cpp:816 — terminal PCP
}
```

**Key invariant:** PCP_END fires only at:
1. Direction-change cell boundaries (drive.cpp:773) when `adj=true`.
2. Speed budget exhaustion (drive.cpp:816) — ONCE per tick.

For a straight-line path (SE-SE-SE), `adj=false` at every intermediate cell,
so only the final-boundary PCP fires per tick. If the tick's speed budget
takes the unit across 2 cells, PCP_END fires ONCE at the 2nd cell.

### UnitClass::Per_Cell_Process → Commence (unit.cpp:1777-1779)

```cpp
if (!IsDumping) {
  Commence();
}
```

Commence unconditionally pops MissionQueue if set.

### Lifecycle example — drive-in-GUARD

Unit in Mission=GUARD with mq=MOVE and NavCom=far-target. drv=T (Start_Driver
fired from Team.AI coordinateMove's Assign_Destination).

Per tick:
1. drive.cpp:1304 DriveClass::AI executes
2. While_Moving loop: advances speed budget, moves leptons
3. Enter new cell (SE direction continuous): `adj=false` → no PCP_END at track-jump site
4. Speed budget runs out mid-cell (actual==0) → drive.cpp:816 PCP_END
5. unit.cpp:1777 Commence() pops mq=MOVE → Mission=MOVE, Timer=0

Here's the key: **Commence pops at the SPEED BOUNDARY, not at each cell.**
If the unit moves 1 cell per tick cleanly, Commence fires per tick. If the
unit moves <1 cell or is mid-cell at actual==0, Commence still fires.

But: `Team.AI` runs every tick and re-queues `Assign_Mission(MISSION_MOVE)`
(no-op per mission.cpp:388 when Mission==MOVE). So after first pop, Mission
stays MOVE forever.

Except... observed WASM keeps `Mission=GUARD mq=MOVE` for many ticks in SCG04.
So something else is queuing GUARD and un-popping. Root cause from Round-2
Session 10: `TeamClass::Coordinate_Regroup` re-assigns GUARD when unit is
near Zone. Creates an oscillation.

Actually wait, SCG04 W[1] was part of a team in TMISSION_MOVE (not regroup).
Coordinate_Move doesn't re-queue GUARD. So something else keeps it in GUARD.

## TS implementation

### Chain loop (index.ts:6269-6377)

```typescript
const MAX_CHAIN = 4;
for (let chain = 0; chain < MAX_CHAIN; chain++) {
  const chainCell = entity.path[entity.pathIndex];
  if (!chainCell) break;

  if (entity.trackNumber > 0) {
    if (this.followTrackStep(...)) {
      // Track complete
      entity.pathIndex += entity.trackCellSpan;
      if (perCellNavComCheck(true)) break;    // Session 16: skipCommence=true
      continue;
    }
    break;  // Track not complete, done for tick
  }

  // Initiate new track
  // ... smoothTurn, lookup TrackControl ...
  entity.isDriving = true;
  if (this.followTrackStep(...)) {
    entity.pathIndex += entity.trackCellSpan;
    if (perCellNavComCheck(true)) break;
    continue;
  }
  break;
}
```

### followTrackStep sets isDriving=false on track completion (index.ts:7269, 7283)

```typescript
if (entity.trackIndex >= track!.length) {
  // Track completed
  entity.speedAccum = 0;
  if (!entity.stats.isInfantry) entity.isDriving = false;
  entity.cellBoundaryCrossings++;
  return true;
}
```

### STAGE E post-Movement Commence (index.ts:4161-4174)

```typescript
const blockCommenceDrive = !entity.stats.isInfantry && !entity.isAirUnit && entity.isDriving;
if (entity.missionQueue !== null && !entity.isFiringAnim &&
    entity.nonInterruptAnimTicks <= 0 && !blockCommenceDrive) {
  entity.mission = entity.missionQueue;
  entity.missionQueue = null;
  entity.missionTimer = 0;
}
```

## Why Session 16's skipCommence was benign

Chain loop's `perCellNavComCheck(true)` defers Commence. BUT:
1. `followTrackStep` sets `isDriving=false` at track end (index.ts:7269, 7283).
2. Chain loop exits when track not complete OR path exhausted.
3. After chain exits, STAGE E runs. `blockCommenceDrive` checks `isDriving`.
4. If `isDriving=false` (track completed), STAGE E fires Commence → same-tick pop.

Net: Commence still happens at end-of-tick via STAGE E. No timing change.

## The actual C++ invariant that TS is missing

**C++ keeps `IsDriving=true` across intermediate cells on a continuous track.**

In C++:
- `Start_Driver(c)` sets `IsDriving=true` when new cell-to-cell track starts.
- `Stop_Driver()` sets `IsDriving=false`.
- During multi-cell chained movement, drive.cpp alternates:
  - drive.cpp:771 `Stop_Driver()` (IsDriving=false momentarily)
  - drive.cpp:772 `IsDriving = true` (explicit re-set for PCP)
  - drive.cpp:773 `Per_Cell_Process(PCP_END)` — Commence can fire here
  - drive.cpp:774 `IsDriving = false`
  - drive.cpp:776 `Start_Driver(c)` → `IsDriving=true` again

So IsDriving IS flipped briefly around each PCP. But the end-of-tick state
(after Stop_Driver at drive.cpp:808) is `IsDriving=false` only when the
unit stops moving for this tick (speed budget exhausted + no new track
started).

**However:** Commence inside PCP fires on every PCP_END call, regardless of
the transient IsDriving state. So C++ fires Commence at EVERY PCP boundary
too. Then why doesn't WASM pop mq=MOVE at SCG04 t24?

**Possible answer:** In C++, after Commence pops mq=MOVE → Mission=MOVE,
Team.AI Coord_Move re-queues MOVE (no-op). But something ELSE re-queues
GUARD that puts mq=GUARD next tick, then Commence pops it to Mission=GUARD,
and the cycle re-starts. OR Enter_Idle_Mode fires after arrival.

This is the part we don't fully understand yet. Phase 3 should instrument
C++'s actual Mission/MissionQueue transitions per tick for SCG04 unit[2]
Frame 20-30 and confirm.

## Phase 3 confirmation plan

Add WASM agent_debug_log:

1. **Commence call site in Per_Cell_Process** (unit.cpp:1778):
   Log `Frame, Units.ID(this), Mission, MissionQueue, IsDriving` BEFORE
   Commence runs, AND after. Tag 9000000+Frame.

2. **MissionClass::Commence return path** (mission.cpp:347):
   Log `Frame, Mission, MissionQueue` when Commence actually pops.
   Tag 9100000+Frame.

3. **Assign_Mission entry** (mission.cpp:379):
   Log `Frame, entity_id, order, current_Mission`. Catches re-assignment
   events. Tag 9200000+Frame.

4. **Enter_Idle_Mode** (if any enters this for SCG04 unit[2]):
   Log entry. Tag 9300000+Frame.

Narrow to Frame 20-30 for SCG04EA.

Expected confirmations:
- Does Commence actually fire at SCG04 Frame 24-25 for unit[2]?
- If so, does Mission transition MOVE→GUARD somewhere else mid-cycle?
- If Commence doesn't fire, what blocks it? (It's only gated by `!IsDumping`.)

## C++ refs

- `drive.cpp:706-828` DriveClass::AI while-moving loop
- `drive.cpp:771-776` track-jump PCP_END bracket
- `drive.cpp:816` terminal PCP_END
- `unit.cpp:1777-1779` Commence inside Per_Cell_Process
- `mission.cpp:343-359` Commence
- `mission.cpp:379-391` Assign_Mission
- `team.cpp:1745-1789` TeamClass::Coordinate_Regroup (re-queue GUARD path)

## TS refs

- `src/EasterEgg/engine/index.ts:6269-6377` chain loop
- `src/EasterEgg/engine/index.ts:7210+` followTrackStep (isDriving flip)
- `src/EasterEgg/engine/index.ts:4088-4102` STAGE A pre-Commence
- `src/EasterEgg/engine/index.ts:4159-4174` STAGE E post-Commence
- `src/EasterEgg/engine/perCellProcess.ts:1075-1083` Commence sub-case (skipCommence option)
- `src/EasterEgg/engine/team.ts:761-850` coordinateRegroup
