# M8 (SCG08EA) Dual-Runtime Comparison Report

Generated: 2026-03-20T04:12:26.798Z
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
| 2TNK | 1 | 0 | 1 |
| ARTY | 1 | 0 | 1 |
| BADR | 0 | 4 | 4 |
| C1 | 0 | 1 | 1 |
| E1 | 13 | 10 | 3 |
| E2 | 2 | 0 | 2 |
| E3 | 11 | 1 | 10 |
| HARV | 1 | 7 | 6 |
| MCV | 1 | 1 | 0 |
| V2RL | 1 | 0 | 1 |
| YAK | 4 | 2 | 2 |

## Average Damage Taken Per Hit by Unit Type

| Unit Type | TS Avg Dmg | WASM Avg Dmg | Diff % | Flag |
|-----------|------------|--------------|--------|------|
| 1TNK | 54.0 (n=5) | 5.9 (n=16) | 89.1% | **>15%** |
| 2TNK | 57.7 (n=6) | 30.1 (n=34) | 47.9% | **>15%** |
| 3TNK | 16.0 (n=3) | 23.5 (n=37) | 31.9% | **>15%** |
| ARTY | 28.0 (n=2) | 31.6 (n=9) | 11.3% |  |
| C1 | 0.0 (n=0) | 28.0 (n=2) | 100.0% | **>15%** |
| E1 | 40.0 (n=1) | 9.3 (n=29) | 76.6% | **>15%** |
| E3 | 40.0 (n=1) | 5.0 (n=2) | 87.5% | **>15%** |
| HARV | 53.6 (n=11) | 0.0 (n=0) | 100.0% | **>15%** |
| JEEP | 0.0 (n=0) | 75.5 (n=2) | 100.0% | **>15%** |
| MNLY | 0.0 (n=0) | 56.5 (n=12) | 100.0% | **>15%** |
| V2RL | 19.6 (n=7) | 14.5 (n=8) | 25.9% | **>15%** |
| YAK | 19.0 (n=12) | 12.7 (n=17) | 33.1% | **>15%** |

## Average Speed by Unit Type

| Unit Type | TS Avg Speed | WASM Avg Speed | Diff % | Flag |
|-----------|--------------|----------------|--------|------|
| 1TNK | 1.20 (n=27) | 1.22 (n=245) | 1.6% |  |
| 2TNK | 1.10 (n=62) | 1.41 (n=508) | 21.8% | **>5%** |
| 3TNK | 0.00 (n=0) | 2.37 (n=93) | 100.0% | **>5%** |
| 4TNK | 0.00 (n=0) | 1.13 (n=28) | 100.0% | **>5%** |
| ARTY | 1.16 (n=26) | 1.46 (n=93) | 20.6% | **>5%** |
| BADR | 1.11 (n=62) | 2.19 (n=86) | 49.4% | **>5%** |
| C1 | 0.00 (n=0) | 1.28 (n=83) | 100.0% | **>5%** |
| DD | 1.01 (n=37) | 1.14 (n=101) | 11.3% | **>5%** |
| E1 | 1.03 (n=85) | 1.19 (n=1040) | 13.7% | **>5%** |
| E2 | 1.07 (n=12) | 0.00 (n=0) | 100.0% | **>5%** |
| E3 | 1.00 (n=22) | 1.31 (n=351) | 23.5% | **>5%** |
| HARV | 0.00 (n=0) | 6.30 (n=29) | 100.0% | **>5%** |
| JEEP | 1.28 (n=3) | 1.97 (n=124) | 35.3% | **>5%** |
| MCV | 1.00 (n=1) | 1.00 (n=4) | 0.0% |  |
| MNLY | 0.00 (n=0) | 1.52 (n=124) | 100.0% | **>5%** |
| V2RL | 0.00 (n=0) | 1.36 (n=96) | 100.0% | **>5%** |
| YAK | 1.06 (n=263) | 1.56 (n=309) | 32.5% | **>5%** |

## Average Build Duration by Type

| Item Type | TS Avg Ticks | WASM Avg Ticks | Diff % | Flag |
|-----------|--------------|----------------|--------|------|
| E3 | 70 (n=11) | 188 (n=12) | 62.7% | **>10%** |
| POWR | 90 (n=12) | 170 (n=1) | 47.1% | **>10%** |
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
| 400 | 64000 | 59806 | 93.45% | **>5%** |
| 500 | 64000 | 60339 | 94.28% | **>5%** |
| 600 | 64000 | 59516 | 92.99% | **>5%** |
| 700 | 64000 | 60142 | 93.97% | **>5%** |
| 800 | 64000 | 60265 | 94.16% | **>5%** |
| 900 | 64000 | 60295 | 94.21% | **>5%** |
| 1000 | 64000 | 60299 | 94.22% | **>5%** |
| 1100 | 64000 | 60316 | 94.24% | **>5%** |
| 1200 | 64000 | 60290 | 94.20% | **>5%** |
| 1300 | 64000 | 60366 | 94.32% | **>5%** |
| 1400 | 64000 | 60395 | 94.37% | **>5%** |
| 1500 | 64000 | 60325 | 94.26% | **>5%** |
| 1600 | 64000 | 60272 | 94.17% | **>5%** |
| 1700 | 64000 | 55469 | 86.67% | **>5%** |
| 1800 | 64000 | 59796 | 93.43% | **>5%** |
| 1900 | 64000 | 60272 | 94.17% | **>5%** |
| 2000 | 64000 | 55469 | 86.67% | **>5%** |
| 2100 | 64000 | 60280 | 94.19% | **>5%** |
| 2200 | 64000 | 60271 | 94.17% | **>5%** |
| 2300 | 64000 | 60271 | 94.17% | **>5%** |
| 2400 | 64000 | 60278 | 94.18% | **>5%** |
| 2500 | 64000 | 60277 | 94.18% | **>5%** |
| 2600 | 64000 | 60276 | 94.18% | **>5%** |
| 2700 | 64000 | 60274 | 94.18% | **>5%** |

