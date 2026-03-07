# Red Alert Agent Parity Report

Generated: 2026-03-07T01:30:03.110Z
Base URL: http://localhost:3001
Server started by script: no
Status: ok

Total diffs: 189
Checkpoints with diffs: 2

Checkpoints:
- initial: diffs=93, tsDelta=0, wasmDelta=0 (Initial gameplay snapshot after load)
- idle-60: diffs=96, tsDelta=60, wasmDelta=60 (No commands, both engines advanced 60 ticks)

Top diffs:
- initial :: top_level :: credits :: TS=1500 :: WASM=0
- initial :: top_level :: power.produced :: TS=51 :: WASM=0
- initial :: top_level :: power.consumed :: TS=190 :: WASM=0
- initial :: unit_counts :: units.C7 :: TS=null :: WASM=1
- initial :: unit_counts :: units.C8 :: TS=null :: WASM=1
- idle-60 :: top_level :: credits :: TS=1500 :: WASM=0
- idle-60 :: top_level :: power.produced :: TS=51 :: WASM=0
- idle-60 :: top_level :: power.consumed :: TS=190 :: WASM=0
- idle-60 :: unit_counts :: units.C7 :: TS=null :: WASM=1
- idle-60 :: unit_counts :: units.C8 :: TS=null :: WASM=1

Full JSON: /Users/discordwell/Projects/Zachathon/test-results/parity/agent-parity.json