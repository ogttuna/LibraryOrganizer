#!/usr/bin/env bash
# Only disposable CI runners: initializes a new archive, never touches a user's Mac archive.
set -euo pipefail
[[ "$(uname -s)" == Darwin && "${GITHUB_ACTIONS:-}" == true ]] || { echo 'Bu smoke yalnızca geçici macOS CI runner içindir.' >&2; exit 1; }
folio_target="${1:?macOS target gerekli}"
case "$folio_target" in aarch64-apple-darwin|x86_64-apple-darwin) ;; *) exit 2 ;; esac
folio_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$folio_root"
folio_output="$folio_root/output/macos/$folio_target"
folio_library="$HOME/Library/Application Support/com.tuna.folio/library"
[[ ! -e "$folio_library" ]] || { echo 'Mevcut kütüphaneye smoke testi uygulanmaz.' >&2; exit 1; }
mkdir -p "$folio_output"
if [[ -n "${FOLIO_SMOKE_DMG:-}" ]]; then
  folio_dmg="$FOLIO_SMOKE_DMG"
else
  shopt -s nullglob
  folio_dmgs=("$folio_root/src-tauri/target/$folio_target/release/bundle/dmg/"*.dmg)
  [[ ${#folio_dmgs[@]} -eq 1 ]] || { echo 'Kurulum testi için bir adet DMG bekleniyor.' >&2; exit 1; }
  folio_dmg="${folio_dmgs[0]}"
fi
[[ -f "$folio_dmg" && "$folio_dmg" == *.dmg ]] || { echo 'Kurulum testi DMG dosyası bulunamadı.' >&2; exit 1; }
folio_work="$(mktemp -d "$RUNNER_TEMP/folio-installed-smoke.XXXXXX")"
folio_smoke="$folio_work/folio-window-smoke"
folio_mount="$folio_work/mounted-dmg"
folio_installed_app="$folio_work/Applications/Folio.app"
folio_installed_binary=''
folio_mounted=false
mkdir -p "$folio_mount" "$folio_work/Applications"
xcrun swiftc scripts/macos-smoke.swift -o "$folio_smoke"
cleanup() {
  # LaunchServices owns the child process. Match its exact installed executable,
  # never a bundle identifier or a process name that could select another app.
  if [[ -n "$folio_installed_binary" ]]; then
    local folio_owned_pid
    folio_owned_pid="$("$folio_smoke" --find-process "$folio_installed_binary" --once 2>/dev/null)" || folio_owned_pid=''
    if [[ -n "$folio_owned_pid" ]]; then kill "$folio_owned_pid" >/dev/null 2>&1 || true; fi
  fi
  if [[ "$folio_mounted" == true ]]; then
    hdiutil detach "$folio_mount" >> "$folio_output/native-start.log" 2>&1 || true
  fi
}
trap cleanup EXIT
# Exercise the delivered installer and a copied application, not the build tree.
# Do not remove quarantine attributes or change any system security settings.
hdiutil attach "$folio_dmg" -readonly -nobrowse -mountpoint "$folio_mount" > "$folio_output/native-start.log" 2>&1
folio_mounted=true
[[ -d "$folio_mount/Folio.app" && ! -L "$folio_mount/Folio.app" ]] || { echo 'DMG içinde Folio.app bulunamadı.' >&2; exit 1; }
/usr/bin/ditto "$folio_mount/Folio.app" "$folio_installed_app"
folio_executable="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$folio_installed_app/Contents/Info.plist")"
case "$folio_executable" in ''|.|..|*/*) echo 'Geçersiz CFBundleExecutable.' >&2; exit 1 ;; esac
folio_installed_binary="$folio_installed_app/Contents/MacOS/$folio_executable"
[[ -f "$folio_installed_binary" && -x "$folio_installed_binary" && ! -L "$folio_installed_binary" ]] || { echo 'Kurulan uygulamanın çalıştırılabilir dosyası eksik veya çalıştırma izni yok.' >&2; exit 1; }
codesign --verify --deep --strict "$folio_installed_app" >> "$folio_output/native-start.log" 2>&1
hdiutil detach "$folio_mount" >> "$folio_output/native-start.log" 2>&1
folio_mounted=false
/usr/bin/open -n "$folio_installed_app" >> "$folio_output/native-start.log" 2>&1
folio_pid="$("$folio_smoke" --find-process "$folio_installed_binary")"
"$folio_smoke" "$folio_pid" "$folio_output/native-window.json"
kill -0 "$folio_pid"
python3 - "$folio_library/library.sqlite" "$folio_output/native-window.json" <<'PY'
import json, pathlib, sqlite3, sys, time
path, output = map(pathlib.Path, sys.argv[1:])
deadline = time.monotonic() + 20
while time.monotonic() < deadline:
    if path.exists():
        try:
            with sqlite3.connect(f'file:{path}?mode=ro', uri=True) as db:
                assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
                assert db.execute('SELECT count(*) FROM items').fetchone()[0] == 0
                assert db.execute('SELECT count(*) FROM _sqlx_migrations WHERE success=1').fetchone()[0] > 0
            report = json.loads(output.read_text())
            report.update({'emptyLibraryInitialized': True, 'sqliteIntegrity': 'ok', 'schemaMigrations': 'passed'})
            output.write_text(json.dumps(report, indent=2) + '\n')
            break
        except (sqlite3.Error, AssertionError):
            pass
    time.sleep(.2)
else:
    raise SystemExit('Native Folio SQLite initialization did not complete.')
PY
folio_window="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["windowId"])' "$folio_output/native-window.json")"
# A window can appear before React's first paint. Observe client content for at most 15 seconds.
folio_capture_started=$SECONDS
while true; do
  kill -0 "$folio_pid"
  if screencapture -x -l "$folio_window" "$folio_output/native-window.png" &&
    "$folio_smoke" --check-content "$folio_output/native-window.png"; then
    break
  fi
  if (( SECONDS - folio_capture_started >= 15 )); then
    echo 'Folio window remained blank or could not be captured for 15 seconds.' >&2
    exit 1
  fi
  sleep 1
done
python3 - "$folio_output/native-window.json" "$folio_dmg" "$folio_installed_app" "$folio_executable" <<'PY'
import hashlib, json, pathlib, sys
path = pathlib.Path(sys.argv[1])
dmg = pathlib.Path(sys.argv[2])
report = json.loads(path.read_text())
digest = hashlib.sha256()
with dmg.open('rb') as source:
    for chunk in iter(lambda: source.read(1024 * 1024), b''):
        digest.update(chunk)
installer_hash = digest.hexdigest()
report.update({
    'clientContentPainted': True,
    'installedFromDmg': dmg.name,
    'installedDmgSha256': installer_hash,
    'installedAppPath': sys.argv[3],
    'bundleExecutable': sys.argv[4],
    'installedExecutablePermissionVerified': True,
    'installedCodesignVerified': True,
    'dmgDetachedBeforeLaunch': True,
    'launchMethod': 'LaunchServices (/usr/bin/open -n)',
    'gatekeeperDownloadAcceptance': 'not tested: CI installer; download quarantine was neither applied nor removed',
})
path.write_text(json.dumps(report, indent=2) + '\n')
PY
