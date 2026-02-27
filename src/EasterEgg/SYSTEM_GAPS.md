# RA TypeScript Engine: System Gaps to Full C++ Parity

Every major system that needs to be built or expanded to play full Red Alert in TypeScript.

## 1. NAVAL COMBAT
**Status: 0% — No naval units, weapons, or water pathfinding**

Missing units: DD (Destroyer), SS (Submarine), CA (Cruiser), PT (Gunboat), LST (Transport — stub exists), MSUB (Missile Sub)
Missing mechanics: water-only pathfinding, shore bombardment, torpedo weapons, depth charges, submarine submerge/surface toggle, naval yard (SYRD) production, transport loading from shore cells, sub detection (destroyers reveal subs in range)
Missing weapons: Stinger (destroyer depth charge), TorpTube (sub torpedo), Tomahawk (cruiser missiles), SeaSerpent (MSUB missiles)

## 2. AIR COMBAT
**Status: 0% — No aircraft, airfields, or flight mechanics**

Missing units: MIG, YAK, HIND (attack heli), TRAN (transport heli — stub only), LONGBOW (Apache), SPY_PLANE (recon)
Missing structures: AFLD (Airfield), HPAD (Helipad)
Missing mechanics: flight layer (altitude), landing/takeoff sequences, ammo reloading at airfield, helicopter hover + strafe, fixed-wing attack runs (approach→fire→RTB), paradrop from transport, air-to-ground targeting, AA weapon priority (RedEye, Stinger SAM), aircraft fuel/ammo depletion, airfield queue (max 1 plane per pad)

## 3. SUPERWEAPONS
**Status: Trigger stubs only — No player-controlled superweapons**

Missing: Chronosphere (teleport units across map, 7-min recharge), Iron Curtain (invulnerability for 1 unit/building, 7-min), Nuclear Missile (MSLO launch, 14-min recharge, massive AoE), GPS Satellite (full map reveal, permanent), Sonar Pulse (reveal all subs for 30s)
Missing UI: superweapon sidebar buttons with countdown timers, target selection cursor, charge-up animation on building

## 4. FULL CAMPAIGN MISSIONS
**Status: 4 of 28+ missions (Ant Campaign only)**

Missing: 14 Allied missions, 14 Soviet missions, plus Counterstrike/Aftermath expansion missions
Each mission needs: map extraction, trigger scripting, briefing text/audio, objective definitions, reinforcement timing, score screen
Missing mechanics: mission branching (some missions have A/B paths), between-mission cutscenes (VQA video — would need static image or text substitutes), difficulty-based enemy composition, score tracking

## 5. MULTIPLAYER / SKIRMISH
**Status: 0% — No networking, no random map generation**

Missing for skirmish: random map generator (or pre-made skirmish maps), AI opponent with full economic strategy, faction selection screen, game settings (starting credits, tech level, game speed, unit count cap)
Missing for multiplayer: WebSocket/WebRTC networking layer, game state synchronization (lockstep or client-server), lobby system, player slots, latency compensation, reconnection, chat
Missing UI: game lobby, player list, map preview, faction/color picker

## 6. FULL AI (Computer Opponent)
**Status: ~30% — Basic unit production + hunt, no strategy**

Missing: base construction AI (place buildings intelligently), harvester management (dispatch to ore, return to refinery, avoid enemies), attack group composition (mix infantry + vehicles + air), harassment raids, defensive positioning, threat assessment for base defense, tech rush vs turtle decision making, retreat/regroup behavior, AI difficulty scaling (easy/medium/hard with different handicaps), naval AI (build fleet, shore assault), air AI (bombing runs, recon)
Existing: AI produces infantry/vehicles from passive income, units hunt nearest enemy, base rebuild queue (simplistic)

## 7. FACTION TECH TREES
**Status: Partial — Some units faction-gated, but no full Allied vs Soviet split**

Missing: proper Allied-only units (Ranger, Spy, Tanya, Longbow, Cruiser, GPS), Soviet-only units (Shock Trooper, Tesla Tank, MAD Tank, V2 Launcher, MiG, Iron Curtain), faction-specific structures (Allied: GPS, Chronosphere, Gap Generator full behavior; Soviet: Tesla Coil, Iron Curtain, Missile Silo, Sub Pen), tech level prerequisites (radar→advanced structures→superweapons), country-specific bonuses (England=10% cheaper, France=+10% armor, etc.)

