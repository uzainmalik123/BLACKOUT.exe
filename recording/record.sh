#!/usr/bin/env bash
# Records one move variant against the isolated rig (docs/PRD.md REC-02).
#   recording/record.sh <MOVE> <VARIANT> <PUBLIC_IP>     e.g. record.sh ATK-03 a 203.0.113.23
# Writes the raw run to recording/runs/<MOVE>.<VARIANT>/ (gitignored); game/scripts/convert-recording.ts
# turns it into the committed JSON (D-15). Every run starts from a fresh shop, so it's re-runnable.
set -euo pipefail
cd "$(dirname "$0")"

[ $# -eq 3 ] || { echo "usage: $0 <MOVE> <VARIANT> <PUBLIC_IP in 203.0.113.0/24>" >&2; exit 2; }
move=$1 variant=$2 public_ip=$3
[[ $public_ip =~ ^203\.0\.113\.([0-9]{1,3})$ ]] && [ "${BASH_REMATCH[1]}" -le 255 ] \
  || { echo "public IP must be inside 203.0.113.0/24" >&2; exit 2; }
script="attacks/$move.$variant.sh"
[ -f "$script" ] || { echo "no script $script" >&2; exit 2; }

out="runs/$move.$variant"
compose() { docker compose -p rec "$@"; }
ms() { date +%s%3N; }

echo "== fresh rig"
compose --profile attack build -q tools >/dev/null   # the tools image is local-only; cleanup below needs it
compose --profile attack down -v --remove-orphans >/dev/null 2>&1 || true
# nginx writes its logs as root, so a throwaway container clears them; we recreate the dirs as us.
mkdir -p runs   # first, or Docker creates it for the mount as root (a fresh clone or worktree)
docker run --rm --network none -v "$PWD/runs:/r" rec-tools:2 rm -rf /r/.nginx /r/.out "/r/$move.$variant"
mkdir -p runs/.nginx runs/.out "$out"
compose up -d --wait juice nginx >/dev/null 2>&1

echo "== isolation"
./check-isolation.sh

# Seed and setup talk to the shop directly (not through nginx) and before the window opens, so
# neither is in the recording. Setup is what the move assumes Death already has (e.g. a token).
tools() { compose --profile attack run --rm --no-deps -T --user "$(id -u):$(id -g)" -e HOME=/tmp tools "$@"; }
echo "== seed (REC-04)"
tools python3 /attacks/lib/customers.py seed http://10.66.0.20:3000
setup="attacks/$move.$variant.setup.sh"
if [ -f "$setup" ]; then
  echo "== setup: $setup"
  tools bash "/$setup"
fi
sleep 1
# nginx owns its log files (root), so instead of truncating we remember where the attack starts.
skip_log=$(wc -c < runs/.nginx/access.log) skip_jsonl=$(wc -c < runs/.nginx/access.jsonl)

echo "== before"
docker cp -q rec-juice-1:/juice-shop/data/juiceshop.sqlite "$out/before.sqlite"
docker cp -q rec-juice-1:/juice-shop/uploads "$out/uploads-before"

echo "== attack: $script"
started=$(ms)
tools bash "/attacks/$move.$variant.sh" > "$out/attack.out" 2> "$out/attack.err"
ended=$(ms)
sleep 2   # let nginx and the shop flush their logs

echo "== after"
docker cp -q rec-juice-1:/juice-shop/data/juiceshop.sqlite "$out/after.sqlite"
docker cp -q rec-juice-1:/juice-shop/uploads "$out/uploads-after"
docker logs --timestamps rec-juice-1 > "$out/app.log" 2>&1
tail -c +$((skip_log + 1)) runs/.nginx/access.log > "$out/access.log"
tail -c +$((skip_jsonl + 1)) runs/.nginx/access.jsonl > "$out/access.jsonl"
cp -r runs/.out/. "$out/" 2>/dev/null || true

cat > "$out/run.json" <<JSON
{
  "move": "$move",
  "variant": "$variant",
  "publicIp": "$public_ip",
  "attackerIp": "10.66.0.66",
  "image": "bkimminich/juice-shop:v20.4.0",
  "tool": "$(grep -m1 '^# tool:' "$script" | cut -d' ' -f3-)",
  "label": "$(grep -m1 '^# label:' "$script" | cut -d' ' -f3-)",
  "startedAtMs": $started,
  "endedAtMs": $ended
}
JSON
echo "== done: $out ($(wc -l < "$out/access.jsonl") requests, $((ended - started)) ms)"
