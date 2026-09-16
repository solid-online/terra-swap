#!/usr/bin/env bash
# Open Terra Swap's second factory for concentrated and stable pools, hand its
# ownership to a contract that can never use it, and put a router in front of
# both factories. Nothing new is stored: every contract runs code already on
# chain (Astroport's factory and pair code, the owner sink, the Terra Swap
# router), and the checksums are checked before anything is signed.
#
#   ./deploy.sh <key-name>
#
# Re-runnable: FACTORY2, SINK2 or ROUTER2 in the environment skip the steps that
# made them. Env overrides: NODE (RPC), KEYRING (file|os|test), TERRA_HOME.
# Needs: terrad, jq, curl.
set -euo pipefail

KEY=${1:?usage: ./deploy.sh <key-name>}
if [[ -z "${NODE:-}" ]]; then
  if curl -s -m 3 http://localhost:26657/status >/dev/null 2>&1; then NODE=http://localhost:26657; else NODE=https://terra-rpc.publicnode.com:443; fi
fi
CHAIN=phoenix-1
EXPECTED_KEY=terra1ef4g5xlfzts7a9c0p22q7wuc6mwjzzekd6afsv
V1_FACTORY=terra1gx7n4yrfc2req7tdt9vpj66kr0cssnqkjsr80xmfacjpdlw6mzlqvlp3xd
ASTRO_FACTORY=terra14x9fr055x5hvr48hzy2t4q7kvjvfttsvxusa4xsdcy702mnzsvuqprer8r
COIN_REGISTRY=terra1zuf8fla02926nhpfvk09k2pg6qv9aayflp0qt4a0msppu2h4exqs6af275

# code id → sha256, read from the chain on 2026-09-16
FACTORY_CODE=3108; FACTORY_SHA=363b4859ac08d9acbf2387b864cf74d3f7954ac34b52acae9d9d71c6fdde1dd1   # Astroport factory
PCL_CODE=2569;     PCL_SHA=998aa47044ac5b7279bdbf5d1ab68876b7cf5cc7022a6f4844812dc3cafc1e6d       # Astroport concentrated pair
STABLE_CODE=428;   STABLE_SHA=f6acaf41d2730d709d1c57562b754553a67a632f13d94875b71d5633de038a13    # Astroport stable pair
SINK_CODE=4025;    SINK_SHA=b62e749bd03846cf6abf48ebc7bd33413a0647e5ee557a65de9abef2661a6ab1      # contracts/owner-sink
ROUTER_CODE=4028;  ROUTER_SHA=d4f36193c98a92dd455fda0e3b2a899071edda1c638d3dbc8149e0e9caf31ff3    # contracts/router