## 8. TRANSPORT MECHANICS
**Status: Stubs only — Loading/unloading code exists but not functional**

Missing: APC infantry loading (max 5 passengers), transport helicopter paradrop, LST shore loading/unloading (drive-on/drive-off), Chinook transport (carry vehicles), passenger firing from transport (none in RA, but loading UI needed), transport unit selection shows passenger count, unload command with scatter positioning

## 9. TERRAIN & MAP FEATURES
**Status: Simplified — 5 terrain types, no destructible terrain**

Missing: bridge destruction + repair (engineer can rebuild), cliff/elevation system (units on cliffs get range bonus), ice terrain (vehicles crack through, infantry safe), deep vs shallow water, shore cells (where naval meets land), ore field terrain rendering (gold/gem patches visible on map), tree destruction by heavy weapons, crater persistence from explosions, terrain deformation

## 10. SAVE/LOAD SYSTEM
**Status: 0% — Only mission progression in localStorage**

Missing: full game state serialization (all entities, structures, triggers, fog state, production queues, credits, tick count), save slot management (8 slots like original), quicksave/quickload keybinds, save file format (JSON), load game menu, autosave between missions

## 11. FULL SIDEBAR & UI
**Status: ~90% — Tabs, sell/repair buttons, radar toggle all implemented**

[VERIFIED] Production tabs (INF/VEH/BLD) with per-tab scroll, sell/repair sidebar buttons, radar minimap toggle, double-click select all of type, power bar with low-power effects, team hotkeys (Ctrl+1-9 assign, 1-9 recall), comprehensive hotkeys, superweapon buttons with countdown timers, structure placement preview with green/red per-cell validity, footprint-based adjacency check.

Remaining: right-click context menu (guard, patrol — out of scope, RA1 didn't have one), diplomacy screen (multiplayer-only, out of scope)

## 12. BUILDING CONSTRUCTION
**Status: ~60% — Production queue works, placement simplified**

Missing: construction yard requirement (no FACT = no building), building placement validation (must be adjacent to existing buildings, clear terrain, no overlap), building sell animation (shrink + refund), building repair (click to toggle auto-repair, costs credits over time), building capture by engineer (enemy building changes house), primary building designation (set primary factory for rally point), building power-up/power-down visual states

## 13. MAP EDITOR
**Status: 0%**

Missing: tile painting, unit/structure placement, trigger editor, team editor, map properties, export to scenario INI format. Low priority — content creation tool, not gameplay.

## 14. SCORE & STATISTICS
**Status: 0%**

Missing: end-of-mission score screen (buildings destroyed, units lost, economy rating, time elapsed), campaign progress tracking with star ratings, statistics overlay during gameplay (K/D ratio, income rate)

## 15. MUSIC & AUDIO (EXPANSION)
**Status: ~80% — Core works, missing original soundtrack**

Missing: full RA soundtrack (Hell March, etc.) — currently uses synthesized/placeholder tracks, AUD format decoder for original music files, jukebox/music selection in options, sound distance attenuation (volume decreases with distance from camera center)

---

## PRIORITY ORDER (for "play full RA" goal)

### Phase 1: Core Combat Expansion
1. **Naval Combat** — opens water maps, ~40% of RA maps have water
2. **Air Combat** — completes the rock-paper-scissors (land/sea/air)
3. **Transport Mechanics** — needed for amphibious missions

### Phase 2: Strategic Depth
4. **Superweapons** — endgame excitement
5. **Faction Tech Trees** — Allied vs Soviet identity
6. **Full AI** — meaningful opponent

### Phase 3: Content & Polish
7. **Full Sidebar & UI** — complete RTS interface
8. **Building Construction** — proper base building
9. **Save/Load** — quality of life
10. **Campaign Missions** — actual RA content

### Phase 4: Extras
11. **Terrain & Map Features** — visual/gameplay depth
12. **Score & Statistics** — progression feel
13. **Music & Audio** — atmosphere
14. **Multiplayer / Skirmish** — massive effort, do last
15. **Map Editor** — content creation tool
