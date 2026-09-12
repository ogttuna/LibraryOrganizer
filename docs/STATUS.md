# Uygulama ve doğrulama durumu

12 Eylül 2026 · Folio 0.2.0

## Tamamlanan kapsam

Yerel Tauri/SQLite/FTS5 kütüphane, yönetilen çoklu dosya, mükerrer kontrolü, import toparlama, ayrı açıklama/özet/not alanları, okunma/favori, çoklu/hiyerarşik kategori, etiketler, tümü/herhangi biri filtreleri, toplu işlemler, PDF okuyucu, son sayfa, çöp/geri getirme, kalıcı çöp, yedek dışa aktarma ve doğrulanmış geri yükleme uygulanmıştır.

Bu turda kategori/etiket yönetimi, yerinde oluşturma, uzun metin düzenleme, filtre temizleme, Türkçe sıralama, panel boyutlandırma, yan panel daraltma, kaydırma konumu ve aktarımda sıradakileri durdurma/tekrar deneme tamamlandı. Mac Quit/pencere kapatma aynı çıkış engelini kullanır; notlar, PDF konumu ve açık veritabanı yazmaları beklenir. Bu sırada yeni kullanıcı işlemleri durdurulur.

Yedek geri yükleme mevcut kütüphaneyi ayrı bir klasörde korur. ZIP yolları/tekrarlanan girdiler/boyut/CRC/SHA-256/şema/migration/ilişkiler doğrulanır. Açılışta yarım kalan dosya silme ve geri yükleme günlükleri toparlanır.

Uygulama verisi bilgisayarda kalır. GitHub deposu yalnızca kaynak kod ve isteğe bağlı derleme işlerini içerir; kullanıcı arşivi ve test çıktıları Git'e alınmaz.

## Doğrulananlar

Yerel ortam: Ubuntu 24.04.4, Node 24.21.0, Rust 1.95.0, GTK 3.24.41, WebKitGTK 2.52.6.

| Kontrol                              | Sonuç                                                                                                                                     |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Rust çekirdek                        | 30 test geçti; ignored olan ek test yalnızca süreç testi tarafından çağrılan alt süreç işçisidir                                          |
| React / TypeScript davranış testleri | 43 test geçti                                                                                                                             |
| TypeScript/Vite üretim derlemesi     | Geçti                                                                                                                                     |
| Masaüstü dahil Clippy                | Geçti                                                                                                                                     |
| Linux gerçek Tauri/WebKit            | IPC, SQLite, import/mükerrerlik, Türkçe FTS, not otomatik kayıt, PDF sayfaları ve yeniden açılış geçti                                    |
| Sınıflandırma arayüzü                | Global etiket yeniden adlandırma/silme, kategori taşıma/silme, alt kategoriyi koruma, filtre ve yerinde oluşturma geçti                   |
| Uzun metin                           | 220 satır Türkçe/Japonca/Arapça/emoji not, ayrı açıklama/özet/yıl, hızlı kayıt değiştirme ve sayfa yenileme geçti                         |
| Kapanış yarışları                    | Yeni taslaklar, hızlı sayfa değişimi, eşzamanlı Quit, yazma hatası/tekrar ve açık işlemleri bekleme testleri geçti                        |
| Gerçek kesinti                       | 100 dosyanın ortasında child süreç öldürüldü; 49 tamamlanan dosya hash'i korundu, toparlama ve 100'e tamamlama geçti                      |
| Hatalı dosya erişimi                 | Kopya sırasında kaynak değişimi ve izin reddi; sonra tekrar ekleme geçti                                                                  |
| JPEG2000 PDF                         | Gerçek JPX görüntüsü native WebKit'te üretim CSP ile çizildi; ilk sayfa 1,01 sn                                                           |
| Sentetik 200 MiB PDF                 | İlk sayfa 25,09 → 0,86 sn; iki range isteğiyle 266.517 bayt okundu. Büyük kullanılmayan akış içerir; gerçek taranmış kitap testi değildir |
| 10.000 kayıt                         | Gerçek SQL/FTS sorguları ve IPC JSON ölçüldü; [performans raporu](PERFORMANCE.md)                                                         |
| macOS dağıtım tanımı                 | M1/Intel/universal hedefleri, imza doğrulama, DMG ve SHA-256 üretimi; Actions ve shell kontrolleri geçti                                  |

Mac derlemesi ve gerçek Mac açılışının sonucu, ilgili GitHub Actions çalışması tamamlanınca bu dosyaya eklenir. Yalnızca workflow tanımı bu kontrolün geçtiği anlamına gelmez.

Native Linux etkileşim testleri ölçekli Wayland oturumundaki WebDriver pointer sınırlaması nedeniyle DOM click/input olayları gönderir. Dosya erişimi, SQLite, IPC, asset protokolü ve PDF render gerçektir. İşletim sistemi dosya seçici/sürükle bırak tıklamalarının kabulü sayılmaz. Testler ayrı veri dizininde yapılır.

## Açık sınırlar

- macOS M1'de kullanıcının gerçek dosyalarıyla kurulum, sürükle bırak, PDF ve EPUB dış uygulama kabulü; Windows11 ve Intel Mac donanım kabulü.
- Paket kişisel kullanım için ad-hoc imzalıdır; Developer ID/notarization ayrı kimlik bilgileriyle desteklenir.
- 10.000 kayıt ölçümünde geniş FTS p95 227,82 ms; tüm sorguların 150 ms altında olduğu iddia edilmez. Aynı makinede başka süreçler çalışıyordu.
- Liste 100 kayıtlık sayfalar kullanır; sınırsız DOM satırı veya 10.000 satırı birlikte çizme yok. Sanallaştırma eklenmedi.
- Süreç zorla öldürüldüğünde henüz kaydedilmemiş tuş vuruşlarının korunma garantisi yoktur.
- Kesintili geri yüklemenin geçici kopyası dışarıdan bozulmuşsa önceki kütüphane geri alınır; ilk açılış hata verebilir, sonraki açılış sağlıklı önceki arşivi açar.
- PDF içeriği indeksi, OCR, PDF anotasyonu ve gömülü EPUB okuyucusu başlangıçta tanımlandığı üzere kapsam dışıdır.

Kanıtlar: `output/native-smoke/`, `output/playwright/`, `output/pdf-fixtures/`, `output/benchmarks/`. Bunlar yerel çalışma çıktılarıdır; depoya kullanıcı verisi eklenmez.
