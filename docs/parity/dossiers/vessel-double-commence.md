# Dossier: Vessel double-Commence with IsDoorClosed gate

**Affects:** SCG07EA first-divergence tick 4
**Prior attempts:** 2 reverts (R1 S7 broad gate, R2 S25 narrow gate)

## Phase 3b finding — actual SCG07 t4 mechanism identified

Per-team state diff (`test-team-state-diff.ts`) + per-vessel state diff
(`test-per-cell-diff.ts`) at SCG07EA ticks 1-5 confirms:

- WASM subz team has `rf=true` (IsReforming) at **end-of-tick-4** but its
  Coord_Move has already run earlier in tick 4's Team.AI — so rf flips
  POST-execute (likely via `Lagging_Units` check in team.cpp).
- At tick 4, WASM fires 2 Mission_Move for vessels [85], [86]. The **3rd
  vessel [87]** doesn't fire at tick 4 — it fires at tick 6.
- C++ mechanism (per `cpp-parity-scg07ea-tick-4.test.ts` docstring):
  Start_Driver + Mark_Track cell-reservation conflict (`vessel.cpp:2104-2113`).
  The 3rd sub's Basic_Path is blocked by the 1st/2nd subs' cell reservations;
  Start_Driver fails; IsDriving stays false; Mission_Move doesn't dispatch.

In TS, the prior `W4` proxy (niat=3 on the last vessel member) modeled this
delay but was deleted. Without it, the 3rd sub fires at tick 4 same as the
first two — causing TS `Δcalls=-1` at t4.

**Fix options (for Phase 4):**

1. Restore `W4` proxy — set `nonInterruptAnimTicks=3` on the LAST vessel
   member on activation tick (narrower gate than the deleted version).
   TS-only heuristic but known to match WASM timing for SCG07.

2. Port `Mark_Track` cell-reservation semantics — more C++-faithful but
   requires modeling the vessel path-reservation conflict. May have broader
   effects on other vessel movement.

Option 1 is the pragmatic choice; option 2 is the long-term fix.

## Phase 3a result — hypothesis REFUTED

WASM instrumentation at `vessel.cpp:592` + `vessel.cpp:659` for SCG07EA
Frames 0-7 shows:

```
F 0 PRE  vessel[0]..vessel[22]: doorClosed=1, doorShut=0, gateFires=1 (except IsDriving=1)
F 1..7 same pattern
```

**ALL vessels have `Is_Door_Closed()==true` from Frame 0.** None spawn with
door open. The Commence gate fires every tick (gated only by IsDriving).

This means:
1. Neither of the prior two vessel-door-gate fix attempts could have
   worked even in principle — the door gate simply doesn't fire in SCG07EA.
2. The SCG07 t4 divergence is caused by something OTHER than door state.
3. The dossier's next-step section should investigate Mission=MOVE timer
   expiration and team activation timing for vessels [16]..[22] (the MOVE
   vessels at Frame 6+).

The `doorOpen=true` path in TS `scenario.ts:2853` for spawned cargo LSTs
may actually be a TS-only divergence from C++. In SCG07EA, cargo LSTs
are spawned via reinforcement triggers that do NOT auto-open the door.
Door only opens during the MISSION_UNLOAD sequence after arrival.

## C++ source (authoritative)

### VesselClass::AI — two Commence bookends (vessel.cpp:571-666)

```cpp
void VesselClass::AI(void)
{
  // ... entry ...

  // HACK: if HUNT with no weapon, queue RETREAT
  if (Mission == MISSION_HUNT && !Is_Weapon_Equipped()) {
    Assign_Mission(MISSION_RETREAT);
  }

  // Pre-Commence — same gate as unit.cpp:404
  if (!IsDriving && Is_Door_Closed()) {     // vessel.cpp:592
    Commence();
  }

  // Ammo reload for carriers
  // ... skipped for core analysis ...

  // Base AI — DriveClass::AI invokes drive.cpp:1304 per-tick
  DriveClass::AI();
  if (!IsActive) return;

  Rotation_AI();
  Combat_AI();

  if (Edge_Of_World_AI()) return;

  // LST door auto-close when empty
  if (Class->Max_Passengers() > 0) {
    if (!Is_Door_Closed() && Mission != MISSION_UNLOAD &&
        Transmit_Message(RADIO_TRYING_TO_LOAD) != RADIO_ROGER &&
        !(long)DoorShutCountDown) {
      LST_Close_Door();
    }
  }

  // Post-Commence — same gate
  if (!IsDriving && Is_Door_Closed()) {     // vessel.cpp:658
    Commence();
  }

  Repair_AI();
}
```

Critical invariant:
  `Commence()` is gated by `!IsDriving && Is_Door_Closed()` at BOTH vessel.cpp:592 AND 659.

