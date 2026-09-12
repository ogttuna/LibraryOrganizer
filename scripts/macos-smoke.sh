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
xcrun swiftc scripts/macos-smoke.swift -o "$RUNNER_TEMP/folio-window-smoke"
"$folio_root/src-tauri/target/$folio_target/release/bundle/macos/Folio.app/Contents/MacOS/folio" > "$folio_output/native-start.log" 2>&1 &
folio_pid=$!
cleanup() { kill "$folio_pid" >/dev/null 2>&1 || true; wait "$folio_pid" 2>/dev/null || true; }
trap cleanup EXIT
"$RUNNER_TEMP/folio-window-smoke" "$folio_pid" "$folio_output/native-window.json"
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
# Screenshot support depends on the runner's window-server permission. Record failure without faking an image.
if ! screencapture -x -l "$folio_window" "$folio_output/native-window.png"; then
  echo 'Runner screenshot permission unavailable; native-window.json contains the observed window bounds.' > "$folio_output/screenshot-unavailable.txt"
fi
