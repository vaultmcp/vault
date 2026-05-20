#!/usr/bin/env bash
# Deploy demo-site and collector to vault-beta EC2
# Usage: bash scripts/deploy-demo.sh
set -e

BASE="$(cd "$(dirname "$0")/.." && pwd)"
KEY="$HOME/.ssh/deploy-key.pem"
HOST="ubuntu@vaultmcp.io"
REMOTE_APP="$HOST:/opt/vault/demo-site/vault-workspace/packages/demo-site"

echo "→ building demo-site..."
cd "$BASE/packages/demo-site"
VAULT_BASE_RPC_URL=https://base-sepolia-rpc.publicnode.com \
  COLLECTOR_URL=http://127.0.0.1:8787 \
  NEXT_PUBLIC_COLLECTOR_URL=http://vaultmcp.io \
  pnpm build

echo "→ syncing files..."
rsync -az -e "ssh -i $KEY" \
  "$BASE/packages/demo-site/.next/standalone/vault-workspace/packages/demo-site/" \
  "$REMOTE_APP/" &

rsync -az --delete -e "ssh -i $KEY" \
  "$BASE/packages/demo-site/.next/static" \
  "$REMOTE_APP/.next/" &

rsync -az --delete -e "ssh -i $KEY" \
  "$BASE/packages/demo-site/public" \
  "$REMOTE_APP/" &

wait

echo "→ restarting services..."
ssh -i "$KEY" "$HOST" "pm2 restart vault-demo"

echo "✓ deployed to http://vaultmcp.io"
