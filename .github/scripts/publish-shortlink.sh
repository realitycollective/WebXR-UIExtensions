#!/usr/bin/env bash
# Create-and-VERIFY a da.gd short link for a target URL.
#
#   publish-shortlink.sh <apex-url> <preferred-code> [max-alternates]
#
# Every candidate is verified by following the redirect — da.gd can report a
# custom code as "already taken" while serving 404 for it (a dead, burned
# name), so creation output is never trusted on its own. Order:
#   1. the preferred custom code (use it if it already redirects correctly,
#      else try to claim it, then re-verify),
#   2. custom alternates <code>1..<code>N the same way,
#   3. a RANDOM da.gd code (da.gd dedupes by URL, so the same random code
#      comes back on every run — stable for bookmarks/QRs).
#
# Prints the VERIFIED short URL to stdout and exits 0, or prints nothing and
# exits 1 when nothing could be verified — callers must then fall back to
# publishing the direct URL instead of an unproven short link.
set -uo pipefail

APEX="${1%/}"
BASE_CODE="$2"
MAX_ALTERNATES="${3:-2}"

enc="$(jq -rn --arg u "$APEX" '$u|@uri')"

verify() {
  local short_url="$1" resolved
  resolved="$(curl -sS -o /dev/null -w '%{redirect_url}' --max-time 10 \
    "$short_url" 2>/dev/null || true)"
  [ -n "$resolved" ] && [ "${resolved%/}" = "$APEX" ]
}

# Phase 1+2: the memorable custom code, then alternates.
for i in $(seq 0 "$MAX_ALTERNATES"); do
  code="$BASE_CODE"
  [ "$i" -gt 0 ] && code="${BASE_CODE}${i}"

  if verify "https://da.gd/${code}"; then
    echo "https://da.gd/${code}"
    exit 0
  fi

  curl -sS --max-time 10 "https://da.gd/s?url=${enc}&shorturl=${code}" \
    >/dev/null 2>&1 || true

  if verify "https://da.gd/${code}"; then
    echo "https://da.gd/${code}"
    exit 0
  fi
done

# Phase 3: random code (deduped per URL by da.gd, so stable across runs).
random_url="$(curl -sS --max-time 10 "https://da.gd/s?url=${enc}" 2>/dev/null || true)"
case "$random_url" in
  https://da.gd/*)
    if verify "$random_url"; then
      echo "$random_url"
      exit 0
    fi
    ;;
esac

exit 1