KEYRING=${KEYRING:-file}
KR=(--keyring-backend "$KEYRING")
if [[ -n "${TERRA_HOME:-}" ]]; then KR+=(--home "$TERRA_HOME"); fi
Q=(--node "$NODE" -o json)

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31mSTOP: %s\033[0m\n' "$*" >&2; exit 1; }

PASS=""
if [[ "$KEYRING" == "file" || "$KEYRING" == "os" ]]; then
  read -r -s -p "Keyring passphrase for '$KEY': " PASS; echo
fi
signed() { printf '%s\n' "$PASS" | terrad "$@"; }

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
send() {
  local out hash
  out=$(signed tx "$@" --from "$KEY" --chain-id "$CHAIN" --node "$NODE" --gas auto --gas-adjustment 1.5 --gas-prices 0.015uluna -y -o json --broadcast-mode sync "${KR[@]}")
  hash=$(jq -r '.txhash' <<<"$out")
  [[ "$hash" =~ ^[0-9A-F]{64}$ ]] || die "no txhash in: $out"
  echo "  tx $hash" >&2
  wait_tx "$hash"
}
attr() {
  jq -r --arg t "$2" --arg k "$3" '
    ([.events[]?, (.logs[]?.events[]?)] | map(select(.type==$t)) | .[0].attributes[]? | select(.key==$k) | .value) // empty' <<<"$1" | head -1
}
smart() { terrad query wasm contract-state smart "$1" "$2" "${Q[@]}" | jq -c '.data'; }
admin_of() { terrad query wasm contract "$1" "${Q[@]}" | jq -r '.contract_info.admin // ""'; }
code_sha() { terrad query wasm code-info "$1" "${Q[@]}" | jq -r '(.data_hash // .code_info.data_hash // "") | ascii_downcase'; }

# ─── preflight ─────────────────────────────────────────────────────────
say "Preflight"
command -v terrad >/dev/null || die "terrad not found"
command -v jq >/dev/null || die "jq not found"
KEY_ADDR=$(signed keys show "$KEY" -a "${KR[@]}" | tail -1)
[[ "$KEY_ADDR" == "$EXPECTED_KEY" ]] || die "key $KEY is $KEY_ADDR, expected $EXPECTED_KEY"
echo "  key ok: $KEY_ADDR"
for pair in "$FACTORY_CODE:$FACTORY_SHA" "$PCL_CODE:$PCL_SHA" "$STABLE_CODE:$STABLE_SHA" "$SINK_CODE:$SINK_SHA" "$ROUTER_CODE:$ROUTER_SHA"; do
  id=${pair%%:*}; want=${pair##*:}
  got=$(code_sha "$id")
  [[ "$got" == "$want" ]] || die "code $id checksum is $got, expected $want"
  echo "  code $id checksum ok"
done

INIT=$(jq -nc --arg owner "$KEY_ADDR" --arg registry "$COIN_REGISTRY" --argjson pcl "$PCL_CODE" --argjson stable "$STABLE_CODE" '{
  owner: $owner, token_code_id: 69, whitelist_code_id: 70, coin_registry_address: $registry,
  fee_address: null, generator_address: null,
  pair_configs: [
    { code_id: $pcl,    pair_type: { custom: "concentrated" }, total_fee_bps: 0, maker_fee_bps: 0, is_disabled: false, is_generator_disabled: true, permissioned: false },
    { code_id: $stable, pair_type: { stable: {} },             total_fee_bps: 5, maker_fee_bps: 0, is_disabled: false, is_generator_disabled: true, permissioned: false }
  ] }')
echo
echo "Factory settings (permanent once ownership is in the sink):"
jq . <<<"$INIT"
echo
echo "This opens a factory with no fee address and no admin, gives its ownership to a"
echo "contract that can never use it, and instantiates a router with no admin. There is no way back."
read -r -p "Type DEPLOY to continue: " ok
[[ "$ok" == "DEPLOY" ]] || die "aborted"

# ─── 1. factory ────────────────────────────────────────────────────────
if [[ -z "${FACTORY2:-}" ]]; then
  say "1. Instantiate factory v2 (no admin)"
  J=$(send wasm instantiate "$FACTORY_CODE" "$INIT" --label terra-swap-factory-v2 --no-admin)
  FACTORY2=$(attr "$J" instantiate _contract_address)
  [[ "$FACTORY2" =~ ^terra1 ]] || die "could not read the factory address"
fi
echo "  factory v2: $FACTORY2"
[[ -z "$(admin_of "$FACTORY2")" ]] || die "factory v2 has an admin"
CFG=$(smart "$FACTORY2" '{"config":{}}')
[[ "$(jq -r '.fee_address' <<<"$CFG")" == "null" ]] || die "factory v2 has a fee address"
[[ "$(jq -r '[.pair_configs[].maker_fee_bps] | max' <<<"$CFG")" == "0" ]] || die "factory v2 has a maker fee"

# ─── 2. sink ───────────────────────────────────────────────────────────
if [[ -z "${SINK2:-}" ]]; then
  say "2. Instantiate an owner sink for it (no admin)"
  J=$(send wasm instantiate "$SINK_CODE" "{\"target\":\"$FACTORY2\"}" --label terra-swap-owner-sink-v2 --no-admin)
  SINK2=$(attr "$J" instantiate _contract_address)
  [[ "$SINK2" =~ ^terra1 ]] || die "could not read the sink address"
fi
echo "  sink v2: $SINK2"
[[ "$(smart "$SINK2" '{"target":{}}' | jq -r .)" == "$FACTORY2" ]] || die "sink target is not factory v2"
[[ -z "$(admin_of "$SINK2")" ]] || die "sink v2 has an admin"

# ─── 3. hand over ownership ────────────────────────────────────────────
OWNER=$(jq -r '.owner' <<<"$(smart "$FACTORY2" '{"config":{}}')")
if [[ "$OWNER" == "$KEY_ADDR" ]]; then
  say "3. Propose the sink as owner, then claim through it"
  send wasm execute "$FACTORY2" "{\"propose_new_owner\":{\"owner\":\"$SINK2\",\"expires_in\":604800}}" >/dev/null
  send wasm execute "$SINK2" '{"claim":{}}' >/dev/null
  OWNER=$(jq -r '.owner' <<<"$(smart "$FACTORY2" '{"config":{}}')")
fi
[[ "$OWNER" == "$SINK2" ]] || die "factory v2 owner is $OWNER, expected $SINK2"
echo "  factory v2 owner is the sink. Ownership is dead."

# ─── 4. router ─────────────────────────────────────────────────────────
if [[ -z "${ROUTER2:-}" ]]; then
  say "4. Instantiate router v2 over both Terra Swap factories and Astroport's (no admin)"
  J=$(send wasm instantiate "$ROUTER_CODE" "{\"factories\":[\"$V1_FACTORY\",\"$FACTORY2\",\"$ASTRO_FACTORY\"]}" --label "Terra Swap router v2" --no-admin)
  ROUTER2=$(attr "$J" instantiate _contract_address)
  [[ "$ROUTER2" =~ ^terra1 ]] || die "could not read the router address"
fi
echo "  router v2: $ROUTER2"
[[ -z "$(admin_of "$ROUTER2")" ]] || die "router v2 has an admin"
[[ "$(smart "$ROUTER2" '{"config":{}}' | jq -c '.factories')" == "[\"$V1_FACTORY\",\"$FACTORY2\",\"$ASTRO_FACTORY\"]" ]] || die "router v2 factories are not v1, v2 and Astroport"

say "Done"
echo "  Set these in the Vercel project terra-swap and redeploy:"
echo "    NEXT_PUBLIC_DEX_FACTORY_V2=$FACTORY2"
echo "    NEXT_PUBLIC_TERRA_SWAP_ROUTER=$ROUTER2"
echo "  Check it again any time without keys: ./verify.sh $FACTORY2 $ROUTER2"
