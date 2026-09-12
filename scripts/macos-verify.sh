#!/usr/bin/env bash
# Inspect the actual result; this intentionally never labels launch/UI checks as passed.
set -euo pipefail
folio_target="${1:-}"
folio_mode="${2:-adhoc}"
case "$folio_target" in aarch64-apple-darwin|x86_64-apple-darwin|universal-apple-darwin) ;; *) echo 'Geçerli macOS target gerekli.' >&2; exit 2 ;; esac
case "$folio_mode" in adhoc|signed) ;; *) echo 'Mod adhoc veya signed olmalı.' >&2; exit 2 ;; esac
[[ "$(uname -s)" == Darwin ]] || { echo 'Paket doğrulaması macOS gerektirir.' >&2; exit 1; }
folio_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$folio_root"
folio_bundle="src-tauri/target/$folio_target/release/bundle"
folio_app="$folio_bundle/macos/Folio.app"
folio_binary="$folio_app/Contents/MacOS/folio"
[[ -f "$folio_binary" ]] || { echo 'Folio.app bulunamadı.' >&2; exit 1; }
folio_minimum="$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$folio_app/Contents/Info.plist")"
[[ "$folio_minimum" == 15.0 ]] || { echo 'Minimum macOS sürümü beklenen 15.0 değil.' >&2; exit 1; }
folio_arches="$(lipo -archs "$folio_binary")"
case "$folio_target" in
  aarch64-apple-darwin) [[ "$folio_arches" == arm64 ]] ;;
  x86_64-apple-darwin) [[ "$folio_arches" == x86_64 ]] ;;
  universal-apple-darwin) [[ " $folio_arches " == *' arm64 '* && " $folio_arches " == *' x86_64 '* ]] ;;
esac
codesign --verify --deep --strict "$folio_app"
if [[ "$folio_mode" == signed ]]; then
  xcrun stapler validate "$folio_app"
  spctl --assess --type execute "$folio_app"
fi
shopt -s nullglob
folio_dmgs=("$folio_bundle"/dmg/*.dmg)
[[ ${#folio_dmgs[@]} -eq 1 ]] || { echo 'Bir adet DMG bekleniyor; eski çıktı varsa ayrı bir checkout kullanın.' >&2; exit 1; }
hdiutil verify "${folio_dmgs[0]}"
folio_output="$folio_root/output/macos/$folio_target"
mkdir -p "$folio_output"
cp "${folio_dmgs[0]}" "$folio_output/"
folio_dmg_name="$(basename "${folio_dmgs[0]}")"
(cd "$folio_output" && shasum -a 256 "$folio_dmg_name" > SHA256SUMS)
cat > "$folio_output/KURULUM.txt" <<'HELP'
Folio — Mac kurulumu (macOS 15 veya üzeri)

1. DMG dosyasını açın.
2. Folio simgesini Applications / Uygulamalar klasörüne sürükleyin.
3. Folio'yu Uygulamalar klasöründen açın. Node.js, Rust veya başka geliştirme aracı gerekmez.

macOS geliştiriciyi doğrulayamadığını bildirirse:
1. Uygulamalar klasöründe Folio'ya çift tıklayın. Uyarı çıkınca uyarıyı kapatın.
2. Ekranın sol üstündeki Apple () menüsünden Sistem Ayarları'nı açın.
3. Soldan Gizlilik ve Güvenlik bölümünü seçin; aşağı kaydırın.
4. Folio'nun engellendiği yazının yanındaki "Yine de Aç" düğmesine basın.
5. Onay penceresinde "Aç" seçeneğini seçin.

"Yine de Aç" yoksa hata mesajını ve macOS sürümünü geliştiriciye iletin.
Genel "uygulama açılamıyor" mesajı farklı nedenlerden kaynaklanabilir.

PDF/EPUB dosyalarınız ve notlarınız bilgisayarınızda saklanır.
Hesap, internet bağlantısı veya sunucu aboneliği gerekmez.
Dosyalarınızı uygulamadan ekleyin; arşivlemeden önce özgün dosyalarınızı silmeyin.
Ayarlar bölümünden düzenli .folio yedeği alabilirsiniz.

SHA256SUMS dosyası paketin özet değerini, build-report.json yapılan paket
kontrollerini gösterir. Gerçek kullanım testlerinin durumu proje STATUS.md belgesindedir.
HELP
python3 - "$folio_output" "$folio_target" "$folio_mode" "$folio_arches" "$folio_minimum" "$folio_dmg_name" <<'PY'
import datetime, hashlib, json, pathlib, platform, subprocess, sys
out, target, mode, architectures, minimum, dmg = sys.argv[1:]
root = pathlib.Path.cwd()
try:
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], stderr=subprocess.DEVNULL, text=True).strip()
    dirty = bool(subprocess.check_output(['git', 'status', '--porcelain'], text=True).strip())
except subprocess.CalledProcessError:
    revision, dirty = None, True
report = {
    'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'version': json.loads((root / 'src-tauri/tauri.conf.json').read_text())['version'],
    'gitRevision': revision, 'workingTreeModified': dirty, 'hostMacOS': platform.mac_ver()[0],
    'target': target, 'architectures': architectures.split(), 'minimumMacOS': minimum,
    'signing': mode, 'codesignVerified': True, 'dmgVerified': True,
    'notarizationAndGatekeeperVerified': mode == 'signed',
    'guiAcceptance': 'pending: complete docs/MACOS.md acceptance table on actual target hardware',
    'installer': dmg,
    'lockHashes': {p: hashlib.sha256((root / p).read_bytes()).hexdigest() for p in ['package-lock.json', 'src-tauri/Cargo.lock']},
    'tools': {name: subprocess.check_output(command, text=True).strip() for name, command in [
        ('node', ['node', '--version']), ('rust', ['rustc', '--version']), ('macOSSDK', ['xcrun', '--sdk', 'macosx', '--show-sdk-version'])
    ]},
}
(pathlib.Path(out) / 'build-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
PY
printf 'Doğrulanmış paket ve SHA-256: %s\n' "$folio_output"
echo 'Gerçek pencere/PDF/kayıt kabul testi ayrıca docs/MACOS.md üzerinden tamamlanmalı.'
