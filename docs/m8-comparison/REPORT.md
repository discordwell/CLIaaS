# M8 (SCG08EA) Dual-Runtime Comparison Report

Generated: 2026-03-20T04:55:18.617Z
Final tick: 2700
TS outcome: playing
WASM outcome: playing

## Unit Stats at Mission Start

| Unit Type | TS Max HP | WASM Max HP | Match |
|-----------|-----------|-------------|-------|
| 1TNK | 300 | 300 | Yes |
| 2TNK | 400 | 400 | Yes |
| 3TNK | 400 | 400 | Yes |
| ARTY | 75 | 75 | Yes |
| E1 | 50 | 50 | Yes |
| HARV | 600 | 600 | Yes |
| JEEP | 150 | 150 | Yes |
| MNLY | 100 | 100 | Yes |
| V2RL | 150 | 150 | Yes |

## Death Counts by Unit Type

| Unit Type | TS Deaths | WASM Deaths | Delta |
|-----------|-----------|-------------|-------|
| 1TNK | 1 | 0 | 1 |
| 2TNK | 1 | 0 | 1 |
| ARTY | 1 | 0 | 1 |
| BADR | 0 | 4 | 4 |
| C1 | 0 | 1 | 1 |
| E1 | 10 | 17 | 7 |
| E3 | 5 | 5 | 0 |
| HARV | 1 | 5 | 4 |
| MCV | 1 | 1 | 0 |
| V2RL | 1 | 3 | 2 |
| YAK | 4 | 2 | 2 |

## Average Damage Taken Per Hit by Unit Type

| Unit Type | TS Avg Dmg | WASM Avg Dmg | Diff % | Flag |
|-----------|------------|--------------|--------|------|
| 1TNK | 54.0 (n=5) | 23.6 (n=17) | 56.2% | **>15%** |
| 2TNK | 64.0 (n=6) | 44.4 (n=31) | 30.6% | **>15%** |
| 3TNK | 19.0 (n=2) | 21.9 (n=60) | 13.3% |  |
| ARTY | 28.0 (n=1) | 47.9 (n=14) | 41.5% | **>15%** |
| E1 | 40.0 (n=2) | 10.2 (n=41) | 74.5% | **>15%** |
| E3 | 0.0 (n=0) | 2.6 (n=5) | 100.0% | **>15%** |
| HARV | 25.2 (n=23) | 4.0 (n=13) | 84.1% | **>15%** |
| JEEP | 0.0 (n=0) | 1.0 (n=1) | 100.0% | **>15%** |
| MNLY | 0.0 (n=0) | 47.0 (n=27) | 100.0% | **>15%** |
| V2RL | 19.6 (n=7) | 90.6 (n=17) | 78.4% | **>15%** |
| YAK | 19.0 (n=12) | 21.0 (n=10) | 9.5% |  |

## Average Speed by Unit Type

| Unit Type | TS Avg Speed | WASM Avg Speed | Diff % | Flag |
|-----------|--------------|----------------|--------|------|
| 1TNK | 1.20 (n=27) | 1.43 (n=248) | 16.2% | **>5%** |
| 2TNK | 1.10 (n=62) | 1.43 (n=439) | 23.1% | **>5%** |
| 3TNK | 0.00 (n=0) | 1.98 (n=169) | 100.0% | **>5%** |
| 4TNK | 0.00 (n=0) | 2.41 (n=29) | 100.0% | **>5%** |
| ARTY | 1.16 (n=26) | 1.59 (n=119) | 27.1% | **>5%** |
| BADR | 1.02 (n=40) | 2.02 (n=60) | 49.5% | **>5%** |
| C1 | 0.00 (n=0) | 1.00 (n=1) | 100.0% | **>5%** |
| DD | 1.01 (n=37) | 1.19 (n=113) | 15.1% | **>5%** |
| E1 | 1.02 (n=91) | 1.24 (n=809) | 17.6% | **>5%** |
| E3 | 1.00 (n=15) | 1.61 (n=281) | 38.0% | **>5%** |
| HARV | 0.00 (n=0) | 9.56 (n=34) | 100.0% | **>5%** |
| JEEP | 1.28 (n=3) | 2.47 (n=130) | 48.3% | **>5%** |
| MCV | 1.00 (n=1) | 1.00 (n=4) | 0.0% |  |
| MNLY | 0.00 (n=0) | 1.72 (n=257) | 100.0% | **>5%** |
| V2RL | 0.00 (n=0) | 1.54 (n=102) | 100.0% | **>5%** |
| YAK | 1.06 (n=230) | 1.56 (n=344) | 32.1% | **>5%** |

## Average Build Duration by Type

