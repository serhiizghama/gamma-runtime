#!/usr/bin/env bash
# Generate self-signed TLS certificates for local HTTP/2 development.
# Usage: ./scripts/generate-certs.sh
#
# Creates certs/localhost.key and certs/localhost.cert valid for 365 days,
# covering localhost, 127.0.0.1, and the Tailscale hostname.

set -euo pipefail

CERT_DIR="$(cd "$(dirname "$0")/.." && pwd)/certs"
KEY_FILE="$CERT_DIR/localhost.key"
CERT_FILE="$CERT_DIR/localhost.cert"

if [[ -f "$KEY_FILE" && -f "$CERT_FILE" ]]; then
  echo "Certificates already exist at $CERT_DIR — skipping generation."
  echo "  Delete certs/ and re-run to regenerate."
  exit 0
fi

mkdir -p "$CERT_DIR"

openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
  -nodes -days 365 \
  -keyout "$KEY_FILE" \
  -out "$CERT_FILE" \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:0.0.0.0,DNS:sputniks-mac-mini.tailcde006.ts.net"

echo "Certificates generated:"
echo "  Key:  $KEY_FILE"
echo "  Cert: $CERT_FILE"
echo ""
echo "To trust on macOS (removes browser warnings):"
echo "  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain $CERT_FILE"
