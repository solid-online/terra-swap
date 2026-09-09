#!/usr/bin/env bash
# Read-only check of the renounce state via a public LCD. No keys, no terrad.
set -euo pipefail
LCD=${LCD:-https://terra-lcd.publicnode.com}
FACTORY=terra1gx7n4yrfc2req7tdt9vpj66kr0cssnqkjsr80xmfacjpdlw6mzlqvlp3xd
b64() { printf '%s' "$1" | base64 | tr -d '\n'; }
smart() { curl -s -m 20 "$LCD/cosmwasm/wasm/v1/contract/$1/smart/$(b64 "$2")"; }
info() { curl -s -m 20 "$LCD/cosmwasm/wasm/v1/contract/$1"; }

OWNER=$(smart "$FACTORY" '{"config":{}}' | jq -r '.data.owner')
ADMIN=$(info "$FACTORY" | jq -r '.contract_info.admin // ""')
echo "factory owner:  $OWNER"
echo "factory admin:  ${ADMIN:-(none)}"
OK=1
if [[ "$OWNER" == terra1ef4g5x* ]]; then echo "  ✗ owner is still the operator key"; OK=0; else
  T=$(smart "$OWNER" '{"target":{}}' | jq -r '.data // ""')
  [[ "$T" == "$FACTORY" ]] && echo "  ✓ owner is an owner-sink pointing at the factory" || { echo "  ? owner is not a known sink"; OK=0; }
  [[ -z "$(info "$OWNER" | jq -r '.contract_info.admin // ""')" ]] && echo "  ✓ sink has no admin" || { echo "  ✗ sink has an admin"; OK=0; }
fi
[[ -z "$ADMIN" ]] && echo "  ✓ factory has no migrate admin" || { echo "  ✗ factory still has a migrate admin"; OK=0; }

echo "pools:"
LEFT=0
for P in $(smart "$FACTORY" '{"pairs":{"limit":50}}' | jq -r '.data.pairs[].contract_addr'); do
  A=$(info "$P" | jq -r '.contract_info.admin // ""')
  if [[ -n "$A" ]]; then echo "  ✗ $P admin=$A"; LEFT=$((LEFT+1)); fi
done
[[ $LEFT -eq 0 ]] && echo "  ✓ no pool has a migrate admin" || OK=0
[[ $OK -eq 1 ]] && echo "RESULT: renounced" || { echo "RESULT: NOT renounced"; exit 1; }
