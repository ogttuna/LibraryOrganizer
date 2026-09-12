# Paketleme ve yayın kabulü

Folio yerel bir masaüstü uygulamasıdır. Çalışmak için sunucu, hesap, CDN veya otomatik güncelleme hizmeti gerektirmez. Paket üretmek kullanıcının kütüphanesini yüklemez.

## Yeniden üretilebilir kaynak ve kontroller

Paket üretmeden önce `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` sürümlerini birlikte güncelle; `package-lock.json` ve `src-tauri/Cargo.lock` dosyalarını koru. Derleme yalnızca temiz ve tanımlanmış bir kaynak revizyonundan yayın adayı olarak etiketlenir. Mac raporunda revizyon yoksa veya çalışma ağacı değişmişse bu durum açıkça kaydedilir.

```bash
npm ci
npm run build
npm test
npm run format:check
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings
```

Linux masaüstü derlemesi için Tauri/GTK/WebKit geliştirme paketleri gerekir. Windows MSVC ve WebView2 gerektirir. Çekirdek testinin geçmesi native bağımlılıkların veya pencerenin doğrulandığı anlamına gelmez.

## İşletim sistemine göre paket

| Hedef                          | Hedef sistemde komut                                     | Çıktı                                     |
| ------------------------------ | -------------------------------------------------------- | ----------------------------------------- |
| macOS 15+ / kullanılan işlemci | `bash scripts/macos-build.sh native adhoc`               | `output/macos/<target>/` DMG, hash, rapor |
| macOS 15+ / iki işlemci        | `bash scripts/macos-build.sh universal adhoc`            | `output/macos/universal-apple-darwin/`    |
| Ubuntu 24.04 x64               | `npm run tauri -- build --ci --bundles deb -- --locked`  | `src-tauri/target/release/bundle/deb/`    |
| Windows 11 x64                 | `npm run tauri -- build --ci --bundles nsis -- --locked` | `src-tauri/target/release/bundle/nsis/`   |

Mac'te genel dağıtım için `signed` modu ve [Mac yönergesi](MACOS.md) kullanılır. Windows imza sertifikası ayrıca yapılandırılmadığı sürece NSIS paketi imzasızdır. İmza veya gerçek cihaz testi yapılmadan yapılmış gibi işaretlenmez.

## Kabul kayıtları

Her hedefte **kurulan paket** üzerinden [ürün senaryolarını](ROADMAP.md) ve [test yönergesini](TESTING.md) çalıştır. Mac'e özgü menü/kısayol/WebKit/Gatekeeper kontrolleri [MACOS.md](MACOS.md) içindedir. Aynı paketle iki kez yeniden başlatma, bekleyen notla kapatma, hatalı dosya, kategori/etiket düzenleme, arama ve yedek/geri yükleme akışları bitmeden kararlı yayın kabulü verilmez.

Farklı işletim sistemleri arasında `.folio` yedek aktarımını gerçek makinede dene. Çalışan SQLite dosyasını sıradan dosya kopyasıyla dağıtma; uygulamanın yedek komutunu kullan. Güncellemede mevcut kullanıcı kütüphanesi korunmalı; eski şema migration'ı ve son notlar doğrulanmalı.

Şunları [STATUS.md](STATUS.md) içine yaz: tarih, kaynak revizyonu, OS/işlemci, uygulama sürümü, paket SHA-256, otomatik test çıktısı, gerçek kullanım sonucu ve açık hatalar. Başarılı derleme ile başarılı gerçek kullanım iki ayrı sonuçtur.

`.github/workflows/ci.yml` üç işletim sistemi için isteğe bağlı test/paket artifact'ları üretir. `.github/workflows/macos-release.yml` ayrıca Mac imza/notarization seçimi sunar. Her ikisi `workflow_dispatch` ile elle başlatılır; public release, depo yayımlama veya otomatik uzak işlem yapılmaz. Uygulama verisi artifact yoluna dahil edilmez.
