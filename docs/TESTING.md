# Doğrulama yönergesi

## Hızlı kontroller

`npm test`: 43 davranış kontrolü; kapatırken bekleyen yazmaları boşaltma, hata ekranından kurtarma, PDF range yanıt/boyut doğrulama ve iptal, geri yükleme onayı ve otomatik kaydetmenin birleştirilmesi, devam eden kayıtta yeni yazının korunması, başarısız kayıtta taslağın korunması, Türkçe önizleme araması ve filtre semantiği.

`npm run test:core`: gerçek SQLite ve geçici klasörlerle import, SHA-256 mükerrerliği, çoklu dosya, yeniden açılma, çoklu kategori ve toplu ekleme, kategori döngüsü, transaction geri alma, Türkçe FTS5, etiket AND/OR, kategori yeniden adlandırma, çöp/geri getirme, null yıl, başarısız import temizliği, başlangıç toparlaması, dosya yolu kapsamı ve yedek taşınabilirliği.

`npm run check:rust`, `npm run build`, `npm run format:check` ve `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` statik kontrollerdir.

## Linux native smoke

GUI oturumu, `tauri-driver` ve `WebKitWebDriver` gerekir. Uygulamayı paketlenmiş varlıklarla derle:

```sh
npm run tauri -- build --debug --no-bundle
```

Bir terminalde sürücüyü **ayrı veri diziniyle** başlat:

```sh
XDG_DATA_HOME="$PWD/output/native-smoke/data" \
XDG_CACHE_HOME="$PWD/output/native-smoke/cache" \
tauri-driver --port 4445 --native-port 4446
```

Başka terminalde:

```sh
python3 scripts/smoke-desktop.py
```

Script `get_library_path` sonucunun proje içindeki `output/native-smoke` altında olduğunu doğrulamadan veri değiştirmez. Kendi iki sayfalık PDF'sini oluşturur, gerçek IPC üzerinden ekler, WebKit'te not yazar, PDF render eder, konumu ve yedeği doğrular, uygulamayı yeniden açar. Yedeği geçici alanda doğrulatıp geri yüklemeyi iptal eder; son not karakterlerinden hemen sonra native Quit köprüsünü çağırır ve kapanışta SQLite kaydını doğrular.

Bu ortamın ölçekli Wayland oturumunda WebKitWebDriver pointer/clear işlemleri güvenilir davranmadığından script native WebView içinde DOM click/input olayları kullanır. SQLite, IPC, dosya erişimi, asset protokolü ve PDF render gerçektir. Bu test, işletim sistemi dosya seçici/sürükle bırak etkileşiminin manuel kabul testinin yerine geçmez.

## Arayüz kontrolleri

Tarayıcı önizlemesi gerçek IndexedDB ve dosya Blob'ları kullanır. Playwright ile not yazarken anında başka kaynağa geçme, tekrar geri dönme, normalize edilmiş arama, okuma filtresi, PDF dosyası ekleme ve görüntüleme kontrol edilir. Ekranlar masaüstü ve dar pencere boyutunda incelenir. Dış internet istekleri beklenmez; Vite HMR yalnızca geliştirmede yerel WebSocket kullanır.

Masaüstü çapraz platform ve yüksek hacim kabul kapıları `ROADMAP.md` içinde ayrıca bulunur.
