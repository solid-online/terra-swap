#!/usr/bin/env bash
# Store and instantiate the Terra Swap router with no admin, checking the chain
# after every step. Run it where terrad holds the deploy key.
#
#   ./deploy.sh <key-name>
#
# Env overrides: NODE (RPC), KEYRING (file|os|test), WASM (path to terra_swap_router.wasm).
# Needs: terrad, jq, curl.
set -euo pipefail

KEY=${1:?usage: ./deploy.sh <key-name>}
# Prefer the validator's own node when we are on it; fall back to a public RPC.
if [[ -z "${NODE:-}" ]]; then
  if curl -s -m 3 http://localhost:26657/status >/dev/null 2>&1; then NODE=http://localhost:26657; else NODE=https://terra-rpc.publicnode.com:443; fi
fi
CHAIN=phoenix-1
HERE=$(cd "$(dirname "$0")" && pwd)
WASM=${WASM:-$HERE/artifacts/terra_swap_router.wasm}
[[ -f "$WASM" ]] || WASM=$HERE/terra_swap_router.wasm
EXPECTED_SHA=d4f36193c98a92dd455fda0e3b2a899071edda1c638d3dbc8149e0e9caf31ff3
FACTORIES='["terra1gx7n4yrfc2req7tdt9vpj66kr0cssnqkjsr80xmfacjpdlw6mzlqvlp3xd","terra14x9fr055x5hvr48hzy2t4q7kvjvfttsvxusa4xsdcy702mnzsvuqprer8r"]'
KEYRING=${KEYRING:-file}
KR=(--keyring-backend "$KEYRING")
# A key kept under another terrad home: TERRA_HOME=/path ./deploy.sh <key-name>
if [[ -n "${TERRA_HOME:-}" ]]; then KR+=(--home "$TERRA_HOME"); fi
Q=(--node "$NODE" -o json)

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31mSTOP: %s\033[0m\n' "$*" >&2; exit 1; }
sha() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

# Ask for the keyring passphrase once and feed it to every signing call on stdin. It is never written anywhere.
PASS=""
if [[ "$KEYRING" == "file" || "$KEYRING" == "os" ]]; then
  read -r -s -p "Keyring passphrase for '$KEY': " PASS; echo
fi
signed() { printf '%s\n' "$PASS" | terrad "$@"; }

# Wait for inclusion and fail loudly on a non-zero code. Prints the tx JSON.
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
  out=$(signed tx "$@" --from "$KEY" --chain-id "$CHAIN" --node "$NODE" --gas auto --gas-adjustment 1.5 --gas-prices 0.015uluna -y -o json --broadcast-mode sync "${KR[@]}")
  hash=$(jq -r '.txhash' <<<"$out")
  [[ "$hash" =~ ^[0-9A-F]{64}$ ]] || die "no txhash in: $out"
  echo "  tx $hash" >&2
  wait_tx "$hash"
}
attr() { # attr <txjson> <event type> <key>
  jq -r --arg t "$2" --arg k "$3" '
    ([.events[]?, (.logs[]?.events[]?)] | map(select(.type==$t)) | .[0].attributes[]? | select(.key==$k) | .value) // empty' <<<"$1" | head -1
}

# ─── preflight ─────────────────────────────────────────────────────────
say "Preflight"
command -v terrad >/dev/null || die "terrad not found"
command -v jq >/dev/null || die "jq not found"
[[ -f "$WASM" ]] || die "wasm not found at $WASM"
GOT_SHA=$(sha "$WASM")
[[ "$GOT_SHA" == "$EXPECTED_SHA" ]] || die "wasm sha256 is $GOT_SHA, expected $EXPECTED_SHA"
echo "  wasm ok: $WASM ($GOT_SHA)"
ERR=$(mktemp)
KEY_ADDR=$(signed keys show "$KEY" -a "${KR[@]}" 2>"$ERR" | tail -1 || true)
if [[ ! "$KEY_ADDR" =~ ^terra1 ]]; then
  WHY=$(grep -m1 -i -E 'passphrase|not found|not a valid|no such' "$ERR" || true); rm -f "$ERR"
  die "could not open key '$KEY' in the '$KEYRING' keyring${TERRA_HOME:+ under $TERRA_HOME} (${WHY:-no reason given}). Nothing was sent. Check which keyring holds it with: terrad keys list --keyring-backend $KEYRING${TERRA_HOME:+ --home $TERRA_HOME}"
fi
rm -f "$ERR"
LUNA=$(terrad query bank balances "$KEY_ADDR" "${Q[@]}" | jq -r '[.balances[]? | select(.denom=="uluna") | .amount][0] // "0"')
(( LUNA >= 200000 )) || die "$KEY_ADDR holds $LUNA uluna; keep at least 0.2 LUNA for gas"
echo "  key ok: $KEY_ADDR, $(awk "BEGIN{printf \"%.2f\", $LUNA/1000000}") LUNA"
echo "  node: $NODE"
echo
echo "This stores the router and instantiates it with no admin and the factories"
echo "  $FACTORIES"
echo "Nothing about it can be changed afterwards."
read -r -p "Type DEPLOY to continue: " ok
[[ "$ok" == "DEPLOY" ]] || die "aborted"

# ─── 1. store ──────────────────────────────────────────────────────────
say "1. Store the router"
J=$(send wasm store "$WASM")
CODE_ID=$(attr "$J" store_code code_id)
[[ -n "$CODE_ID" ]] || die "could not read code_id"
ONCHAIN_SHA=$(terrad query wasm code-info "$CODE_ID" "${Q[@]}" | jq -r '.data_hash // .code_info.data_hash' | tr 'A-F' 'a-f')
[[ "$ONCHAIN_SHA" == "$EXPECTED_SHA" ]] || die "code $CODE_ID has checksum $ONCHAIN_SHA, expected $EXPECTED_SHA"
echo "  code_id: $CODE_ID, checksum matches"

# ─── 2. instantiate ────────────────────────────────────────────────────
say "2. Instantiate (no admin)"
J=$(send wasm instantiate "$CODE_ID" "{\"factories\":$FACTORIES}" --label "Terra Swap router" --no-admin)
ROUTER=$(attr "$J" instantiate _contract_address)
[[ "$ROUTER" =~ ^terra1 ]] || die "could not read the router address"

# ─── 3. check ──────────────────────────────────────────────────────────
say "3. Check"
ADMIN=$(terrad query wasm contract "$ROUTER" "${Q[@]}" | jq -r '.contract_info.admin // ""')
[[ -z "$ADMIN" ]] || die "router has an admin: $ADMIN"
GOT_F=$(terrad query wasm contract-state smart "$ROUTER" '{"config":{}}' "${Q[@]}" | jq -c '.data.factories')
[[ "$GOT_F" == "$FACTORIES" ]] || die "router factories are $GOT_F"
echo "  no admin, factories as intended"

say "Done"
echo "  router: $ROUTER"
echo "  Send this address back; the site turns it on after a route through it has been simulated."
