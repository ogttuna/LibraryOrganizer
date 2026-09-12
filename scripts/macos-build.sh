#!/usr/bin/env bash
# A Mac is required; no upload, hosting, updater or account is added to Folio.
set -euo pipefail

usage() {
  cat <<'HELP'
Usage: bash scripts/macos-build.sh [native|universal|aarch64-apple-darwin|x86_64-apple-darwin] [adhoc|signed]
Defaults: native adhoc. Run npm ci first. Signed mode requires Developer ID and notarization credentials.
HELP
}
if [[ "${1:-}" == --help ]]; then usage; exit 0; fi
if [[ $# -gt 2 ]]; then usage >&2; exit 2; fi
folio_target="${1:-native}"
folio_mode="${2:-adhoc}"
case "$folio_target" in native|universal|aarch64-apple-darwin|x86_64-apple-darwin) ;; *) usage >&2; exit 2 ;; esac
case "$folio_mode" in adhoc|signed) ;; *) usage >&2; exit 2 ;; esac
if [[ "$(uname -s)" != Darwin ]]; then
  echo 'macOS .app/DMG derlemesi için macOS 15+ üzerinde çalıştırın. Linux derlemesi bu kontrolün yerine geçmez.' >&2
  exit 1
fi
folio_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$folio_root"
folio_os="$(sw_vers -productVersion)"
if [[ "${folio_os%%.*}" -lt 15 ]]; then echo 'En az macOS 15 gerekli.' >&2; exit 1; fi
for folio_tool in node npm rustup cargo xcrun codesign hdiutil python3; do
  command -v "$folio_tool" >/dev/null || { echo "Eksik araç: $folio_tool" >&2; exit 1; }
done
xcrun --sdk macosx --show-sdk-path >/dev/null
if [[ ! -f node_modules/@tauri-apps/cli/package.json ]]; then
  echo 'Önce proje kökünde npm ci çalıştırın.' >&2; exit 1
fi
if [[ "$folio_target" == native ]]; then
  case "$(uname -m)" in arm64) folio_target=aarch64-apple-darwin ;; x86_64) folio_target=x86_64-apple-darwin ;; *) exit 1 ;; esac
fi
if [[ "$folio_target" == universal ]]; then folio_target=universal-apple-darwin; fi
if [[ "$folio_target" == universal-apple-darwin ]]; then
  rustup target add aarch64-apple-darwin x86_64-apple-darwin
else
  rustup target add "$folio_target"
fi
if [[ "$folio_mode" == signed ]]; then
  if [[ -z "${APPLE_SIGNING_IDENTITY:-}" || "$APPLE_SIGNING_IDENTITY" == - ]]; then
    echo 'Signed modunda APPLE_SIGNING_IDENTITY Developer ID Application sertifikasını belirtmeli.' >&2; exit 1
  fi
  if [[ -n "${APPLE_API_KEY:-}" && -n "${APPLE_API_ISSUER:-}" && -f "${APPLE_API_KEY_PATH:-}" ]]; then
    : # App Store Connect key is already in a protected file.
  elif [[ -n "${APPLE_ID:-}" && -n "${APPLE_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
    : # APPLE_PASSWORD is an app-specific password, never the account password.
  else
    echo 'Signed modunda notarization kimlik bilgileri de gerekli; docs/MACOS.md belgesine bakın.' >&2; exit 1
  fi
else
  export APPLE_SIGNING_IDENTITY=-
  unset APPLE_API_KEY APPLE_API_ISSUER APPLE_API_KEY_PATH APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID
fi
export MACOSX_DEPLOYMENT_TARGET=15.0
npm test
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --locked
npm run tauri -- build --ci --target "$folio_target" --bundles dmg -- --locked
bash scripts/macos-verify.sh "$folio_target" "$folio_mode"