### FootClass::Start_Driver flips IsDriving (foot.cpp:830)

```cpp
IsDriving = true;
```

So the lifecycle of a vessel's MissionQueue pop is:
1. Frame N: Team.AI assigns MISSION_MOVE → MissionQueue=MOVE
2. vessel.cpp:592 pre-Commence: `!IsDriving` → true (vessel not driving yet),
   `Is_Door_Closed()` → depends on door state → Commence fires iff door closed
3. If Commence fires: Mission=MOVE, Timer=0. MissionClass::AI (in DriveClass::AI)
   fires Mission_Move handler → Random_Pick(0,2) jitter (foot.cpp:535) → Basic_Path
   → Start_Driver → IsDriving=true

If door is OPEN at step 2, pre-Commence blocks. Next tick: DoorShutCountDown
decrements, eventually door closes. Then vessel.cpp:592 fires Commence.

### Is_Door_Closed() — cargo/load state machine

`Is_Door_Closed()` for LSTs returns `DoorShutCountDown == 0`. When an LST
auto-closes (vessel.cpp:649 `LST_Close_Door()`), `DoorShutCountDown` is set
to N frames. Door state reports closed only after countdown expires.

Scenario spawn path (for reinforcement LSTs loaded with cargo):
- LST spawned with door OPEN (for loading animation)
- Cargo auto-loaded
- LST waits for door-close countdown (~25 ticks per reinf.cpp:Close_Door(5, 6))
- Door closes → pre-Commence fires → Mission_MOVE pops → LST drives to unload point
- At unload point: Mission=UNLOAD → door opens → cargo disembarks → door closes
- Mission=RETREAT → LST sails off-map

## TS implementation

### Door timer (index.ts:3955-3958)

```typescript
if (entity.alive && entity.doorOpen && entity.doorTimer > 0) {
  entity.doorTimer--;
  if (entity.doorTimer <= 0) entity.doorOpen = false;
}
```

Decrements doorTimer each tick; clears `doorOpen` when expired. Good port.

### STAGE A pre-Commence (index.ts:4088-4102) — CURRENT STATE

```typescript
if (!entity.stats.isInfantry && !entity.isAirUnit &&
    entity.missionQueue !== null && !entity.isDriving &&
    !entity.isFiringAnim && entity.nonInterruptAnimTicks <= 0) {
  entity.mission = entity.missionQueue;
  entity.missionQueue = null;
  entity.missionTimer = 0;
  missionTimerFired = true;
}
```

**MISSING**: no `Is_Door_Closed()` equivalent. This pops vessel Mission
regardless of door state — diverges from C++ vessel.cpp:592.

### STAGE E post-Commence (index.ts:4159-4174) — CURRENT STATE

Same shape as STAGE A; gates on `!blockCommenceDrive` (non-infantry, non-air,
isDriving). Does NOT check door state either.

### updateMove early-return for transport LST (index.ts:5937-5944)

```typescript
if (entity.stats.isVessel && entity.isTransport && entity.doorOpen) {
  entity.animState = AnimState.IDLE;
  return;
}
```

Blocks movement when LST is transporting with door open. But Commence has
ALREADY popped Mission=MOVE at STAGE A by this point — it's too late to
block the mq→Mission transition.

### Chain-loop door gate (index.ts:5075-5081)

```typescript
if (entity.stats.isVessel && entity.doorOpen) break;
```

Breaks out of the DriveClass double-cycle chain if door open. Helps vessel
stay in drive-in-something longer but again Commence has already run.

## Why prior attempts failed

### R1 Session 7 (broad gate): `!(isVessel && doorOpen)`

Blocked STAGE A Commence for ALL vessels with doorOpen regardless of Mission.
- SCG05 failure mode: LST carrying spy has `Mission=GUARD`, `mq=MOVE` at spawn
  (+doorOpen + doorTimer=25). Gate blocks MOVE pop during the 25-tick window.
  Seems fine — should unblock after doorTimer=0.
- Actual failure: spy test times out waiting for SPY to appear. LST never
  delivers → spy never unloaded.

Hypothesis why: not just doorTimer but some other state (Mission=UNLOAD,
door reopen on arrival, etc.) keeps doorOpen=true beyond the 25-tick
spawn window. OR the gate blocks a secondary state transition that's
needed later (e.g., Mission=UNLOAD → Mission=RETREAT after cargo disembarks).

### R2 Session 25 (narrow gate): `+missionQueue ∈ {MOVE, ATTACK}`

Additionally required mq to be MOVE/ATTACK.
- SCG05 passes: ✓ (51365 tests all pass)
- SCG07 regresses: first-divergence 4 → 2. At t2, WASM fires 7 calls, TS fires 6.
  My gate defers vessel[37]'s Mission_Move jitter past t2, but WASM fires it at t2.

