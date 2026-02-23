#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-https://cliaas.com}"
# Strip trailing slash
BASE_URL="${BASE_URL%/}"

PASS=0
FAIL=0
TOTAL=0

# Colors (disabled if not a terminal)
if [[ -t 1 ]]; then
  GREEN="\033[0;32m"
  RED="\033[0;31m"
  YELLOW="\033[0;33m"
  RESET="\033[0m"
else
  GREEN=""
  RED=""
  YELLOW=""
  RESET=""
fi

check() {
  local description="$1"
  local result="$2"  # 0 = pass, non-zero = fail
  TOTAL=$((TOTAL + 1))
  if [[ "$result" -eq 0 ]]; then
    PASS=$((PASS + 1))
    echo -e "  ${GREEN}PASS${RESET}  $description"
  else
    FAIL=$((FAIL + 1))
    echo -e "  ${RED}FAIL${RESET}  $description"
  fi
}

echo "=== CLIaaS Smoke Test ==="
echo "Target: $BASE_URL"
echo ""

# ── Health endpoint ──────────────────────────────────────────────────────

echo "-- Health endpoint --"

HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$BASE_URL/api/health" 2>/dev/null || echo "000")
check "GET /api/health returns 200" "$([ "$HEALTH_STATUS" = "200" ] && echo 0 || echo 1)"

# ── Homepage ─────────────────────────────────────────────────────────────

echo "-- Homepage --"

HOME_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$BASE_URL/" 2>/dev/null || echo "000")
check "GET / returns 200" "$([ "$HOME_STATUS" = "200" ] && echo 0 || echo 1)"

# ── 404 handling ─────────────────────────────────────────────────────────

echo "-- 404 handling --"

NOT_FOUND_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$BASE_URL/nonexistent-page-that-should-not-exist" 2>/dev/null || echo "000")
check "GET /nonexistent returns 404" "$([ "$NOT_FOUND_STATUS" = "404" ] && echo 0 || echo 1)"

# ── Security headers ────────────────────────────────────────────────────

echo "-- Security headers --"

HEADERS=$(curl -s -D - -o /dev/null --max-time 10 "$BASE_URL/api/health" 2>/dev/null || echo "")

# X-Frame-Options
echo "$HEADERS" | grep -qi "x-frame-options"
check "X-Frame-Options header present" "$?"

# Content-Security-Policy
echo "$HEADERS" | grep -qi "content-security-policy"
check "Content-Security-Policy header present" "$?"

# Strict-Transport-Security
echo "$HEADERS" | grep -qi "strict-transport-security"
check "Strict-Transport-Security (HSTS) header present" "$?"

# X-Content-Type-Options
echo "$HEADERS" | grep -qi "x-content-type-options"
check "X-Content-Type-Options header present" "$?"

# X-XSS-Protection
echo "$HEADERS" | grep -qi "x-xss-protection"
check "X-XSS-Protection header present" "$?"

# Referrer-Policy
echo "$HEADERS" | grep -qi "referrer-policy"
check "Referrer-Policy header present" "$?"

# Permissions-Policy
echo "$HEADERS" | grep -qi "permissions-policy"
check "Permissions-Policy header present" "$?"

# ── Rate limit headers on API responses ──────────────────────────────────

echo "-- Rate limit headers --"

API_HEADERS=$(curl -s -D - -o /dev/null --max-time 10 "$BASE_URL/api/health" 2>/dev/null || echo "")

echo "$API_HEADERS" | grep -qi "x-ratelimit-limit"
check "X-RateLimit-Limit header present on API response" "$?"

echo "$API_HEADERS" | grep -qi "x-ratelimit-remaining"
check "X-RateLimit-Remaining header present on API response" "$?"

echo "$API_HEADERS" | grep -qi "x-ratelimit-reset"
check "X-RateLimit-Reset header present on API response" "$?"

# ── Summary ──────────────────────────────────────────────────────────────

echo ""
echo "=== Results: ${PASS}/${TOTAL} passed, ${FAIL} failed ==="

if [[ "$FAIL" -gt 0 ]]; then
  echo -e "${RED}Smoke test FAILED${RESET}"
  exit 1
else
  echo -e "${GREEN}All checks passed${RESET}"
  exit 0
fi
