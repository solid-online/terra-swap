#!/usr/bin/env bash
# Read-only check of Terra Swap's factory v2 and router v2 from a public LCD. No keys.
#
#   ./verify.sh <factory-v2> <router-v2>
set -euo pipefail

FACTORY2=${1:?usage: ./verify.sh <factory-v2> <router-v2>}
ROUTER2=${2:?usage: ./verify.sh <factory-v2> <router-v2>}
LCD=${LCD:-https://terra-lcd.publicnode.com}
V1_FACTORY=terra1gx7n4yrfc2req7tdt9vpj66kr0cssnqkjsr80xmfacjpdlw6mzlqvlp3xd
ASTRO_FACTORY=terra14x9fr055x5hvr48hzy2t4q7kvjvfttsvxusa4xsdcy702mnzsvuqprer8r
FACTORY_SHA=363b4859ac08d9acbf2387b864cf74d3f7954ac34b52acae9d9d71c6fdde1dd1
SINK_SHA=b62e749bd03846cf6abf48ebc7bd33413a0647e5ee557a65de9abef2661a6ab1
ROUTER_SHA=d4f36193c98a92dd455fda0e3b2a899071edda1c638d3dbc8149e0e9caf31ff3

fail=0
ok()  { printf '  \033[32mok\033[0m   %s\n' "$*"; }
bad() { printf '  \033[31mBAD\033[0m  %s\n' "$*"; fail=1; }
get() { curl -s -m 20 "$LCD$1"; }
smart() { get "/cosmwasm/wasm/v1/contract/$1/smart/$(printf '%s' "$2" | base64 | tr -d '\n' | sed 's/+/%2B/g;s/\//%2F/g;s/=/%3D/g')" | jq -c '.data'; }
info() { get "/cosmwasm/wasm/v1/contract/$1" | jq -c '.contract_info'; }
sha_of_code() { get "/cosmwasm/wasm/v1/code/$1" | jq -r '.code_info.data_hash | ascii_downcase'; }

echo "Factory v2 $FACTORY2"
FI=$(info "$FACTORY2")
[[ "$(sha_of_code "$(jq -r .code_id <<<"$FI")")" == "$FACTORY_SHA" ]] && ok "runs Astroport's factory code" || bad "unexpected code"
[[ -z "$(jq -r '.admin // ""' <<<"$FI")" ]] && ok "no admin: nobody can migrate it" || bad "has an admin"
CFG=$(smart "$FACTORY2" '{"config":{}}')
[[ "$(jq -r .fee_address <<<"$CFG")" == "null" ]] && ok "no fee address: no maker fee is taken" || bad "has a fee address"
[[ "$(jq -r '[.pair_configs[].maker_fee_bps] | max' <<<"$CFG")" == "0" ]] && ok "maker fee 0 on every pool type" || bad "a pool type has a maker fee"
echo "       pool types: $(jq -r '[.pair_configs[] | (.pair_type | if type == "object" then (to_entries[0] | if .key == "custom" then .value else .key end) else . end)] | join(", ")' <<<"$CFG")"
SINK=$(jq -r .owner <<<"$CFG")
SI=$(info "$SINK")
[[ "$(sha_of_code "$(jq -r .code_id <<<"$SI")")" == "$SINK_SHA" ]] && ok "owner is an owner-sink contract ($SINK)" || bad "owner $SINK is not the owner-sink code"
[[ -z "$(jq -r '.admin // ""' <<<"$SI")" ]] && ok "the sink has no admin" || bad "the sink has an admin"
[[ "$(smart "$SINK" '{"target":{}}' | jq -r .)" == "$FACTORY2" ]] && ok "the sink holds this factory" || bad "the sink points elsewhere"

echo "Router v2 $ROUTER2"
RI=$(info "$ROUTER2")
[[ "$(sha_of_code "$(jq -r .code_id <<<"$RI")")" == "$ROUTER_SHA" ]] && ok "runs contracts/router" || bad "unexpected code"
[[ -z "$(jq -r '.admin // ""' <<<"$RI")" ]] && ok "no admin" || bad "has an admin"
[[ "$(smart "$ROUTER2" '{"config":{}}' | jq -c .factories)" == "[\"$V1_FACTORY\",\"$FACTORY2\",\"$ASTRO_FACTORY\"]" ]] && ok "trusts Terra Swap v1, v2 and Astroport" || bad "unexpected factories"

echo
[[ $fail == 0 ]] && echo "RESULT: renounced, fee-free" || { echo "RESULT: something is off"; exit 1; }
