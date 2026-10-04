#!/bin/sh
# Calls one gcr-api-clean cron route on the private compose network, with
# CRON_SECRET both ways the routes accept it (Authorization: Bearer for most,
# x-cron-secret for /api/gcr/deep-crawl/run).
# busybox crond does not pass the container's environment to jobs, so
# entrypoint.sh saves the two values this needs to /run/cron.env first (the mounted /cron folder is read-only).
set -eu
. /run/cron.env
method="$1"
path="$2"
if [ "$method" = "POST" ]; then
  extra="--post-data="
else
  extra=""
fi
# shellcheck disable=SC2086
if wget -q -O /dev/null -T 300 $extra \
  --header "Authorization: Bearer ${CRON_SECRET}" \
  --header "x-cron-secret: ${CRON_SECRET}" \
  "${GCR_INTERNAL_URL}${path}"; then
  echo "$(date -u +%FT%TZ) ok   ${method} ${path}"
else
  echo "$(date -u +%FT%TZ) FAIL ${method} ${path}"
fi