| Item Type | TS Avg Ticks | WASM Avg Ticks | Diff % | Flag |
|-----------|--------------|----------------|--------|------|
| E3 | 280 (n=8) | 244 (n=9) | 12.7% | **>10%** |
| POWR | 280 (n=8) | 170 (n=1) | 39.3% | **>10%** |
| WEAP | 0 (n=0) | 1700 (n=1) | 100.0% | **>10%** |

## Mission Timer Comparison

| Runtime | Mission Timer | Flag |
|---------|---------------|------|
| TS      | 37815 | |
| WASM    | 37800 | |
| Delta   | 15 |  |

## Visual Pixel Diff Summary

| Tick | Total Pixels | Diff Pixels | Diff % | Flag |
|------|--------------|-------------|--------|------|
| 0 | 64000 | 55469 | 86.67% | **>5%** |
| 100 | 64000 | 60260 | 94.16% | **>5%** |
| 200 | 64000 | 60259 | 94.15% | **>5%** |
| 300 | 64000 | 55469 | 86.67% | **>5%** |
| 400 | 64000 | 55469 | 86.67% | **>5%** |
| 500 | 64000 | 59790 | 93.42% | **>5%** |
| 600 | 64000 | 55469 | 86.67% | **>5%** |
| 700 | 64000 | 60198 | 94.06% | **>5%** |
| 800 | 64000 | 60281 | 94.19% | **>5%** |
| 900 | 64000 | 60399 | 94.37% | **>5%** |
| 1000 | 64000 | 60338 | 94.28% | **>5%** |
| 1100 | 64000 | 60358 | 94.31% | **>5%** |
| 1200 | 64000 | 60336 | 94.27% | **>5%** |
| 1300 | 64000 | 60368 | 94.33% | **>5%** |
| 1400 | 64000 | 60276 | 94.18% | **>5%** |
| 1500 | 64000 | 59803 | 93.44% | **>5%** |
| 1600 | 64000 | 60272 | 94.17% | **>5%** |
| 1700 | 64000 | 55469 | 86.67% | **>5%** |
| 1800 | 64000 | 55469 | 86.67% | **>5%** |
| 1900 | 64000 | 55469 | 86.67% | **>5%** |
| 2000 | 64000 | 60282 | 94.19% | **>5%** |
| 2100 | 64000 | 60280 | 94.19% | **>5%** |
| 2200 | 64000 | 60271 | 94.17% | **>5%** |
| 2300 | 64000 | 60271 | 94.17% | **>5%** |
| 2400 | 64000 | 60278 | 94.18% | **>5%** |
| 2500 | 64000 | 59807 | 93.45% | **>5%** |
| 2600 | 64000 | 55469 | 86.67% | **>5%** |
| 2700 | 64000 | 60274 | 94.18% | **>5%** |

## Production Timeline

| Tick | Runtime | Item | Event | Progress |
|------|---------|------|-------|----------|
| 270 | ts | POWR | started | 3% |
| 270 | ts | E3 | started | 3% |
| 310 | wasm | E3 | started | 3% |
| 310 | wasm | POWR | started | 3% |
| 470 | wasm | E3 | completed | 100% |
| 480 | wasm | E3 | started | 3% |
| 480 | wasm | POWR | completed | 100% |
| 490 | wasm | WEAP | started | 0% |
| 550 | ts | POWR | completed | 100% |
| 550 | ts | E3 | completed | 100% |
| 560 | ts | POWR | started | 3% |
| 560 | ts | E3 | started | 3% |
| 640 | wasm | E3 | completed | 100% |
| 650 | wasm | E3 | started | 3% |
| 810 | wasm | E3 | completed | 100% |
| 820 | wasm | E3 | started | 1% |
| 840 | ts | POWR | completed | 100% |
| 840 | ts | E3 | completed | 100% |
| 850 | ts | POWR | started | 3% |
| 850 | ts | E3 | started | 3% |
| 1130 | ts | POWR | completed | 100% |
| 1130 | ts | E3 | completed | 100% |
| 1140 | ts | POWR | started | 3% |
| 1140 | ts | E3 | started | 3% |
| 1140 | wasm | E3 | completed | 100% |
| 1150 | wasm | E3 | started | 1% |
| 1420 | ts | POWR | completed | 100% |
| 1420 | ts | E3 | completed | 100% |
| 1420 | wasm | E3 | completed | 100% |
| 1430 | ts | POWR | started | 3% |
| 1430 | ts | E3 | started | 3% |
| 1430 | wasm | E3 | started | 1% |
| 1700 | wasm | E3 | completed | 100% |
| 1710 | ts | POWR | completed | 100% |
| 1710 | ts | E3 | completed | 100% |
| 1710 | wasm | E3 | started | 1% |
| 1720 | ts | POWR | started | 3% |
| 1720 | ts | E3 | started | 3% |
| 1980 | wasm | E3 | completed | 100% |
| 1990 | wasm | E3 | started | 1% |
| 2000 | ts | POWR | completed | 100% |
| 2000 | ts | E3 | completed | 100% |
| 2010 | ts | POWR | started | 3% |
| 2010 | ts | E3 | started | 3% |
| 2190 | wasm | WEAP | completed | 100% |
| 2200 | wasm | HARV | started | 0% |
| 2200 | wasm | APWR | started | 1% |
| 2260 | wasm | E3 | completed | 100% |
| 2270 | wasm | E3 | started | 1% |
| 2290 | ts | POWR | completed | 100% |
| 2290 | ts | E3 | completed | 100% |
| 2300 | ts | POWR | started | 3% |
| 2300 | ts | E3 | started | 3% |
| 2580 | ts | POWR | completed | 100% |
| 2580 | ts | E3 | completed | 100% |
| 2590 | ts | POWR | started | 3% |
| 2590 | ts | E3 | started | 3% |
| 2590 | wasm | E3 | completed | 100% |
| 2600 | wasm | E3 | started | 1% |

