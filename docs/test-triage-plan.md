# Test Failure Triage Plan

## Current State
- 532 failures across 80 test files (out of 50,616 total tests)
- 50,082 passing (98.9% pass rate)

## Strategy
Each failing test file gets assigned to a sub-agent. The agent must:
1. **READ** the test file and understand what it's testing
2. **READ** the C++ reference (if cited in the test name/comments)
3. **READ** the TS implementation being tested
4. **CLASSIFY** each failure as:
   - **VALID GAP**: Test correctly identifies a real behavioral difference between TS and C++. Fix the TS implementation.
   - **STALE TEST**: Test asserts old/wrong values after our refactors (RESFACTOR, walk rate, idleAnimCount, harvester lump-sum, etc.). Fix the test.
   - **MISSING FEATURE**: Test requires a feature not yet implemented (AI systems, etc.). Mark as TODO.
5. **FIX** the classified items
6. **RUN** the test file to verify fixes

## Likely Root Cause Categories

### Category 1: RESFACTOR changes (STALE TESTS)
Files: sidebar-ui, cpp-parity-visual-constants, unit-behavior-sidebar, cpp-parity-renderer-visual
Symptoms: hardcoded pixel values (160 sidebar, 16 tab height, 300 radar size)
Fix: update assertions to use RESFACTOR-scaled values

### Category 2: Harvester behavioral changes (MIX of VALID + STALE)
Files: harvester-pipeline, harvester-behavioral, cpp-parity-harvester-ai, cpp-parity-harvester-behavior, cpp-parity-harvester-economics, cpp-parity-harvest-cycle
Symptoms: drip-feed vs lump-sum credits, dock cell position, rotation behavior
Fix: update tests for new lump-sum behavior where tests are stale; fix TS where tests are valid

### Category 3: Infantry walk rate change (STALE TESTS)
Files: cpp-parity-movement-speed, movement, movement-pipeline, movement-parity, cpp-parity-infantry-movement, cpp-parity-infantry-coord-move, cpp-parity-speed-accumulator
Symptoms: walk speed/timing assertions off by ~33% (rate was 3, now 2)
Fix: update expected values

### Category 4: Building animation table changes (STALE TESTS)
Files: sidebar-ui (static buildings test), cpp-parity-anim-superweapons
Symptoms: idleAnimCount changed from 0 to non-zero for FACT/BARR/TENT
Fix: update assertions

### Category 5: AI behavioral gaps (VALID GAPS or MISSING FEATURES)
Files: cpp-parity-ai*, cpp-parity-iq-gates, cpp-parity-autocreate*, ai-behavioral, missionAI-behavioral
Symptoms: AI decision-making, team creation, base rebuild, retreat logic
Fix: mostly MISSING FEATURES — mark as TODO unless trivially fixable

### Category 6: Color remap / Iron Curtain changes (STALE TESTS)
Files: house-color-remap, cpp-parity-chronoshift, superweapon-pipeline
Symptoms: remap tolerance, chronoshift sprite name changes
Fix: update test assertions

### Category 7: Miscellaneous (MIXED)
Files: data-parity, faction-tech-trees, campaign-system, trigger-system-pipeline, etc.
Fix: case-by-case

## Agent Assignment Strategy
- Group files by category (1-7 above)
- Each agent gets 1 category (5-15 files)
- Agent reads ALL files in its batch, classifies, fixes
- Maximum ~10 agents running in parallel
- Files with <3 failures: batch together as "misc"

## Semaphore
If we need >10 agents, use /semaphore to queue them.
