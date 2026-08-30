#!/usr/bin/env bash
# run-ablation-nofreeze.sh — ablation arm of the drift study.
#
# Reuses each target's EXISTING index + baseline master plan (from the frozen
# run) and re-runs ONLY phase 3 with --no-freeze: the same goals are replayed,
# but the agent REGENERATES the code against the new version instead of the
# baseline programs being executed verbatim. Freeze is therefore the single
# variable between the two arms.
#
# Sequential on purpose: the arms must not contend for the same containers.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "── commander ──"
deno run --allow-all scripts/experiment-runner.ts --config commander \
  --no-freeze --fresh --project-id 6a7e09e81580755772d91081 --baseline-id 6a7e0eaa1580755772d910b3

echo "── eslint ──"
deno run --allow-all scripts/experiment-runner.ts --config eslint \
  --no-freeze --fresh --project-id 6a7e22c61580755772d91151 --baseline-id 6a7e2c891580755772d911ac

echo "── execa ──"
deno run --allow-all scripts/experiment-runner.ts --config execa \
  --no-freeze --fresh --project-id 6a7e09e91580755772d91085 --baseline-id 6a7e13ef1580755772d910f4

echo "── got ──"
deno run --allow-all scripts/experiment-runner.ts --config got \
  --no-freeze --fresh --project-id 6a7e0f141580755772d910cd --baseline-id 6a7e1b051580755772d9111d

echo "── ky ──"
deno run --allow-all scripts/experiment-runner.ts --config ky \
  --no-freeze --fresh --project-id 6a7e18cd1580755772d91113 --baseline-id 6a7e20ad1580755772d91140

echo "── marked ──"
deno run --allow-all scripts/experiment-runner.ts --config marked \
  --no-freeze --fresh --project-id 6a7e40be1580755772d91242 --baseline-id 6a7e43d81580755772d91271

echo "── mikroorm ──"
deno run --allow-all scripts/experiment-runner.ts --config mikroorm \
  --no-freeze --fresh --project-id 6a7e2f3c1580755772d911d2 --baseline-id 6a7e3cd11580755772d9121d

echo "── typeorm ──"
deno run --allow-all scripts/experiment-runner.ts --config typeorm \
  --no-freeze --fresh --project-id 6a7e2f2d1580755772d911cc --baseline-id 6a7e3a761580755772d9120c

echo "── undici ──"
deno run --allow-all scripts/experiment-runner.ts --config undici \
  --no-freeze --fresh --project-id 6a7e40151580755772d91236 --baseline-id 6a7e46aa1580755772d91294

echo "── vite ──"
deno run --allow-all scripts/experiment-runner.ts --config vite \
  --no-freeze --fresh --project-id 6a7e23d91580755772d91165 --baseline-id 6a7e29f61580755772d91193

echo "ablacja zakończona — deno task report:all"