## Structure Counts Over Time

| Tick | TS Allied Structs | WASM Allied Structs | TS Enemy Structs | WASM Enemy Structs |
|------|-------------------|---------------------|------------------|--------------------|
| 0 | 27 | 26 | 22 | 23 |
| 100 | 27 | 26 | 22 | 23 |
| 200 | 27 | 26 | 22 | 23 |
| 300 | 28 | 27 | 22 | 23 |
| 400 | 28 | 27 | 22 | 23 |
| 500 | 28 | 28 | 22 | 23 |
| 600 | 28 | 28 | 22 | 23 |
| 700 | 28 | 28 | 22 | 23 |
| 800 | 28 | 27 | 22 | 23 |
| 900 | 28 | 27 | 22 | 23 |
| 1000 | 28 | 27 | 22 | 23 |
| 1100 | 28 | 26 | 22 | 23 |
| 1200 | 28 | 26 | 22 | 23 |
| 1300 | 28 | 26 | 22 | 23 |
| 1400 | 28 | 26 | 22 | 23 |
| 1500 | 28 | 26 | 22 | 23 |
| 1600 | 28 | 26 | 22 | 23 |
| 1700 | 28 | 26 | 22 | 23 |
| 1800 | 28 | 26 | 22 | 23 |
| 1900 | 28 | 26 | 22 | 23 |
| 2000 | 28 | 26 | 22 | 23 |
| 2100 | 28 | 26 | 22 | 23 |
| 2200 | 28 | 27 | 22 | 23 |
| 2300 | 28 | 27 | 22 | 23 |
| 2400 | 28 | 27 | 22 | 23 |
| 2500 | 28 | 27 | 22 | 23 |
| 2600 | 28 | 27 | 22 | 23 |
| 2700 | 28 | 27 | 22 | 23 |

## Screenshot Pairs

### Tick 0

| TS | WASM | Diff |
|----|------|------|
| ![TS](screenshots/ts-0.png) | ![WASM](screenshots/wasm-0.png) | ![Diff](screenshots/diff-0.png) |

### Tick 100

| TS | WASM | Diff |
|----|------|------|
| ![TS](screenshots/ts-100.png) | ![WASM](screenshots/wasm-100.png) | ![Diff](screenshots/diff-100.png) |

### Tick 200

| TS | WASM | Diff |
|----|------|------|
| ![TS](screenshots/ts-200.png) | ![WASM](screenshots/wasm-200.png) | ![Diff](screenshots/diff-200.png) |

### Tick 300

| TS | WASM | Diff |
|----|------|------|
| ![TS](screenshots/ts-300.png) | ![WASM](screenshots/wasm-300.png) | ![Diff](screenshots/diff-300.png) |

### Tick 400

| TS | WASM | Diff |
|----|------|------|
| ![TS](screenshots/ts-400.png) | ![WASM](screenshots/wasm-400.png) | ![Diff](screenshots/diff-400.png) |

### Tick 500

| TS | WASM | Diff |
|----|------|------|
| ![TS](screenshots/ts-500.png) | ![WASM](screenshots/wasm-500.png) | ![Diff](screenshots/diff-500.png) |

### Tick 600

| TS | WASM | Diff |
|----|------|------|
| ![TS](screenshots/ts-600.png) | ![WASM](screenshots/wasm-600.png) | ![Diff](screenshots/diff-600.png) |

### Tick 700

