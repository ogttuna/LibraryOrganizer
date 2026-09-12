# Uygulama ve doğrulama durumu

12 Eylül 2026 · Folio 0.2.1

## 0.2.1 — PDF sığdırma ve not düzenleme

Radix portalı henüz PDF alanını oluşturmadan çalışan tek seferlik ölçüm kaldırıldı. Okuyucu gerçek alanın genişlik/yüksekliğini ve CSS iç boşluklarını ölçer; Sayfaya sığdır, Genişliğe sığdır ve yüzde seçimi sunar. Yakınlaştırma mevcut fit ölçeğinden başlar; not paneli ve pencere değişince yeniden hesaplanır. Sayfa değişiminde kaydırma sıfırlanır. Hatalı render sonrasında sayfa değiştirme, geciken sayfa yanıtı ve parola/tekrar deneme durumları düzeltildi.

Kaynak ayrıntıları ve PDF okuyucu ortak not düzenleyicisini kullanır. Otomatik kayıt açıklaması, Ctrl/⌘+S / Kaydet, sözcük sayısı ve hata/yeniden deneme tutarlıdır. PDF sayfa başlığı imlece eklenirken seçili notlar silinmez. Açıklama ve özet ayrı kalır.

Gerçek optimize Linux/WebKit testinde 11 akış geçti: eski genişliğe sığdır 1328 px alanın yalnızca 736 px'ini kullanıyordu; yeni sürüm 1328/1328 px kullanıyor. Sayfaya sığdır 747 px yüksekliğe taşmadan uydu. Dikey/yatay sayfa, not paneli, 1024×760 pencere, hızlı zoom/sayfa değişimi, okuyucuyu hemen kapatırken not kaydı ve yeniden açma doğrulandı. Testler ayrı Xvfb/DBus/SQLite ortamında yapıldı; kullanıcının açık uygulamasına veya arşivine dokunulmadı.

57 React/TypeScript testi (8 okuyucu, 6 ortak not regresyonu dahil), üretim derlemesi ve biçim kontrolleri geçti. Not düzenleme 1440×960, 900×720 ve 390×844 önizlemelerde incelendi; klavyeyle kaydetme, kayıt değişimi ve yeniden yükleme sonrası kalıcılık geçti.

Kanıt: `output/reader-fit-smoke/report.json`; tekrar: `scripts/smoke-reader-fit.py`. Bu sürüm veritabanı şemasını değiştirmez.

Linux 0.2.1 paketi: `output/release/linux-x64/Folio_0.2.1_amd64.deb`; SHA-256 `d73e0fd0b4ffabc7376f66e50feabe41214891d4d30552fcf5bea76ade15d288`.

## 0.2.0 temel sürümünün doğrulama kaydı

## Tamamlanan kapsam

Yerel Tauri/SQLite/FTS5 kütüphane, yönetilen çoklu dosya, mükerrer kontrolü, import toparlama, ayrı açıklama/özet/not alanları, okunma/favori, çoklu/hiyerarşik kategori, etiketler, tümü/herhangi biri filtreleri, toplu işlemler, PDF okuyucu, son sayfa, çöp/geri getirme, kalıcı çöp, yedek dışa aktarma ve doğrulanmış geri yükleme uygulanmıştır.

Bu turda kategori/etiket yönetimi, yerinde oluşturma, uzun metin düzenleme, filtre temizleme, Türkçe sıralama, panel boyutlandırma, yan panel daraltma, kaydırma konumu ve aktarımda sıradakileri durdurma/tekrar deneme tamamlandı. Mac Quit/pencere kapatma aynı çıkış engelini kullanır; notlar, PDF konumu ve açık veritabanı yazmaları beklenir. Bu sırada yeni kullanıcı işlemleri durdurulur.

Yedek geri yükleme mevcut kütüphaneyi ayrı bir klasörde korur. ZIP yolları/tekrarlanan girdiler/boyut/CRC/SHA-256/şema/migration/ilişkiler doğrulanır. Açılışta yarım kalan dosya silme ve geri yükleme günlükleri toparlanır.

Uygulama verisi bilgisayarda kalır. GitHub deposu yalnızca kaynak kod ve isteğe bağlı derleme işlerini içerir; kullanıcı arşivi ve test çıktıları Git'e alınmaz.

## Doğrulananlar

Yerel ortam: Ubuntu 24.04.4, Node 24.21.0, Rust 1.95.0, GTK 3.24.41, WebKitGTK 2.52.6.

