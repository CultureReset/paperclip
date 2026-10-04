#!/bin/sh
# Cron sidecar for gcr-api-clean (gcr-crons profile).
set -eu
: "${CRON_SECRET:?CRON_SECRET must be set}"
: "${GCR_INTERNAL_URL:?GCR_INTERNAL_URL must be set}"
umask 077
{
  printf 'CRON_SECRET=%s\n' "$CRON_SECRET"
  printf 'GCR_INTERNAL_URL=%s\n' "$GCR_INTERNAL_URL"
} > /run/cron.env
crontab /cron/crontab
echo "cron sidecar: $(grep -cvE '^\s*(#|$)' /cron/crontab) jobs against ${GCR_INTERNAL_URL}"
# Foreground, log to stderr (docker logs).
exec crond -f -l 8 -L /dev/stderr
