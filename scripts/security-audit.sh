#!/usr/bin/env bash
# Security audit script — checks for known vulnerabilities
set -euo pipefail

echo "=== CLIaaS Security Audit ==="
echo "Date: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo ""

# 1. Check npm audit
echo "--- npm/pnpm audit ---"
if command -v pnpm &>/dev/null; then
  pnpm audit --prod 2>&1 || true
elif command -v npm &>/dev/null; then
  npm audit --production 2>&1 || true
fi
echo ""

# 2. Check for .env files committed
echo "--- Checking for committed secrets ---"
if git ls-files | grep -E '^\.(env|env\.local|env\.production)$'; then
  echo "WARNING: .env files are tracked by git!"
else
  echo "OK: No .env files committed"
fi
echo ""

# 3. Check for hardcoded secrets patterns
echo "--- Scanning for hardcoded secrets ---"
PATTERNS='(password|secret|token|apikey|api_key)[\s]*[=:][\s]*["\x27][^\s"]{8,}'
if grep -rniE "$PATTERNS" src/ --include='*.ts' --include='*.tsx' --exclude-dir=node_modules 2>/dev/null | head -20; then
  echo "WARNING: Potential hardcoded secrets found (review above)"
else
  echo "OK: No obvious hardcoded secrets"
fi
echo ""

# 4. Check security headers exist in headers.ts
echo "--- Security headers check ---"
REQUIRED_HEADERS=("Content-Security-Policy" "Strict-Transport-Security" "X-Content-Type-Options" "X-Frame-Options" "Referrer-Policy" "Permissions-Policy")
for header in "${REQUIRED_HEADERS[@]}"; do
  if grep -q "$header" src/lib/security/headers.ts 2>/dev/null; then
    echo "OK: $header configured"
  else
    echo "MISSING: $header not found in headers.ts"
  fi
done
echo ""

# 5. Check rate limiting is enabled
echo "--- Rate limiting check ---"
if grep -q "checkRateLimit" src/middleware.ts 2>/dev/null; then
  echo "OK: Rate limiting enabled in middleware"
else
  echo "WARNING: Rate limiting not found in middleware"
fi
echo ""

echo "=== Audit Complete ==="