| TS | WASM | Diff |
|----|------|------|
| ![TS](screenshots/ts-700.png) | ![WASM](screenshots/wasm-700.png) | ![Diff](screenshots/diff-700.png) |

### Tick 800

| TS | WASM | Diff |
|----|------|------|
| ![TS](screenshots/ts-800.png) | ![WASM](screenshots/wasm-800.png) | ![Diff](screenshots/diff-800.png) |

### Tick 900

| TS | WASM | Diff |
|----|------|------|
| ![TS](screenshots/ts-900.png) | ![WASM](screenshots/wasm-900.png) | ![Diff](screenshots/diff-900.png) |

### Tick 1000

| TS | WASM | Diff |
|----|------|------|
| ![TS](screenshots/ts-1000.png) | ![WASM](screenshots/wasm-1000.png) | ![Diff](screenshots/diff-1000.png) |

### Tick 1100

| TS | WASM | Diff |
|----|------|------|
| ![TS](screenshots/ts-1100.png) | ![WASM](screenshots/wasm-1100.png) | ![Diff](screenshots/diff-1100.png) |

### Tick 1200

| TS | WASM | Diff |
|----|------|------|
| ![TS](screenshots/ts-1200.png) | ![WASM](screenshots/wasm-1200.png) | ![Diff](screenshots/diff-1200.png) |

### Tick 1300

| TS | WASM | Diff |
|----|------|------|
| ![TS](screenshots/ts-1300.png) | ![WASM](screenshots/wasm-1300.png) | ![Diff](screenshots/diff-1300.png) |

### Tick 1400

| TS | WASM | Diff |
|----|------|------|
| ![TS](screenshots/ts-1400.png) | ![WASM](screenshots/wasm-1400.png) | ![Diff](screenshots/diff-1400.png) |

### Tick 1500

| TS | WASM | Diff |
|----|------|------|
| ![TS](screenshots/ts-1500.png) | ![WASM](screenshots/wasm-1500.png) | ![Diff](screenshots/diff-1500.png) |

### Tick 1600

| TS | WASM | Diff |
|----|------|------|
| ![TS](screenshots/ts-1600.png) | ![WASM](screenshots/wasm-1600.png) | ![Diff](screenshots/diff-1600.png) |

### Tick 1700

| TS | WASM | Diff |
|----|------|------|
| ![TS](screenshots/ts-1700.png) | ![WASM](screenshots/wasm-1700.png) | ![Diff](screenshots/diff-1700.png) |

### Tick 1800

| TS | WASM | Diff |
|----|------|------|
| ![TS](screenshots/ts-1800.png) | ![WASM](screenshots/wasm-1800.png) | ![Diff](screenshots/diff-1800.png) |

### Tick 1900

| TS | WASM | Diff |
|----|------|------|
| ![TS](screenshots/ts-1900.png) | ![WASM](screenshots/wasm-1900.png) | ![Diff](screenshots/diff-1900.png) |

### Tick 2000

| TS | WASM | Diff |
|----|------|------|
| ![TS](screenshots/ts-2000.png) | ![WASM](screenshots/wasm-2000.png) | ![Diff](screenshots/diff-2000.png) |

### Tick 2100

| TS | WASM | Diff |
|----|------|------|
| ![TS](screenshots/ts-2100.png) | ![WASM](screenshots/wasm-2100.png) | ![Diff](screenshots/diff-2100.png) |

### Tick 2200

| TS | WASM | Diff |
|----|------|------|
| ![TS](screenshots/ts-2200.png) | ![WASM](screenshots/wasm-2200.png) | ![Diff](screenshots/diff-2200.png) |

### Tick 2300

| TS | WASM | Diff |
|----|------|------|
| ![TS](screenshots/ts-2300.png) | ![WASM](screenshots/wasm-2300.png) | ![Diff](screenshots/diff-2300.png) |

### Tick 2400

| TS | WASM | Diff |
|----|------|------|
| ![TS](screenshots/ts-2400.png) | ![WASM](screenshots/wasm-2400.png) | ![Diff](screenshots/diff-2400.png) |

### Tick 2500

| TS | WASM | Diff |
|----|------|------|
| ![TS](screenshots/ts-2500.png) | ![WASM](screenshots/wasm-2500.png) | ![Diff](screenshots/diff-2500.png) |

### Tick 2600

| TS | WASM | Diff |
|----|------|------|
| ![TS](screenshots/ts-2600.png) | ![WASM](screenshots/wasm-2600.png) | ![Diff](screenshots/diff-2600.png) |

### Tick 2700

| TS | WASM | Diff |
|----|------|------|
| ![TS](screenshots/ts-2700.png) | ![WASM](screenshots/wasm-2700.png) | ![Diff](screenshots/diff-2700.png) |
