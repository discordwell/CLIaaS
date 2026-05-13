/**
 * C++ parity test: Guard/AreaGuard scan timer must gate target acquisition.
 *
 * C++ foot.cpp:589-634: Mission_Guard only scans for targets (Target_Something_Nearby)
 * when the mission timer fires. Between timer fires, the unit continues shooting its
 * existing target via Firing_AI, but does NOT re-scan for new targets.
 *
 * Bug found: index.ts updateGuard() method signature lacked the timerFired parameter,
 * so the missionTimerFired argument from the switch-case was silently dropped by TypeScript.
 * The missionAI.ts updateGuard() defaulted timerFired=true, causing the guard scan to run
 * every tick instead of only when the timer fired. This led to units acquiring targets
 * and firing much earlier than C++, killing an E1 infantry on SCG01EA that C++ kept alive.
 *
 * C++ source: foot.cpp:589-634 (Mission_Guard), foot.cpp:654-702 (Mission_Hunt)
 * C++ source: techno.cpp:425 (Firing_AI — runs every tick, fires at existing TarCom)
 */

import { describe, it, expect } from 'vitest';

// Direct source inspection: verify the method signatures accept timerFired
// and pass it through to the missionAI function.

describe('Guard/AreaGuard scan timer parity', () => {
  it('updateGuard method signature accepts timerFired parameter', async () => {
    // Read the actual source to verify the method signature includes timerFired
    const fs = await import('fs');
    const path = await import('path');
    const indexPath = path.resolve(__dirname, '../engine/index.ts');
    const source = fs.readFileSync(indexPath, 'utf-8');

    // The private updateGuard method must accept a timerFired parameter
    // so that the switch-case call `this.updateGuard(entity, missionTimerFired)`
    // actually passes the boolean through to _updateGuard.
    const guardMethodRegex = /private\s+updateGuard\s*\(\s*entity:\s*Entity\s*,\s*timerFired/;
    expect(source).toMatch(guardMethodRegex);

    // Verify it passes timerFired to _updateGuard
    const guardDelegateRegex = /_updateGuard\s*\(\s*ctx\s*,\s*entity\s*,\s*timerFired\s*\)/;
    expect(source).toMatch(guardDelegateRegex);
  });

  it('updateAreaGuard method signature accepts timerFired parameter', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const indexPath = path.resolve(__dirname, '../engine/index.ts');
    const source = fs.readFileSync(indexPath, 'utf-8');

    // Same fix for updateAreaGuard — must accept and forward timerFired
    const areaGuardMethodRegex = /private\s+updateAreaGuard\s*\(\s*entity:\s*Entity\s*,\s*timerFired/;
    expect(source).toMatch(areaGuardMethodRegex);

    const areaGuardDelegateRegex = /_updateAreaGuard\s*\(\s*ctx\s*,\s*entity\s*,\s*timerFired\s*\)/;
    expect(source).toMatch(areaGuardDelegateRegex);
  });

  it('missionAI updateGuard accepts timerFired with default true', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const missionAIPath = path.resolve(__dirname, '../engine/missionAI.ts');
    const source = fs.readFileSync(missionAIPath, 'utf-8');

    // C++ foot.cpp:589: Mission_Guard runs when Timer==0
    // The timerFired param must exist and gate the scan (line: if (!timerFired) return;)
    const funcSignatureRegex = /export\s+function\s+updateGuard\s*\([^)]*timerFired\s*=\s*true/;
    expect(source).toMatch(funcSignatureRegex);

    // Verify scan is gated by timerFired
    expect(source).toContain('if (!timerFired) return;');
  });

  it('missionAI updateAreaGuard accepts timerFired with default true', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const missionAIPath = path.resolve(__dirname, '../engine/missionAI.ts');
    const source = fs.readFileSync(missionAIPath, 'utf-8');

    const funcSignatureRegex = /export\s+function\s+updateAreaGuard\s*\([^)]*timerFired\s*=\s*true/;
    expect(source).toMatch(funcSignatureRegex);
  });

  it('GUARD case in mission switch passes missionTimerFired to updateGuard', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const indexPath = path.resolve(__dirname, '../engine/index.ts');
    const source = fs.readFileSync(indexPath, 'utf-8');

    // The switch case for GUARD must call updateGuard with missionTimerFired
    // This is the call site: this.updateGuard(entity, missionTimerFired)
    expect(source).toContain('this.updateGuard(entity, missionTimerFired)');
  });

  it('AREA_GUARD case in mission switch passes missionTimerFired to updateAreaGuard', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const indexPath = path.resolve(__dirname, '../engine/index.ts');
    const source = fs.readFileSync(indexPath, 'utf-8');

    expect(source).toContain('this.updateAreaGuard(entity, missionTimerFired)');
  });

  it('STICKY mission starts from its own Normal_Delay (14), before class overrides', async () => {
    // C++ foot.cpp:597: dtime = MissionControl[Mission].Normal_Delay()
    // For STICKY mission, rules.ini [Sticky] Rate=.016 → Normal_Delay=14
    // For GUARD mission, rules.ini [Guard] Rate=.050 → Normal_Delay=42
    // The GUARD/STICKY case in the mission switch must differentiate the
    // base mission delay before FootClass applies vessel/infantry overrides.
    // Example: CA on STICKY doubles this 14-tick base to 28 before jitter.
    const fs = await import('fs');
    const path = await import('path');
    const indexPath = path.resolve(__dirname, '../engine/index.ts');
    const source = fs.readFileSync(indexPath, 'utf-8');

    // The code must check entity.mission === Mission.STICKY for the delay override
    expect(source).toContain('entity.mission === Mission.STICKY');

    // Sticky delay must be 14 (Rate=.016 → fixed raw=4 → ((4*900)+128)/256=14)
    // Verify the guardDelay for STICKY is 14
    const stickyBlock = source.match(/Mission\.STICKY[\s\S]*?guardDelay\s*=\s*(\d+)/);
    expect(stickyBlock, 'Sticky guardDelay assignment should exist').toBeTruthy();
    expect(stickyBlock![1]).toBe('14');
  });
});
