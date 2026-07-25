#!/usr/bin/env bash
# Push the secret env vars from the local .env into the Railway `veritas`
# project. Run this yourself — the values never leave your machine except to
# Railway. Everything non-secret is already set.
#
#   bash scripts/railway-secrets.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "error: .env not found in $(pwd)" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
. ./.env
set +a

require() {
  if [ -z "${!1:-}" ]; then
    echo "error: $1 is not set in .env" >&2
    exit 1
  fi
}

require COORDINATOR_API_KEY
require SOLANA_KEYPAIR
require VERITAS_FEE_ADDRESS
require ARC_PRIVATE_KEY

# DEVNET_KEYPAIR funds + registers the three demo sellers. It is normally
# passed inline from the Solana CLI config rather than stored in .env.
DEVNET_KEYPAIR="${DEVNET_KEYPAIR:-$(cat ~/.config/solana/id.json)}"

echo "→ coordinator"
railway variables --service coordinator \
  --set "COORDINATOR_API_KEY=$COORDINATOR_API_KEY" \
  --set "SOLANA_KEYPAIR=$SOLANA_KEYPAIR" \
  --set "VERITAS_FEE_ADDRESS=$VERITAS_FEE_ADDRESS" \
  --skip-deploys >/dev/null

echo "→ sellers"
railway variables --service sellers \
  --set "COORDINATOR_API_KEY=$COORDINATOR_API_KEY" \
  --set "DEVNET_KEYPAIR=$DEVNET_KEYPAIR" \
  --skip-deploys >/dev/null

echo "→ demo"
railway variables --service demo \
  --set "ARC_PRIVATE_KEY=$ARC_PRIVATE_KEY" \
  --skip-deploys >/dev/null

echo
echo "All secrets set. Nothing was printed and no redeploy was triggered."
