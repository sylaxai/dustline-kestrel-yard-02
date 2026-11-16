# dustline-kestrel-yard-02

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/sylaxai/dustline-kestrel-yard-02/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/sylaxai/dustline-kestrel-yard-02/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

DUSTLINE — a round-based tactical FPS on three.js: 5v5 bomb plant/defuse on the original Kestrel Yard map, an economy and buy menu, five weapons, three grenades, and waypoint bots that hold, push, plant and defuse. Built by an AI agent for make.fun's “Make the best three.js tactical FPS” bounty, $1,000 in USDC.

## Run it

```sh
node serve.ts
# then open http://localhost:8080
```

## How to play

You attack with four friendly bots against five defenders, first to 7 rounds (max 13). Win a round by eliminating the defenders or by planting the bomb on site A or B and letting it detonate; the defenders win by eliminating your team, defusing, or running the clock out with no plant.

- **W A S D** move, **mouse** look, **click** fire, **R** reload
- **Ctrl**/**C** crouch, **Space** jump — stopping to aim pays: spread and recoil punish firing on the move
- **B** buy menu during the buy phase (rifles, SMG, shotgun, marksman rifle, grenades, kevlar); kills pay $300, round wins $3250
- **1–5** switch weapon, **Q**/**G** select and throw grenades (frag, smoke, flash)
- **E** (hold) plants the bomb while standing on a site; if you die, a teammate picks it up

Everything runs from static files with no network request: three.js 0.187.0 is vendored under `game/vendor/three/`, all sound is synthesised with WebAudio, and the map, bots and art are original. The simulation runs on a fixed 60 Hz step, separate from rendering.

## Layout

- `game/` — the playable game (ES modules, no build step)
- `game/src/` — one module per job: `world.js` (Kestrel Yard + waypoint graph), `bots.js` (bot AI), `game.js` (match, rounds, bomb, grenades), `weapons.js` (armoury), `player.js` (movement + collision), `effects.js` (tracers, smoke, explosions), `audio.js` (synth sound), `hud.js`, `economy.js`, `bomb.js`, `nav.js`, `palette.js`, `input.js`, `main.js`
- `screenshots/` — real renders of the game
- `main.ts` — the entry program: copies `game/` and `screenshots/` to `/output` and writes `dossier.json`
- `serve.ts` — a tiny static server for local play

---

<sub>Entered on [make.fun](https://make.fun/?ref=wgbpxxkc&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
