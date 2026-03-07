# Red Alert Agent Parity Report

Generated: 2026-03-07T03:46:51.860Z
Base URL: http://localhost:3001
Server started by script: yes
Status: ok

Total diffs: 165
Checkpoints with diffs: 4

Checkpoints:
- initial: diffs=38, tsDelta=0, wasmDelta=0 (Initial gameplay snapshot after load)
- idle-60: diffs=41, tsDelta=60, wasmDelta=60 (No commands, both engines advanced 60 ticks)
- jeep-move-120: diffs=43, tsDelta=180, wasmDelta=180 (Unique allied JEEP ordered to move toward cell (45,84))
- jeep-stop-45: diffs=43, tsDelta=225, wasmDelta=225 (Moved JEEP receives a stop command)

Top diffs:
- initial :: top_level :: power.consumed :: TS=190 :: WASM=0
- initial :: structure_counts :: structures.ally.V01 :: TS=null :: WASM=1
- initial :: structure_counts :: structures.ally.V02 :: TS=null :: WASM=2
- initial :: structure_counts :: structures.ally.V03 :: TS=null :: WASM=1
- initial :: structure_counts :: structures.ally.V06 :: TS=null :: WASM=1
- idle-60 :: top_level :: power.consumed :: TS=190 :: WASM=0
- idle-60 :: unit_counts :: enemies.ANT3 :: TS=2 :: WASM=null
- idle-60 :: unit_cells :: enemies.ANT3 :: TS=["48,41","88,41"] :: WASM=null
- idle-60 :: unit_hp :: enemies.ANT3 :: TS=[85,85] :: WASM=null
- idle-60 :: structure_counts :: structures.ally.V01 :: TS=null :: WASM=1
- jeep-move-120 :: top_level :: power.consumed :: TS=190 :: WASM=0
- jeep-move-120 :: unit_counts :: enemies.ANT3 :: TS=2 :: WASM=null
- jeep-move-120 :: unit_cells :: units.E1 :: TS=["42,87","43,88","44,86","44,87"] :: WASM=["42,87","43,86","43,88","44,87"]
- jeep-move-120 :: unit_cells :: units.JEEP :: TS=["45,84"] :: WASM=["43,87"]
- jeep-move-120 :: unit_cells :: enemies.ANT3 :: TS=["48,41","88,41"] :: WASM=null
- jeep-stop-45 :: top_level :: power.consumed :: TS=190 :: WASM=0
- jeep-stop-45 :: unit_counts :: enemies.ANT3 :: TS=2 :: WASM=null
- jeep-stop-45 :: unit_cells :: units.E1 :: TS=["42,87","43,88","44,86","44,87"] :: WASM=["42,87","43,86","43,88","44,87"]
- jeep-stop-45 :: unit_cells :: units.JEEP :: TS=["45,84"] :: WASM=["43,87"]
- jeep-stop-45 :: unit_cells :: enemies.ANT3 :: TS=["48,41","88,41"] :: WASM=null

Full JSON: /Users/discordwell/Projects/Zachathon/test-results/parity/agent-parity.json