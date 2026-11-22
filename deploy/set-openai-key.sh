#!/bin/bash
# Sends OPENAI_API_KEY from the local .env to the demo server over SSH (never printed) and starts the stack.
# Usage, from the repo root: bash deploy/set-openai-key.sh [host-ip]
set -eu
HOST_IP="${1:-32.188.91.207}"
cd "$(dirname "$0")/.."
bun --env-file=.env -e 'const k = process.env.OPENAI_API_KEY; if (!k) { console.error("OPENAI_API_KEY is missing in .env"); process.exit(1) } process.stdout.write(k + "\n")' \
  | ssh -i ~/.ssh/copitch-demo -o StrictHostKeyChecking=accept-new "ubuntu@$HOST_IP" bash /srv/copitch/start.sh