Analysis of SCG07 t2 divergence:
- WASM fires Mission_Move_foot at t2 for vessels [85], [86], [87], etc.
  All six vessels simultaneously fire the jitter.
- TS with gate fires 6 calls at t2 (one less than WASM).
- This means WASM's vessel[185]/[186]/[187] (equivalent to TS vessel[35/36/37])
  all have `Is_Door_Closed()==true` at t2.

Conclusion: **these specific vessels are NOT the ones with cargo doors open.**
They're other vessels (DD, SUB, gunboats?) whose `Is_Door_Closed()` is
always true by design (they have no cargo doors).

## Revised hypothesis for Phase 3 confirmation

**`Is_Door_Closed()` returns true for vessel types WITHOUT passenger
capacity** (DD, SUB, MSUB, GBOAT, CRUISER, CARRIER). Only LSTs (and maybe
transports) have doors that can be open.

The prior gate was WRONG because it treated `doorOpen=true` uniformly. TS's
`doorOpen` is only set true for LSTs-with-cargo (scenario.ts:2853). For
non-LST vessels, `doorOpen=false` from construction → gate no-ops. So the
gate's `doorOpen` check should have been a no-op for the vessels firing
at t2.

**Unless** — let me re-check. At SCG07 t2, vessels [85], [86], [87] all fire.
These could be:
- Cover team LSTs (4 LSTs carrying infantry/tanks)
- Ammunition / passenger vessels

If they're LSTs-with-cargo, their `doorOpen=true` at spawn. Then at t2 with
my gate, all 3 are blocked. But WASM fires all 3 at t2 — so WASM's LSTs have
`Is_Door_Closed()==true` at t2 despite being loaded.

That contradicts my scenario.ts:2853 model (which sets doorOpen=true for LST).
Possible discrepancies:
- TS sets doorTimer=25; maybe WASM's Close_Door(5,6) is different.
- LST may be spawned with door already closed, and only opens during unload.

## Phase 3 confirmation plan

Add WASM agent_debug_log calls at:
1. **VesselClass::AI entry** — log vessel ID, Mission, MissionQueue, IsDriving,
   Is_Door_Closed() at Frame 0-10, all vessels. Tag 8000000+Frame.
2. **vessel.cpp:592 pre-Commence call site** — log same fields just before
   Commence(). Tag 8100000+Frame.
3. **vessel.cpp:659 post-Commence call site** — Tag 8200000+Frame.
4. **LST_Close_Door()** — log vessel ID + Frame when door closes. Tag 8300000+Frame.
5. **Scenario init for LST cargo** — log door state at spawn. Tag 8400000.

Rebuild WASM, run SCG07EA 10 ticks, capture ring buffer.

Expected output to confirm:
- Do LSTs spawn with door open or closed in WASM?
- At t2 when all vessels fire Mission_Move, are ALL `Is_Door_Closed() == true`?
- Is vessel[37]/[187] special — different Mission/state at t2 vs others?

## Recommended TS fix (POST Phase 3 confirmation)

If hypothesis confirmed that LSTs spawn with door CLOSED (not open as TS does):
- Fix `scenario.ts:2853`: don't set `doorOpen=true` for spawned cargo LSTs.
- Door only opens during MISSION_UNLOAD at delivery point.
- This removes the 25-tick delay on TS side.

If hypothesis is that `Is_Door_Closed()` is per-vessel-type at C++:
- Route STAGE A/E vessel gate through a `isDoorClosed(entity)` helper that
  checks `isTransport` + `doorOpen`. Non-transports always return true.

No code changes yet. Phase 3 must confirm first.

## C++ refs

- `vessel.cpp:571-666` VesselClass::AI (both Commence call sites)
- `vessel.cpp:649-651` LST_Close_Door auto-close in AI
- `vessel.cpp:2104-2117` VesselClass::Start_Driver
- `reinf.cpp:217-254` cargo loading + LST door init
- `mission.cpp:343-359` Commence (unconditional pop when queue is set)
- `drive.cpp:1304-1399` DriveClass::AI

## TS refs

- `src/EasterEgg/engine/entity.ts:481` `doorOpen = false` default
- `src/EasterEgg/engine/index.ts:3955-3958` doorTimer countdown
- `src/EasterEgg/engine/index.ts:4088-4102` STAGE A pre-Commence (no door gate)
- `src/EasterEgg/engine/index.ts:4159-4174` STAGE E post-Commence (no door gate)
- `src/EasterEgg/engine/index.ts:5081` chain-loop door break
- `src/EasterEgg/engine/index.ts:5941-5944` updateMove transport-LST early return
- `src/EasterEgg/engine/scenario.ts:2852-2855` cargo LST spawn with doorOpen=true
