#!/usr/bin/env bash
# CI-only temporary keychain; normal local builds use the login keychain instead.
set -euo pipefail
set +x
if [[ "$(uname -s)" != Darwin || "${GITHUB_ACTIONS:-}" != true ]]; then
  echo 'Bu yardımcı yalnızca geçici GitHub macOS runner içindir; yerelde macos-build.sh kullanın.' >&2
  exit 1
fi
for folio_name in APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD APPLE_SIGNING_IDENTITY APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID; do
  [[ -n "${!folio_name:-}" ]] || { printf 'Eksik secret: %s\n' "$folio_name" >&2; exit 1; }
done
umask 077
folio_sign_dir="$(mktemp -d "${RUNNER_TEMP:?}/folio-sign.XXXXXX")"
folio_keychain="$folio_sign_dir/build.keychain-db"
folio_keychain_password="$(openssl rand -hex 32)"
folio_restore_search=false
cleanup() {
  if [[ "$folio_restore_search" == true ]]; then
    python3 - "$folio_sign_dir/keychains.json" <<'PY'
import json, subprocess, sys
subprocess.run(['security', 'list-keychains', '-d', 'user', '-s', *json.load(open(sys.argv[1]))], check=False, stdout=subprocess.DEVNULL)
PY
  fi
  security delete-keychain "$folio_keychain" >/dev/null 2>&1 || true
  rm -rf "$folio_sign_dir"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
python3 - "$folio_sign_dir" <<'PY'
import base64, json, os, pathlib, shlex, subprocess, sys
root = pathlib.Path(sys.argv[1])
(root / 'certificate.p12').write_bytes(base64.b64decode(os.environ['APPLE_CERTIFICATE'], validate=True))
keys = shlex.split(subprocess.check_output(['security', 'list-keychains', '-d', 'user'], text=True))
(root / 'keychains.json').write_text(json.dumps(keys))
PY
security create-keychain -p "$folio_keychain_password" "$folio_keychain" >/dev/null
security unlock-keychain -p "$folio_keychain_password" "$folio_keychain"
security set-keychain-settings -lut 7200 "$folio_keychain"
security import "$folio_sign_dir/certificate.p12" -k "$folio_keychain" -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign >/dev/null
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$folio_keychain_password" "$folio_keychain" >/dev/null
folio_restore_search=true
python3 - "$folio_sign_dir/keychains.json" "$folio_keychain" <<'PY'
import json, subprocess, sys
subprocess.run(['security', 'list-keychains', '-d', 'user', '-s', sys.argv[2], *json.load(open(sys.argv[1]))], check=True)
PY
rm "$folio_sign_dir/certificate.p12"
unset APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD
folio_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bash "$folio_root/scripts/macos-build.sh" "${1:-native}" signed
