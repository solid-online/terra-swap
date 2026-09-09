#!/usr/bin/env bash
# Renounce control of the Terra Swap factory and its pools. One run, in order,
# with an on-chain check after every step. Irreversible by design.
#
#   ./renounce.sh <owner-key-name>
#
# Env overrides: NODE (RPC), KEYRING (os|file|test), SINK (skip store+instantiate
# if the sink already exists), WASM (path to owner_sink.wasm).
#
# Needs: terrad (with the owner key in its keyring), jq, curl.
set -euo pipefail

KEY=${1:?usage: ./renounce.sh <owner-key-name>}
# Prefer the validator's own node when we are on it; fall back to a public RPC.
if [[ -z "${NODE:-}" ]]; then
  if curl -s -m 3 http://localhost:26657/status >/dev/null 2>&1; then NODE=http://localhost:26657; else NODE=https://terra-rpc.publicnode.com:443; fi
fi
CHAIN=phoenix-1
FACTORY=terra1gx7n4yrfc2req7tdt9vpj66kr0cssnqkjsr80xmfacjpdlw6mzlqvlp3xd
EXPECTED_OWNER=terra1ef4g5xlfzts7a9c0p22q7wuc6mwjzzekd6afsv
WASM=${WASM:-$(dirname "$0")/artifacts/owner_sink.wasm}
# The owner key is expected in the encrypted `file` keyring (override with KEYRING=os|test).
KEYRING=${KEYRING:-file}
KR=(--keyring-backend "$KEYRING")
# `auto` for the big steps; the admin-clearing steps set a fixed number (the
# simulator under-estimates those by a hair and `auto` then runs out of gas).
GAS=auto
Q=(--node "$NODE" -o json)

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31mSTOP: %s\033[0m\n' "$*" >&2; exit 1; }

# Ask for the keyring passphrase once and feed it to every signing call on stdin,
# so ~18 transactions do not mean ~18 prompts. It is never written anywhere.
PASS=""
if [[ "$KEYRING" == "file" || "$KEYRING" == "os" ]]; then
  read -r -s -p "Keyring passphrase for '$KEY': " PASS; echo
fi
signed() { printf '%s\n' "$PASS" | terrad "$@"; }

# Broadcast, wait for inclusion, fail loudly on a non-zero code. Prints the tx JSON.
wait_tx() {
  local hash=$1 json
  for _ in $(seq 1 40); do
    if json=$(terrad query tx "$hash" "${Q[@]}" 2>/dev/null); then
      local code; code=$(jq -r '.code // 0' <<<"$json")
      [[ "$code" == "0" ]] || die "tx $hash failed (code $code): $(jq -r '.raw_log' <<<"$json")"
      echo "$json"; return 0
    fi
    sleep 3
  done
  die "tx $hash not found after 120s"
}
send() { # send <args…> → tx JSON
  local out hash
  out=$(signed tx "$@" --from "$KEY" --chain-id "$CHAIN" --node "$NODE" --gas "$GAS" --gas-adjustment 1.5 --gas-prices 0.015uluna -y -o json --broadcast-mode sync "${KR[@]}")
  hash=$(jq -r '.txhash' <<<"$out")
  [[ "$hash" =~ ^[0-9A-F]{64}$ ]] || die "no txhash in: $out"
  echo "  tx $hash" >&2
  wait_tx "$hash"
}
attr() { # attr <txjson> <event type> <key>
  jq -r --arg t "$2" --arg k "$3" '
    ([.events[]?, (.logs[]?.events[]?)] | map(select(.type==$t)) | .[0].attributes[]? | select(.key==$k) | .value) // empty' <<<"$1" | head -1
}
admin_of() { terrad query wasm contract "$1" "${Q[@]}" | jq -r '.contract_info.admin // ""'; }
owner_of_factory() { terrad query wasm contract-state smart "$FACTORY" '{"config":{}}' "${Q[@]}" | jq -r '.data.owner'; }
pools() { terrad query wasm contract-state smart "$FACTORY" '{"pairs":{"limit":50}}' "${Q[@]}" | jq -r '.data.pairs[].contract_addr'; }

# ─── preflight ─────────────────────────────────────────────────────────
say "Preflight"
command -v terrad >/dev/null || die "terrad not found"
command -v jq >/dev/null || die "jq not found"
KEY_ADDR=$(signed keys show "$KEY" -a "${KR[@]}" | tail -1)
[[ "$KEY_ADDR" == "$EXPECTED_OWNER" ]] || die "key $KEY is $KEY_ADDR, expected the owner $EXPECTED_OWNER"
echo "  owner key ok: $KEY_ADDR"
# Re-runnable: if ownership already sits in a sink, pick it up and go straight to the admins.
CUR_OWNER=$(owner_of_factory)
if [[ "$CUR_OWNER" != "$EXPECTED_OWNER" ]]; then
  T=$(terrad query wasm contract-state smart "$CUR_OWNER" '{"target":{}}' "${Q[@]}" 2>/dev/null | jq -r '.data // ""')
  [[ "$T" == "$FACTORY" ]] || die "factory owner is $CUR_OWNER, neither the operator key nor a sink"
  SINK=$CUR_OWNER
  echo "  ownership already in sink $SINK; skipping steps 1–3"
fi
echo "  factory admin: $(admin_of "$FACTORY")"
POOLS=$(pools); echo "  pools: $(wc -l <<<"$POOLS" | tr -d ' ')"
[[ -n "${SINK:-}" ]] || [[ -f "$WASM" ]] || die "wasm not found at $WASM (build it first, see RENOUNCE.md)"
[[ -n "${SINK:-}" ]] || echo "  wasm sha256: $(shasum -a 256 "$WASM" | cut -d' ' -f1)"
echo
echo "This hands factory ownership to a contract that can never use it, then clears"
echo "the migrate admin on the factory and every pool. There is no way back."
read -r -p "Type RENOUNCE to continue: " ok
[[ "$ok" == "RENOUNCE" ]] || die "aborted"

# ─── 1–3. sink, propose, claim (skipped when ownership is already in a sink) ──
if [[ "$CUR_OWNER" == "$EXPECTED_OWNER" ]]; then
if [[ -z "${SINK:-}" ]]; then
  say "1a. Store owner-sink"
  J=$(send wasm store "$WASM")
  CODE_ID=$(attr "$J" store_code code_id)
  [[ -n "$CODE_ID" ]] || die "could not read code_id"
  echo "  code_id: $CODE_ID"

  say "1b. Instantiate sink (no admin)"
  J=$(send wasm instantiate "$CODE_ID" "{\"target\":\"$FACTORY\"}" --label terra-swap-owner-sink --no-admin)
  SINK=$(attr "$J" instantiate _contract_address)
  [[ "$SINK" =~ ^terra1 ]] || die "could not read sink address"
fi
echo "  sink: $SINK"
[[ "$(terrad query wasm contract-state smart "$SINK" '{"target":{}}' "${Q[@]}" | jq -r '.data')" == "$FACTORY" ]] || die "sink target is not the factory"
[[ -z "$(admin_of "$SINK")" ]] || die "sink has an admin; instantiate it with --no-admin"

# ─── 2. propose ────────────────────────────────────────────────────────
say "2. Propose the sink as factory owner"
send wasm execute "$FACTORY" "{\"propose_new_owner\":{\"owner\":\"$SINK\",\"expires_in\":604800}}" >/dev/null

# ─── 3. claim ──────────────────────────────────────────────────────────
say "3. Claim through the sink"
send wasm execute "$SINK" '{"claim":{}}' >/dev/null
NEW_OWNER=$(owner_of_factory)
[[ "$NEW_OWNER" == "$SINK" ]] || die "factory owner is $NEW_OWNER, expected $SINK"
echo "  factory owner is now the sink. Ownership is dead."
fi

# ─── 4. admins ─────────────────────────────────────────────────────────
# clear-contract-admin is tiny and the simulator under-estimates it by a hair
# (60,279 wanted vs 60,889 used on the first run), so use a fixed gas here.
GAS=200000
say "4. Clear migrate admin on the factory"
if [[ -z "$(admin_of "$FACTORY")" ]]; then echo "  factory admin already clear"; else
  send wasm clear-contract-admin "$FACTORY" >/dev/null
  [[ -z "$(admin_of "$FACTORY")" ]] || die "factory still has an admin"
  echo "  factory admin cleared"
fi

say "4b. Clear migrate admin on every pool"
for P in $POOLS; do
  if [[ -z "$(admin_of "$P")" ]]; then echo "  $P already clear"; continue; fi
  send wasm clear-contract-admin "$P" >/dev/null
  [[ -z "$(admin_of "$P")" ]] || die "$P still has an admin"
  echo "  $P cleared"
done

say "Done"
echo "  factory $FACTORY: owner=$(owner_of_factory) admin='$(admin_of "$FACTORY")'"
echo "  pools with an admin left: $(for P in $(pools); do admin_of "$P"; done | grep -c . || true)"
echo "  Run ./verify.sh any time to re-check from a public LCD without keys."