| Kontrol                              | Sonuç                                                                                                                                                                |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rust çekirdek                        | 30 test geçti; ignored olan ek test yalnızca süreç testi tarafından çağrılan alt süreç işçisidir                                                                     |
| React / TypeScript davranış testleri | 43 test geçti                                                                                                                                                        |
| TypeScript/Vite üretim derlemesi     | Geçti                                                                                                                                                                |
| Masaüstü dahil Clippy                | Geçti                                                                                                                                                                |
| Linux gerçek Tauri/WebKit            | Optimize release ikilisinde IPC, SQLite, import/mükerrerlik, Türkçe FTS, not, PDF, yedek doğrulama/iptal ve yeniden açılış geçti                                     |
| Sınıflandırma arayüzü                | Global etiket yeniden adlandırma/silme, kategori taşıma/silme, alt kategoriyi koruma, filtre ve yerinde oluşturma geçti                                              |
| Uzun metin                           | 220 satır Türkçe/Japonca/Arapça/emoji not, ayrı açıklama/özet/yıl, hızlı kayıt değiştirme ve sayfa yenileme geçti                                                    |
| Kapanış yarışları                    | Birim testleri ve native Quit geçti; son tuş + Quit aynı JS işinde gönderildi, SQLite kaydı ve gerçek pencere kapanışı doğrulandı                                    |
| Gerçek kesinti                       | 100 dosyanın ortasında child süreç öldürüldü; 49 tamamlanan dosya hash'i korundu, toparlama ve 100'e tamamlama geçti                                                 |
| Hatalı dosya erişimi                 | Kopya sırasında kaynak değişimi ve izin reddi; sonra tekrar ekleme geçti                                                                                             |
| JPEG2000 PDF                         | Gerçek JPX görüntüsü native WebKit'te üretim CSP ile çizildi; fetch değiştirilmeden son kontrol 0,33 sn                                                              |
| Sentetik 200 MiB PDF                 | Son temiz kontrol ilk sayfa 0,65 sn (önceden 25,09 sn). Ayrı range ölçümünde 266.517 bayt okundu. Sentetik kullanılmayan akış; gerçek taranmış kitap ölçümü değildir |
| 10.000 kayıt                         | Gerçek SQL/FTS sorguları ve IPC JSON ölçüldü; [performans raporu](PERFORMANCE.md)                                                                                    |
| macOS dağıtım tanımı                 | M1/Intel/universal hedefleri, imza doğrulama, DMG ve SHA-256 üretimi; Actions ve shell kontrolleri geçti                                                             |

Mac Apple Silicon: [Actions çalışması](https://github.com/ogttuna/LibraryOrganizer/actions/runs/34697742088) kaynak `78c975aa23bd5181f562ebc49d7be3773e1d3c70` üzerinden ARM64 release uygulama ve DMG üretti. Native pencere, boş SQLite başlatma/migration/integrity, codesign ve DMG kontrolleri geçti. Kullanıcının fiziksel M1 cihazındaki PDF/EPUB ve günlük kullanım kabulü ayrıca bekliyor.

Native Linux etkileşim testleri ölçekli Wayland oturumundaki WebDriver pointer sınırlaması nedeniyle DOM click/input olayları gönderir. Dosya erişimi, SQLite, IPC, asset protokolü ve PDF render gerçektir. İşletim sistemi dosya seçici/sürükle bırak tıklamalarının kabulü sayılmaz. Testler ayrı veri dizininde yapılır.

Mac paketi: `Folio_0.2.0_aarch64.dmg`, 8.370.211 bayt, minimum macOS 15.0. Derleme ortamı macOS 15.7.9 / arm64; SHA-256 `d4dd2707c65b03d78def30d1b67809ead529968e82e0d86f7e95f6595643175f`. Pencere, CI ekranına 1024×681 olarak sığdı; gerçek Folio arayüzü görüntüsü incelendi. Yerel teslim: `output/release/macos-m1/`; Linux: `output/release/linux-x64/`.

Linux optimize DEB: `Folio_0.2.0_amd64.deb`, SHA-256 `b46a0331b343dc0662696c2aa2dd9396707f54c5b9f2f65b968341941446086d`.

Native PDF kabulü tek aktif test penceresinde çalıştırıldı. Aynı uygulamanın farklı sürücülerle eşzamanlı açıldığı testlerde render beklemesi görüldü; izole tekrarlar geçti. Nedeni kesinleştirilmedi; bu denemeler başarılı performans sonucu sayılmaz.

## Açık sınırlar

- macOS M1'de kullanıcının gerçek dosyalarıyla kurulum, sürükle bırak, PDF ve EPUB dış uygulama kabulü; Windows11 ve Intel Mac donanım kabulü.
- Paket kişisel kullanım için ad-hoc imzalıdır; Developer ID/notarization ayrı kimlik bilgileriyle desteklenir.
- 10.000 kayıt ölçümünde geniş FTS p95 227,82 ms; tüm sorguların 150 ms altında olduğu iddia edilmez. Aynı makinede başka süreçler çalışıyordu.
- Liste 100 kayıtlık sayfalar kullanır; sınırsız DOM satırı veya 10.000 satırı birlikte çizme yok. Sanallaştırma eklenmedi.
- Süreç zorla öldürüldüğünde henüz kaydedilmemiş tuş vuruşlarının korunma garantisi yoktur.
- Kesintili geri yüklemenin geçici kopyası dışarıdan bozulmuşsa önceki kütüphane geri alınır; ilk açılış hata verebilir, sonraki açılış sağlıklı önceki arşivi açar.
- PDF içeriği indeksi, OCR, PDF anotasyonu ve gömülü EPUB okuyucusu başlangıçta tanımlandığı üzere kapsam dışıdır.

Kanıtlar: `output/native-smoke/`, `output/playwright/`, `output/pdf-fixtures/`, `output/benchmarks/`. Bunlar yerel çalışma çıktılarıdır; depoya kullanıcı verisi eklenmez.
