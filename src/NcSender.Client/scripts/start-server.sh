#!/bin/bash
PROJ="$(dirname "$0")/../../NcSender.Server"
DLL="$PROJ/bin/Debug/net10.0/NcSender.Server.dll"

if [ ! -f "$DLL" ] || find "$PROJ" -name "*.cs" -newer "$DLL" | grep -q .; then
  echo "[server] Changes detected, building..."
  dotnet run --project "$PROJ"
else
  echo "[server] No changes, skipping build..."
  dotnet run --no-build --project "$PROJ"
fi
