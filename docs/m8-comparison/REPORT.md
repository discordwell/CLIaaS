# M8 (SCG08EA) Dual-Runtime Comparison Report

Generated: 2026-03-20T04:44:52.076Z
Final tick: 1300
TS outcome: playing
WASM outcome: defeat

## Unit Stats at Mission Start

| Unit Type | TS Max HP | WASM Max HP | Match |
|-----------|-----------|-------------|-------|
| 1TNK | 300 | 300 | Yes |
| 2TNK | 400 | 400 | Yes |
| 3TNK | 400 | 400 | Yes |
| ARTY | 75 | 75 | Yes |
| E1 | 50 | 50 | Yes |
| E2 | 50 | - | **NO** |
| HARV | 600 | 600 | Yes |
| JEEP | 150 | 150 | Yes |
| MNLY | 100 | 100 | Yes |
| V2RL | 150 | 150 | Yes |

## Death Counts by Unit Type

| Unit Type | TS Deaths | WASM Deaths | Delta |
|-----------|-----------|-------------|-------|
| 1TNK | 1 | 0 | 1 |
| BADR | 0 | 5 | 5 |
| E1 | 6 | 2 | 4 |
| E2 | 1 | 0 | 1 |
| HARV | 0 | 2 | 2 |
| MCV | 1 | 1 | 0 |
| YAK | 2 | 0 | 2 |

## Average Damage Taken Per Hit by Unit Type

| Unit Type | TS Avg Dmg | WASM Avg Dmg | Diff % | Flag |
|-----------|------------|--------------|--------|------|
| 1TNK | 67.5 (n=4) | 26.4 (n=18) | 60.8% | **>15%** |
| 2TNK | 0.0 (n=0) | 17.8 (n=35) | 100.0% | **>15%** |
| 3TNK | 0.0 (n=0) | 17.3 (n=39) | 100.0% | **>15%** |
| ARTY | 0.0 (n=0) | 27.9 (n=7) | 100.0% | **>15%** |
| HARV | 40.0 (n=8) | 0.0 (n=0) | 100.0% | **>15%** |
| JEEP | 0.0 (n=0) | 1.0 (n=2) | 100.0% | **>15%** |
| MNLY | 0.0 (n=0) | 8.7 (n=11) | 100.0% | **>15%** |
| V2RL | 18.0 (n=4) | 27.3 (n=6) | 34.1% | **>15%** |
| YAK | 19.0 (n=6) | 18.0 (n=7) | 5.3% |  |

## Average Speed by Unit Type

| Unit Type | TS Avg Speed | WASM Avg Speed | Diff % | Flag |
|-----------|--------------|----------------|--------|------|
| 1TNK | 1.21 (n=26) | 1.36 (n=98) | 11.0% | **>5%** |
| 2TNK | 1.14 (n=50) | 1.33 (n=261) | 14.4% | **>5%** |
| 3TNK | 0.00 (n=0) | 2.31 (n=77) | 100.0% | **>5%** |
| ARTY | 1.17 (n=22) | 1.31 (n=110) | 10.9% | **>5%** |
| BADR | 1.00 (n=40) | 2.49 (n=66) | 59.9% | **>5%** |
| DD | 1.02 (n=36) | 1.12 (n=49) | 8.5% | **>5%** |
| E1 | 1.02 (n=95) | 1.07 (n=431) | 4.6% |  |
| E2 | 1.07 (n=12) | 0.00 (n=0) | 100.0% | **>5%** |
| E3 | 1.00 (n=6) | 1.12 (n=60) | 11.1% | **>5%** |
| HARV | 0.00 (n=0) | 38.30 (n=2) | 100.0% | **>5%** |
| JEEP | 1.28 (n=3) | 1.62 (n=61) | 21.5% | **>5%** |
| MCV | 1.00 (n=1) | 1.00 (n=4) | 0.0% |  |
| MNLY | 0.00 (n=0) | 1.29 (n=134) | 100.0% | **>5%** |
| V2RL | 0.00 (n=0) | 1.78 (n=26) | 100.0% | **>5%** |
| YAK | 1.09 (n=186) | 1.61 (n=176) | 32.6% | **>5%** |

## Average Build Duration by Type

| Item Type | TS Avg Ticks | WASM Avg Ticks | Diff % | Flag |
|-----------|--------------|----------------|--------|------|
| E3 | 280 (n=3) | 188 (n=4) | 33.0% | **>10%** |
| POWR | 280 (n=3) | 170 (n=1) | 39.3% | **>10%** |

## Mission Timer Comparison

| Runtime | Mission Timer | Flag |
|---------|---------------|------|
| TS      | 39225 | |
| WASM    | 39200 | |
| Delta   | 25 |  |

## Visual Pixel Diff Summary

| Tick | Total Pixels | Diff Pixels | Diff % | Flag |
|------|--------------|-------------|--------|------|
| 0 | 64000 | 55469 | 86.67% | **>5%** |
| 100 | 64000 | 60260 | 94.16% | **>5%** |
| 200 | 64000 | 60259 | 94.15% | **>5%** |
| 300 | 64000 | 59792 | 93.42% | **>5%** |
| 400 | 64000 | 60255 | 94.15% | **>5%** |
| 500 | 64000 | 60291 | 94.20% | **>5%** |
| 600 | 64000 | 60272 | 94.17% | **>5%** |
| 700 | 64000 | 60041 | 93.81% | **>5%** |
| 800 | 64000 | 55469 | 86.67% | **>5%** |
| 900 | 64000 | 55469 | 86.67% | **>5%** |
| 1000 | 64000 | 55469 | 86.67% | **>5%** |
| 1100 | 64000 | 59800 | 93.44% | **>5%** |
| 1200 | 64000 | 59801 | 93.44% | **>5%** |
| 1300 | 64000 | 59801 | 93.44% | **>5%** |

## Production Timeline

| Tick | Runtime | Item | Event | Progress |
|------|---------|------|-------|----------|
| 260 | ts | POWR | started | 3% |
| 260 | ts | E3 | started | 3% |
| 310 | wasm | E3 | started | 3% |
| 310 | wasm | POWR | started | 3% |
| 470 | wasm | E3 | completed | 100% |
| 480 | wasm | E3 | started | 3% |
| 480 | wasm | POWR | completed | 100% |
| 490 | wasm | WEAP | started | 0% |
| 540 | ts | POWR | completed | 100% |
| 540 | ts | E3 | completed | 100% |
| 550 | ts | POWR | started | 3% |
| 550 | ts | E3 | started | 3% |
| 640 | wasm | E3 | completed | 100% |
| 650 | wasm | E3 | started | 3% |
| 810 | wasm | E3 | completed | 100% |
| 820 | wasm | E3 | started | 1% |
| 830 | ts | POWR | completed | 100% |
| 830 | ts | E3 | completed | 100% |
| 840 | ts | POWR | started | 3% |
| 840 | ts | E3 | started | 3% |
| 1090 | wasm | E3 | completed | 100% |
| 1100 | wasm | E3 | started | 1% |
| 1120 | ts | POWR | completed | 100% |
| 1120 | ts | E3 | completed | 100% |
| 1130 | ts | POWR | started | 3% |
| 1130 | ts | E3 | started | 3% |

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
| 1100 | 28 | 27 | 22 | 23 |
| 1200 | 28 | 26 | 22 | 23 |
| 1300 | 28 | 25 | 22 | 23 |

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
