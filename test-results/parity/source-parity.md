# Red Alert Source Parity Audit

Generated: 2026-03-06T20:18:23.574Z

Loaded files:
- /Users/discordwell/Projects/Zachathon/public/ra/assets/rules.ini
- /Users/discordwell/Projects/Zachathon/public/ra/assets/aftrmath.ini
- /Users/discordwell/Projects/Zachathon/public/ra/assets/SCA01EA.ini

Total mismatches: 55
- Units: 12
- Weapons: 12
- Warheads: 3
- Production: 28

Top mismatches:
- [unit] E2.owner: TS="soviet" source="allied"
- [unit] STNK.strength: TS=110 source=200
- [unit] STNK.armor: TS="light" source="heavy"
- [unit] STNK.passengers: TS=5 source=1
- [unit] CTNK.sight: TS=6 source=5
- [unit] TTNK.armor: TS="heavy" source="light"
- [unit] DTRK.primaryWeapon: TS=null source="Democharge"
- [unit] MSUB.speed: TS=6 source=5
- [unit] MSUB.sight: TS=5 source=6
- [unit] MSUB.rot: TS=3 source=7
- [unit] MSUB.primaryWeapon: TS="SeaSerpent" source="SubSCUD"
- [unit] E7.owner: TS="allied" source="both"
- [weapon] PortaTesla.damage: TS=50 source=45
- [weapon] PortaTesla.rof: TS=60 source=70
- [weapon] PortaTesla.range: TS=4 source=3.5
- [weapon] GoodWrench.damage: TS=-30 source=-100
- [weapon] GoodWrench.rof: TS=60 source=80
- [weapon] GoodWrench.warhead: TS="Organic" source="Mechanical"
- [weapon] APTusk.rof: TS=60 source=80
- [weapon] APTusk.range: TS=6 source=5
- [weapon] APTusk.burst: TS=1 source=2
- [weapon] TTankZap.damage: TS=80 source=100
- [weapon] TTankZap.rof: TS=80 source=120
- [weapon] TTankZap.range: TS=5 source=7
- [warhead] Super.destroysWalls: TS=false source=true
- [warhead] Super.infantryDeath: TS=5 source=2
- [warhead] Mechanical.verses: TS=[0,0,0,0,0] source=[1,1,1,1,1]
- [production] E2.faction: TS="soviet" source="allied"
- [production] E3.techLevel: TS=2 source=-1
- [production] E4.prerequisite: TS="TENT" source="STEK"
- [production] HARV.techPrereq: TS=null source="PROC"
- [production] SHOK.prerequisite: TS="TENT" source="TSLA"
- [production] MECH.techLevel: TS=99 source=7
- [production] MECH.faction: TS="both" source="allied"
- [production] MECH.prerequisite: TS="TENT" source="FIX"
- [production] STNK.techLevel: TS=99 source=-1
- [production] STNK.faction: TS="allied" source="both"
- [production] CTNK.techLevel: TS=99 source=12
- [production] CTNK.prerequisite: TS="WEAP" source="ATEK"
- [production] TTNK.techLevel: TS=99 source=8

Full JSON: /Users/discordwell/Projects/Zachathon/test-results/parity/source-parity.json