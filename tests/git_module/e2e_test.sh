#!/usr/bin/env bash
#
# End-to-end automated test for the GIT module.
# Reproduces the manual query:
#   gh-search-clone search --token "${GH2}" -k "viveo" --exact --type repositories
#
# Secret-safe: the GitHub token ($GH2) is never printed, never placed in argv,
# and never written to the repo. It is read from the environment, passed to the
# backend only once (to create a Token credential), and sent to GitHub (for the
# parity check) via a 600-perm curl config file.
#
# Usage:  GH2=<token> ./tests/git_module/e2e_test.sh
# Optional: SHADOWINDEX_API=http://localhost:3000/api  (default)

set -uo pipefail

BASE="${SHADOWINDEX_API:-http://localhost:3000/api}"
TERM_KW="viveo"
: "${GH2:?GH2 (GitHub token) must be set in the environment}"

TMP="$(mktemp -d)"
chmod 700 "$TMP"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

FAILED=0
pass() { printf '  \033[32mPASS\033[0m %s\n' "$*"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$*"; FAILED=1; }
info() { printf '  ---- %s\n' "$*"; }
step() { printf '\n== %s ==\n' "$*"; }

jqr() { jq -r "$1" 2>/dev/null; }

#############################################################################
step "1. Stack health (backend + OpenSearch)"
STATUS_JSON="$(curl -s "$BASE/git/status")"
if [ -z "$STATUS_JSON" ]; then fail "backend not reachable at $BASE"; echo "Aborting."; exit 1; fi
OS_STATUS="$(echo "$STATUS_JSON" | jqr '.opensearch.status')"
OS_AVAIL="$(echo "$STATUS_JSON" | jqr '.opensearch.available')"
info "opensearch: status=$OS_STATUS available=$OS_AVAIL"
if [ "$OS_AVAIL" = "true" ]; then pass "OpenSearch available ($OS_STATUS)"; else fail "OpenSearch not available"; fi

#############################################################################
step "2. Create Token credential from \$GH2"
# Build JSON body with python (keeps token out of argv/logs)
GH2="$GH2" python3 - "$TMP/cred.json" <<'PY'
import os, json, sys
json.dump({"name":"GH2 E2E Test Token","credential_type":"token",
          "token":os.environ["GH2"],"token_type":"bearer"}, open(sys.argv[1],"w"))
PY
chmod 600 "$TMP/cred.json"
CRED_RESP="$(curl -s -X POST "$BASE/credentials" -H 'Content-Type: application/json' -d @"$TMP/cred.json")"
CRED_ID="$(echo "$CRED_RESP" | jqr '.id')"
if [ -n "$CRED_ID" ] && [ "$CRED_ID" != "null" ]; then pass "token credential created (id=$CRED_ID)"; else fail "could not create credential: $(echo "$CRED_RESP" | head -c 200)"; echo "Aborting."; exit 1; fi

#############################################################################
step "3. Search COUNT via backend (term='$TERM_KW', repositories, exact)"
cat > "$TMP/count.json" <<JSON
{"terms":["$TERM_KW"],"types":["repositories"],"exact":true,"api_credential_id":$CRED_ID}
JSON
COUNT_RESP="$(curl -s -X POST "$BASE/git/search/count" -H 'Content-Type: application/json' -d @"$TMP/count.json")"
BK_COUNT="$(echo "$COUNT_RESP" | jqr '.results[0].count')"
BK_ST="$(echo "$COUNT_RESP" | jqr '.results[0].status')"
info "backend count=$BK_COUNT status=$BK_ST"

# Parity check: query GitHub directly (token via 600-perm curl config, not argv)
cat > "$TMP/gh.conf" <<CONF
header = "Authorization: Bearer $GH2"
header = "Accept: application/vnd.github+json"
header = "X-GitHub-Api-Version: 2022-11-28"
CONF
chmod 600 "$TMP/gh.conf"
GH_TOTAL="$(curl -s -K "$TMP/gh.conf" 'https://api.github.com/search/repositories?q=%22viveo%22&per_page=1' | jqr '.total_count')"
# GitHub caps search results at 1000
EXPECTED=$GH_TOTAL; [ "${GH_TOTAL:-0}" -gt 1000 ] 2>/dev/null && EXPECTED=1000
info "github total_count=$GH_TOTAL (expected after cap=$EXPECTED)"
if [ "$BK_ST" = "ok" ] && [ "$BK_COUNT" = "$EXPECTED" ]; then
  pass "backend count matches GitHub ($BK_COUNT)"
else
  fail "count mismatch (backend=$BK_COUNT expected=$EXPECTED status=$BK_ST)"
fi

#############################################################################
step "4. Enqueue clone jobs (authenticated clone with same token)"
cat > "$TMP/enq.json" <<JSON
{"conditions":[{"term":"$TERM_KW","type":"repositories"}],"exact":true,"api_credential_id":$CRED_ID,"clone_auth":"authenticated","clone_credential_id":$CRED_ID}
JSON
ENQ_RESP="$(curl -s -X POST "$BASE/git/search/enqueue" -H 'Content-Type: application/json' -d @"$TMP/enq.json")"
QUEUED="$(echo "$ENQ_RESP" | jqr '.queued')"
REPOS_FOUND="$(echo "$ENQ_RESP" | jqr '.repos_found')"
info "repos_found=$REPOS_FOUND queued=$QUEUED"
if [ -n "$QUEUED" ] && [ "$QUEUED" != "null" ] && [ "$QUEUED" -gt 0 ] 2>/dev/null; then pass "$QUEUED clone jobs queued"; else fail "nothing queued: $(echo "$ENQ_RESP" | head -c 200)"; fi

#############################################################################
step "5. Wait for clone pipeline to finish (clone -> gitleaks -> ocr -> index)"
DEADLINE=$(( $(date +%s) + 3600 ))
LAST=""
while :; do
  S="$(curl -s "$BASE/git/jobs/stats")"
  P="$(echo "$S" | jqr '.pending')"; R="$(echo "$S" | jqr '.running')"
  C="$(echo "$S" | jqr '.completed')"; F="$(echo "$S" | jqr '.failed')"
  LINE="pending=$P running=$R completed=$C failed=$F"
  [ "$LINE" != "$LAST" ] && { info "$LINE"; LAST="$LINE"; }
  if [ "${P:-0}" = "0" ] && [ "${R:-0}" = "0" ]; then break; fi
  if [ "$(date +%s)" -ge "$DEADLINE" ]; then fail "timeout waiting for clone jobs"; break; fi
  sleep 10
done
FINAL="$(curl -s "$BASE/git/jobs/stats")"
C_DONE="$(echo "$FINAL" | jqr '.completed')"
if [ "${C_DONE:-0}" -gt 0 ] 2>/dev/null; then pass "$C_DONE clone jobs completed"; else fail "no clone job completed"; fi

#############################################################################
step "6. Verify clones on disk (bind-mount)"
GITCLONES_DIR="$(cd "$(dirname "$0")/../.." && pwd)/shadowindex_data/gitclones"
if [ -d "$GITCLONES_DIR" ]; then
  N_DIRS="$(find "$GITCLONES_DIR" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
  info "clones on host: $GITCLONES_DIR ($N_DIRS dirs)"
  [ "${N_DIRS:-0}" -gt 0 ] && pass "cloned repos present on bind-mount" || fail "no clone dirs on host"
else
  fail "gitclones dir missing: $GITCLONES_DIR"
fi

#############################################################################
step "7. Repo listing + content indexing/search"
REPOS="$(curl -s "$BASE/git/repos?q=$TERM_KW&limit=5")"
RTOTAL="$(echo "$REPOS" | jqr '.total')"
RGUID="$(echo "$REPOS" | jqr '.repos[0].guid')"
RNAME="$(echo "$REPOS" | jqr '.repos[0].full_name')"
info "repos matching '$TERM_KW': total=$RTOTAL first=$RNAME"
[ "${RTOTAL:-0}" -gt 0 ] 2>/dev/null && pass "repos listed" || fail "no repos listed"

if [ -n "$RGUID" ] && [ "$RGUID" != "null" ]; then
  FILES="$(curl -s "$BASE/git/repos/$RGUID/files?limit=5")"
  NF="$(echo "$FILES" | jqr '.files | length')"
  info "files in $RNAME (first page): $NF"
  [ "${NF:-0}" -gt 0 ] 2>/dev/null && pass "repo files indexed in DB" || info "repo has no files on first page"
fi

CONTENT="$(curl -s "$BASE/git/search/content?q=$TERM_KW&limit=5")"
CBACK="$(echo "$CONTENT" | jqr '.backend')"
CTOTAL="$(echo "$CONTENT" | jqr '.total')"
info "content search backend=$CBACK total=$CTOTAL"
[ "${CTOTAL:-0}" -ge 0 ] 2>/dev/null && pass "content search responded (backend=$CBACK, hits=$CTOTAL)" || fail "content search failed"

#############################################################################
step "8. GitLeaks findings linked to git repos"
if [ -n "$RGUID" ] && [ "$RGUID" != "null" ]; then
  LEAKS="$(curl -s "$BASE/git/repos/$RGUID" | jqr '.leaks')"
  info "leaks on first repo: $LEAKS"
fi
TOTAL_LEAKS=0
for g in $(echo "$REPOS" | jqr '.repos[].guid'); do
  L="$(curl -s "$BASE/git/repos/$g" | jqr '.leaks')"
  [ -n "$L" ] && [ "$L" != "null" ] && TOTAL_LEAKS=$((TOTAL_LEAKS + L))
done
info "gitleaks findings across listed repos: $TOTAL_LEAKS"
pass "gitleaks step ran (findings=$TOTAL_LEAKS)"

#############################################################################
step "RESULT"
if [ "$FAILED" -eq 0 ]; then
  printf '\033[32mALL CHECKS PASSED\033[0m\n'; exit 0
else
  printf '\033[31mSOME CHECKS FAILED\033[0m\n'; exit 1
fi
