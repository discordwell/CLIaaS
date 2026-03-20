# M8 (SCG08EA) Dual-Runtime Comparison Report

Generated: 2026-03-20T02:27:23.086Z
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
| E2 | 50 | - | **NO** |
| HARV | 600 | 600 | Yes |
| JEEP | 150 | 150 | Yes |
| MNLY | 100 | 100 | Yes |
| V2RL | 150 | 150 | Yes |

## Death Counts by Unit Type

| Unit Type | TS Deaths | WASM Deaths | Delta |
|-----------|-----------|-------------|-------|
| 1TNK | 1 | 0 | 1 |
| ARTY | 0 | 1 | 1 |
| BADR | 0 | 6 | 6 |
| E1 | 13 | 5 | 8 |
| E2 | 2 | 0 | 2 |
| E3 | 0 | 2 | 2 |
| HARV | 1 | 2 | 1 |
| MCV | 1 | 1 | 0 |
| YAK | 4 | 0 | 4 |

## Average Damage Taken Per Hit by Unit Type

| Unit Type | TS Avg Dmg | WASM Avg Dmg | Diff % | Flag |
|-----------|------------|--------------|--------|------|
| 1TNK | 67.5 (n=4) | 20.5 (n=12) | 69.6% | **>15%** |
| 2TNK | 0.0 (n=0) | 28.9 (n=32) | 100.0% | **>15%** |
| 3TNK | 0.0 (n=0) | 11.0 (n=30) | 100.0% | **>15%** |
| ARTY | 0.0 (n=0) | 10.5 (n=15) | 100.0% | **>15%** |
| BADR | 0.0 (n=0) | 19.0 (n=3) | 100.0% | **>15%** |
| E1 | 40.0 (n=1) | 6.7 (n=14) | 83.2% | **>15%** |
| HARV | 64.4 (n=9) | 0.0 (n=0) | 100.0% | **>15%** |
| JEEP | 0.0 (n=0) | 4.5 (n=15) | 100.0% | **>15%** |
| MNLY | 0.0 (n=0) | 15.3 (n=17) | 100.0% | **>15%** |
| V2RL | 18.0 (n=4) | 8.0 (n=27) | 55.6% | **>15%** |
| YAK | 19.0 (n=12) | 13.2 (n=15) | 30.5% | **>15%** |

## Average Speed by Unit Type

| Unit Type | TS Avg Speed | WASM Avg Speed | Diff % | Flag |
|-----------|--------------|----------------|--------|------|
| 1TNK | 1.21 (n=26) | 1.28 (n=259) | 5.7% | **>5%** |
| 2TNK | 1.14 (n=50) | 1.23 (n=482) | 6.9% | **>5%** |
| 3TNK | 0.00 (n=0) | 1.51 (n=38) | 100.0% | **>5%** |
| 4TNK | 0.00 (n=0) | 1.18 (n=28) | 100.0% | **>5%** |
| ARTY | 1.17 (n=22) | 1.24 (n=154) | 6.3% | **>5%** |
| BADR | 1.05 (n=70) | 2.06 (n=117) | 49.2% | **>5%** |
| C7 | 0.00 (n=0) | 1.00 (n=1) | 100.0% | **>5%** |
| DD | 1.01 (n=40) | 1.18 (n=106) | 14.4% | **>5%** |
| E1 | 1.03 (n=89) | 1.08 (n=1014) | 5.0% | **>5%** |
| E2 | 1.07 (n=12) | 0.00 (n=0) | 100.0% | **>5%** |
| E3 | 0.00 (n=0) | 1.24 (n=238) | 100.0% | **>5%** |
| HARV | 0.00 (n=0) | 3.41 (n=25) | 100.0% | **>5%** |
| JEEP | 1.28 (n=3) | 1.35 (n=121) | 5.3% | **>5%** |
| MCV | 1.00 (n=1) | 1.00 (n=4) | 0.0% |  |
| MNLY | 0.00 (n=0) | 1.26 (n=171) | 100.0% | **>5%** |
| V2RL | 0.00 (n=0) | 1.20 (n=65) | 100.0% | **>5%** |
| YAK | 1.08 (n=251) | 1.74 (n=131) | 37.9% | **>5%** |

## Average Build Duration by Type

