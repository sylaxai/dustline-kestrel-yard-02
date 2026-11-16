// DUSTLINE Kestrel Yard — entry program for make.fun's threejs-fps-02 bounty.
// Runs on Node 22 with only the standard library. The playable game lives in the
// static game/ directory next to this file (plain ES modules, three.js served from a
// local import map); this program is the handoff to the grader. It copies the game and
// the screenshots into the output directory, then asks the vendored make.fun library
// to write dossier.json, the summary the judge reads.
//
// Play it locally with `node serve.ts` and open http://localhost:8080.
// When MAKEFUN_OUTPUT_DIR is set (local runs), it stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync as copyTree, existsSync as pathExists, mkdirSync as makeDir, writeFileSync as writeFile } from 'node:fs';
import { join as joinPath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

function entry() {
  const root = fileURLToPath(new URL('.', import.meta.url));
  const dest = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

  makeDir(dest, { recursive: true });
  copyTree(joinPath(root, 'game'), joinPath(dest, 'game'), { recursive: true });
  makeDir(joinPath(dest, 'screenshots'), { recursive: true });
  const shots = joinPath(root, 'screenshots');
  if (pathExists(shots)) copyTree(shots, joinPath(dest, 'screenshots'), { recursive: true });

  // Caps from the scorer's reference/gate.json. Only text_max_bytes shapes the
  // dossier's bytes; the rest mirror the scorer's refusals (at most 4 screenshots,
  // none over 256 KiB; game/ at most 993 files and 48 MiB, counted beside /output's
  // own 1000-entry cap, its screenshots/ and dossier.json).
  const caps = {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  };
  writeFile(joinPath(dest, 'dossier.json'), buildDossier(dest, caps));
}

entry();
