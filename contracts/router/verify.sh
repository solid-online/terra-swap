#!/usr/bin/env bash
# Read-only check of a deployed Terra Swap router via a public LCD. No keys, no terrad.
set -euo pipefail
ROUTER=${1:?usage: verify.sh <router address>}
LCD=${LCD:-https://terra-lcd.publicnode.com}
HERE=$(cd "$(dirname "$0")" && pwd)
b64() { printf '%s' "$1" | base64 | tr -d '\n'; }
smart() { curl -s -m 20 "$LCD/cosmwasm/wasm/v1/contract/$1/smart/$(b64 "$2")"; }

EXPECT_FACTORIES="terra1gx7n4yrfc2req7tdt9vpj66kr0cssnqkjsr80xmfacjpdlw6mzlqvlp3xd,terra14x9fr055x5hvr48hzy2t4q7kvjvfttsvxusa4xsdcy702mnzsvuqprer8r"
LOCAL=$(awk '{print $1}' "$HERE/artifacts/checksums.txt" | head -1 | tr 'A-F' 'a-f')

INFO=$(curl -s -m 20 "$LCD/cosmwasm/wasm/v1/contract/$ROUTER")
CODE=$(echo "$INFO" | jq -r '.contract_info.code_id')
ADMIN=$(echo "$INFO" | jq -r '.contract_info.admin // ""')
ONCHAIN=$(curl -s -m 60 "$LCD/cosmwasm/wasm/v1/code/$CODE" | jq -r '.code_info.data_hash' | tr 'A-F' 'a-f')
FACTORIES=$(smart "$ROUTER" '{"config":{}}' | jq -r '.data.factories | join(",")')

OK=1
echo "router:    $ROUTER (code $CODE)"
[[ "$ONCHAIN" == "$LOCAL" ]] && echo "  ✓ stored code matches artifacts/checksums.txt" || { echo "  ✗ stored code $ONCHAIN, artifact $LOCAL"; OK=0; }
[[ -z "$ADMIN" ]] && echo "  ✓ no admin: nobody can migrate it" || { echo "  ✗ admin is $ADMIN"; OK=0; }
[[ "$FACTORIES" == "$EXPECT_FACTORIES" ]] && echo "  ✓ factories: Terra Swap's and Astroport's, nothing else" || { echo "  ✗ factories: $FACTORIES"; OK=0; }
[[ $OK -eq 1 ]] && echo "RESULT: as built" || { echo "RESULT: NOT as built"; exit 1; }
