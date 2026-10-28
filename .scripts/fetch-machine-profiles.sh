#!/usr/bin/env bash
# Builds ship the latest released machine profiles: download them over the
# committed copy. When GitHub can't be reached the committed copy stays.
set -uo pipefail
cd "$(dirname "$0")/.."

url="https://github.com/siganberg/ncSender.machine-profiles/releases/latest/download/profiles.json"
dest="src/NcSender.Server/MachineProfiles/machine-profiles.json"
tmp="$(mktemp)"

if curl -fsSL --retry 3 --max-time 30 "$url" -o "$tmp" && grep -q '"schemaVersion": *1[,}[:space:]]' "$tmp"; then
  mv "$tmp" "$dest"
  echo "Machine profiles: latest release downloaded."
else
  rm -f "$tmp"
  echo "::warning::Machine profiles could not be downloaded; building with the committed copy."
fi
