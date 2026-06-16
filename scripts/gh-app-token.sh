#!/usr/bin/env bash
#
# Mint a short-lived GitHub App installation token and print it to stdout.
#
# Used by the auto-audit cloud routine so it can act as the "Rudder Bot" GitHub
# App (the [bot] badge) instead of a human PAT. Contains NO secrets: every input
# is read from the environment, so this file is safe to commit to a public repo.
#
# Required environment variables (set as secrets in the cloud environment, never
# in the repo or a prompt):
#   RUDDER_BOT_APP_ID            the GitHub App's App ID (a number)
#   RUDDER_BOT_INSTALLATION_ID   the installation ID on rudderjs/rudder
#   RUDDER_BOT_PRIVATE_KEY_B64   base64 of the app's .pem private key
#                                (produce locally with: base64 -i path/to/key.pem)
#
# Usage in the routine:
#   export GH_TOKEN="$(scripts/gh-app-token.sh)" || exit 1
#   gh issue create ...   # now authenticated as Rudder Bot[bot]
#
# The token is scoped to the installation's permissions and expires in ~1 hour.
set -euo pipefail

: "${RUDDER_BOT_APP_ID:?RUDDER_BOT_APP_ID is not set}"
: "${RUDDER_BOT_INSTALLATION_ID:?RUDDER_BOT_INSTALLATION_ID is not set}"
: "${RUDDER_BOT_PRIVATE_KEY_B64:?RUDDER_BOT_PRIVATE_KEY_B64 is not set}"

for bin in openssl curl jq base64; do
  command -v "$bin" >/dev/null 2>&1 || { echo "gh-app-token: missing required tool '$bin'" >&2; exit 1; }
done

# Materialize the private key to a 0600 temp file; always shred it on exit.
keyfile="$(mktemp)"
chmod 600 "$keyfile"
cleanup() { rm -f "$keyfile"; }
trap cleanup EXIT
printf '%s' "$RUDDER_BOT_PRIVATE_KEY_B64" | base64 --decode > "$keyfile"

# base64url helper (RFC 7515): standard base64, +/ -> -_, strip padding.
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

now="$(date +%s)"
iat="$((now - 60))"      # backdate 60s to tolerate clock skew
exp="$((now + 540))"     # GitHub caps the JWT lifetime at 10 minutes

header="$(printf '{"alg":"RS256","typ":"JWT"}' | b64url)"
payload="$(printf '{"iat":%s,"exp":%s,"iss":"%s"}' "$iat" "$exp" "$RUDDER_BOT_APP_ID" | b64url)"
unsigned="${header}.${payload}"
signature="$(printf '%s' "$unsigned" | openssl dgst -sha256 -sign "$keyfile" -binary | b64url)"
jwt="${unsigned}.${signature}"

response="$(curl -fsS -X POST \
  -H "Authorization: Bearer ${jwt}" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/app/installations/${RUDDER_BOT_INSTALLATION_ID}/access_tokens")"

token="$(printf '%s' "$response" | jq -r '.token // empty')"
if [ -z "$token" ]; then
  echo "gh-app-token: failed to obtain installation token. Response:" >&2
  printf '%s\n' "$response" >&2
  exit 1
fi

printf '%s' "$token"