## Production Timeline

| Tick | Runtime | Item | Event | Progress |
|------|---------|------|-------|----------|
| 270 | ts | POWR | started | 10% |
| 270 | ts | E3 | started | 13% |
| 310 | wasm | E3 | started | 3% |
| 310 | wasm | POWR | started | 3% |
| 340 | ts | E3 | completed | 100% |
| 350 | ts | E3 | started | 13% |
| 360 | ts | POWR | completed | 100% |
| 370 | ts | POWR | started | 10% |
| 420 | ts | E3 | completed | 100% |
| 430 | ts | E3 | started | 13% |
| 460 | ts | POWR | completed | 100% |
| 470 | ts | POWR | started | 10% |
| 470 | wasm | E3 | completed | 100% |
| 480 | wasm | E3 | started | 3% |
| 480 | wasm | POWR | completed | 100% |
| 490 | wasm | WEAP | started | 0% |
| 500 | ts | E3 | completed | 100% |
| 510 | ts | E3 | started | 13% |
| 560 | ts | POWR | completed | 100% |
| 570 | ts | POWR | started | 10% |
| 580 | ts | E3 | completed | 100% |
| 590 | ts | E3 | started | 13% |
| 640 | wasm | E3 | completed | 100% |
| 650 | wasm | E3 | started | 3% |
| 660 | ts | POWR | completed | 100% |
| 660 | ts | E3 | completed | 100% |
| 670 | ts | POWR | started | 10% |
| 670 | ts | E3 | started | 13% |
| 740 | ts | E3 | completed | 100% |
| 750 | ts | E3 | started | 13% |
| 760 | ts | POWR | completed | 100% |
| 770 | ts | POWR | started | 10% |
| 810 | wasm | E3 | completed | 100% |
| 820 | ts | E3 | completed | 100% |
| 820 | wasm | E3 | started | 1% |
| 830 | ts | E3 | started | 13% |
| 860 | ts | POWR | completed | 100% |
| 870 | ts | POWR | started | 10% |
| 900 | ts | E3 | completed | 100% |
| 910 | ts | E3 | started | 13% |
| 960 | ts | POWR | completed | 100% |
| 970 | ts | POWR | started | 10% |
| 980 | ts | E3 | completed | 100% |
| 990 | ts | E3 | started | 13% |
| 1060 | ts | POWR | completed | 100% |
| 1060 | ts | E3 | completed | 100% |
| 1070 | ts | POWR | started | 10% |
| 1070 | ts | E3 | started | 13% |
| 1090 | wasm | E3 | completed | 100% |
| 1100 | wasm | E3 | started | 1% |
| 1140 | ts | E3 | completed | 100% |
| 1160 | ts | POWR | completed | 100% |
| 1170 | ts | POWR | started | 10% |
| 1260 | ts | POWR | completed | 100% |
| 1270 | ts | POWR | started | 10% |
| 1360 | ts | POWR | completed | 100% |
| 1370 | ts | POWR | started | 10% |
| 1370 | wasm | E3 | completed | 100% |
| 1380 | wasm | E3 | started | 3% |
| 1460 | ts | POWR | completed | 100% |
| 1470 | ts | POWR | started | 10% |
| 1540 | wasm | E3 | completed | 100% |
| 1550 | wasm | E3 | started | 3% |
| 1710 | wasm | E3 | completed | 100% |
| 1720 | wasm | E3 | started | 3% |
| 1880 | wasm | E3 | completed | 100% |
| 1890 | wasm | E3 | started | 3% |
| 2050 | wasm | E3 | completed | 100% |
| 2060 | wasm | E3 | started | 3% |
| 2190 | wasm | WEAP | completed | 100% |
| 2200 | wasm | HARV | started | 0% |
| 2200 | wasm | APWR | started | 1% |
| 2220 | wasm | E3 | completed | 100% |
| 2230 | wasm | E3 | started | 3% |
| 2390 | wasm | E3 | completed | 100% |
| 2400 | wasm | E3 | started | 1% |
| 2670 | wasm | E3 | completed | 100% |
| 2680 | wasm | E3 | started | 1% |

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
| 1300 | 28 | 25 | 22 | 23 |
| 1400 | 28 | 25 | 22 | 23 |
| 1500 | 28 | 25 | 22 | 23 |
| 1600 | 28 | 25 | 22 | 23 |
| 1700 | 28 | 25 | 22 | 23 |
| 1800 | 28 | 25 | 22 | 23 |
| 1900 | 28 | 25 | 22 | 23 |
| 2000 | 28 | 25 | 22 | 23 |
| 2100 | 28 | 25 | 22 | 23 |
| 2200 | 28 | 26 | 22 | 23 |
| 2300 | 28 | 26 | 22 | 23 |
| 2400 | 28 | 26 | 22 | 23 |
| 2500 | 28 | 26 | 22 | 23 |
| 2600 | 28 | 26 | 22 | 23 |
| 2700 | 28 | 26 | 22 | 23 |

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
