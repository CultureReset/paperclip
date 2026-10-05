#!/usr/bin/env bash
# Starts gcr-api-clean (memdb) and Paperclip (embedded Postgres) as two HTTP
# processes, runs the Step 5 (apps in the store) walk between them, stops both. Read-only on the repos.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRATCH="$(dirname "$HERE")"
export PC_PORT="${PC_PORT:-4600}"
export GCR_PORT="${GCR_PORT:-4610}"
export PC_URL="http://127.0.0.1:$PC_PORT"
export GCR_URL="http://127.0.0.1:$GCR_PORT"
export NEXTGENT_SERVICE_SECRET="proof-shared-service-secret-$(date +%s)"
TSX=/home/user/paperclip/server/node_modules/.bin/tsx

PAPERCLIP_URL="$PC_URL" node "$HERE/gcr-server.cjs" > "$HERE/gcr-server.log" 2>&1 &
GCR_PID=$!
# Embedded Postgres runs initdb as `postgres` when node is root; the preload hands the temp dir over.
( cd /home/user/paperclip/server && NODE_OPTIONS="--import $SCRATCH/chown-tmp-for-postgres.mjs" "$TSX" "$HERE/paperclip-server.mts" ) > "$HERE/paperclip-server.log" 2>&1 &
PC_PID=$!

cleanup() { kill -TERM "$PC_PID" "$GCR_PID" 2>/dev/null; sleep 3; kill -KILL "$PC_PID" "$GCR_PID" 2>/dev/null; }
trap cleanup EXIT

node "$HERE/walk.mjs"
STATUS=$?
echo "walk exit: $STATUS"
exit $STATUS