| Item Type | TS Avg Ticks | WASM Avg Ticks | Diff % | Flag |
|-----------|--------------|----------------|--------|------|
| E3 | 0 (n=0) | 260 (n=8) | 100.0% | **>10%** |
| POWR | 0 (n=0) | 170 (n=1) | 100.0% | **>10%** |
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
| 300 | 64000 | 60257 | 94.15% | **>5%** |
| 400 | 64000 | 60255 | 94.15% | **>5%** |
| 500 | 64000 | 55469 | 86.67% | **>5%** |
| 600 | 64000 | 60109 | 93.92% | **>5%** |
| 700 | 64000 | 60157 | 94.00% | **>5%** |
| 800 | 64000 | 59642 | 93.19% | **>5%** |
| 900 | 64000 | 59874 | 93.55% | **>5%** |
| 1000 | 64000 | 59897 | 93.59% | **>5%** |
| 1100 | 64000 | 59760 | 93.38% | **>5%** |
| 1200 | 64000 | 60261 | 94.16% | **>5%** |
| 1300 | 64000 | 55469 | 86.67% | **>5%** |
| 1400 | 64000 | 60260 | 94.16% | **>5%** |
| 1500 | 64000 | 60258 | 94.15% | **>5%** |
| 1600 | 64000 | 60256 | 94.15% | **>5%** |
| 1700 | 64000 | 60256 | 94.15% | **>5%** |
| 1800 | 64000 | 60257 | 94.15% | **>5%** |
| 1900 | 64000 | 60256 | 94.15% | **>5%** |
| 2000 | 64000 | 60266 | 94.17% | **>5%** |
| 2100 | 64000 | 59793 | 93.43% | **>5%** |
| 2200 | 64000 | 55469 | 86.67% | **>5%** |
| 2300 | 64000 | 59790 | 93.42% | **>5%** |
| 2400 | 64000 | 60262 | 94.16% | **>5%** |
| 2500 | 64000 | 60261 | 94.16% | **>5%** |
| 2600 | 64000 | 60260 | 94.16% | **>5%** |
| 2700 | 64000 | 55469 | 86.67% | **>5%** |

## Production Timeline

| Tick | Runtime | Item | Event | Progress |
|------|---------|------|-------|----------|
| 310 | wasm | E3 | started | 3% |
| 310 | wasm | POWR | started | 3% |
| 470 | wasm | E3 | completed | 100% |
| 480 | wasm | E3 | started | 3% |
| 480 | wasm | POWR | completed | 100% |
| 490 | wasm | WEAP | started | 0% |
| 640 | wasm | E3 | completed | 100% |
| 650 | wasm | E3 | started | 3% |
| 810 | wasm | E3 | completed | 100% |
| 820 | wasm | E3 | started | 1% |
| 1140 | wasm | E3 | completed | 100% |
| 1150 | wasm | E3 | started | 1% |
| 1470 | wasm | E3 | completed | 100% |
| 1480 | wasm | E3 | started | 1% |
| 1800 | wasm | E3 | completed | 100% |
| 1810 | wasm | E3 | started | 1% |
| 2130 | wasm | E3 | completed | 100% |
| 2140 | wasm | E3 | started | 1% |
| 2190 | wasm | WEAP | completed | 100% |
| 2200 | wasm | HARV | started | 0% |
| 2200 | wasm | APWR | started | 0% |
| 2460 | wasm | E3 | completed | 100% |
| 2470 | wasm | E3 | started | 1% |

## Structure Counts Over Time

| Tick | TS Allied Structs | WASM Allied Structs | TS Enemy Structs | WASM Enemy Structs |
|------|-------------------|---------------------|------------------|--------------------|
| 0 | 27 | 26 | 39 | 23 |
| 100 | 27 | 26 | 39 | 23 |
| 200 | 27 | 26 | 39 | 23 |
| 300 | 28 | 27 | 39 | 23 |
| 400 | 28 | 27 | 39 | 23 |
| 500 | 28 | 28 | 39 | 23 |
| 600 | 28 | 28 | 39 | 23 |
| 700 | 28 | 28 | 39 | 23 |
| 800 | 28 | 27 | 39 | 23 |
| 900 | 28 | 27 | 39 | 23 |
| 1000 | 28 | 27 | 39 | 23 |
| 1100 | 28 | 27 | 39 | 23 |
| 1200 | 28 | 27 | 39 | 23 |
| 1300 | 28 | 27 | 39 | 23 |
| 1400 | 28 | 27 | 39 | 23 |
| 1500 | 28 | 27 | 39 | 23 |
| 1600 | 28 | 27 | 39 | 23 |
| 1700 | 28 | 27 | 39 | 23 |
| 1800 | 28 | 27 | 39 | 23 |
| 1900 | 28 | 27 | 39 | 23 |
| 2000 | 28 | 27 | 39 | 23 |
| 2100 | 28 | 27 | 39 | 23 |
| 2200 | 28 | 28 | 39 | 23 |
| 2300 | 28 | 28 | 39 | 23 |
| 2400 | 28 | 28 | 39 | 23 |
| 2500 | 28 | 28 | 39 | 23 |
| 2600 | 28 | 28 | 39 | 23 |
| 2700 | 28 | 28 | 39 | 23 |

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
