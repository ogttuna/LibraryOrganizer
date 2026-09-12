# macOS: derleme, kurulum ve gerçek cihaz kabulü

Folio için hedef **macOS 15 ve üzeri**, Apple Silicon ve Intel. `.app` / DMG üretimi Mac üzerinde yapılır. Bu oturumun ortamı Linux'tur; henüz Mac'te üretilmiş veya çalıştırılmış bir paket yoktur. Linux sonuçları macOS kabulü olarak sayılmaz.

## MacBook M1 üzerinde kurulum

GitHub Actions tarafından üretilen Apple Silicon DMG paketini Mac'e kopyala, aç ve Folio'yu Applications / Uygulamalar klasörüne sürükle. Son kullanıcı bilgisayarında Node, Rust, Xcode veya geliştirme ortamı gerekmez. macOS 15 veya üzeri gerekir. Ad-hoc imza için ilk açılışta macOS onay isterse Sistem Ayarları → Gizlilik ve Güvenlik → Yine de Aç yolunu kullan.

## Geliştirici için yerel derleme

Proje klasörünü Mac'e kopyala. Node.js 24, Rust 1.95 ve Apple Command Line Tools kurulu olmalı. Apple araçları için bir kez `xcode-select --install` çalıştırılabilir. Derleme gereksinimleri [Tauri'nin resmi yönergesinde](https://v2.tauri.app/start/prerequisites/) bulunur.

Proje kökünde:

```bash
npm ci
bash scripts/macos-build.sh native adhoc
```

Script testleri çalıştırır, kilitli Cargo bağımlılıklarıyla release derlemesi yapar, DMG üretir, mimariyi/imzayı/disk görüntüsünü denetler. Sonuç `output/macos/<target>/` altında DMG, `SHA256SUMS` ve `build-report.json` olarak bulunur. DMG'yi açıp Folio'yu Applications klasörüne sürükle. Uygulamayı oradan aç. Node/Rust son kullanıcının bilgisayarında gerekmez.

Aynı Mac'te her iki işlemciyi içeren paket üretmek için:

```bash
bash scripts/macos-build.sh universal adhoc
```

Universal derleme iki Rust hedefini kurar. İki mimarinin pakette bulunması, her ikisinde gerçek kullanımın doğrulandığı anlamına gelmez.

`adhoc` kişisel kullanım/deneme imzasıdır; Apple Developer hesabı gerektirmez. İnternetten alınan bu tür paketlerde Gatekeeper kullanıcı onayı isteyebilir. Tauri bunu [ad-hoc imzalama belgesinde](https://v2.tauri.app/distribute/sign/macos/#ad-hoc-signing) açıklar. Sistemin güvenlik denetimlerini topluca kapatmayın. Genel dağıtım için aşağıdaki `signed` akışını kullanın.

## PDF ve WebKit uyumluluğu

Tauri macOS'ta sistem WebKit'ini kullanır. Folio, PDF.js'in yerel paketlenmiş `legacy` motorunu ve aynı sürüm worker'ını kullanır. PDF.js'in [güncel destek tablosu](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions#which-browsersenvironments-are-supported) Safari 18+ için kısmi destek bildirir ve otomatik Safari testi göstermemektedir. Bu nedenle ürün alt sınırı macOS 15 olarak ayarlandı; eski Tauri varsayılanı olan macOS 10.13 desteği iddia edilmez. PDF kabulü aşağıdaki gerçek cihaz kontrolüne bağlıdır.

## İsteğe bağlı imzalı dağıtım

Mac Keychain'de geçerli **Developer ID Application** sertifikası bulunduğunda `APPLE_SIGNING_IDENTITY` ortam değişkenini sertifikanın tam adına ayarla. Notarization için `APPLE_ID`, `APPLE_PASSWORD` (uygulamaya özel parola), `APPLE_TEAM_ID`; alternatif olarak `APPLE_API_KEY`, `APPLE_API_ISSUER`, `APPLE_API_KEY_PATH` kullanılır. Kimlik bilgilerini depoya veya terminal komut geçmişine yazma. [Tauri imza ve notarization yönergesi](https://v2.tauri.app/distribute/sign/macos/) bu değişkenleri tanımlar.

```bash
bash scripts/macos-build.sh universal signed
```

Bu mod, notarization bilgileri eksikse durur; imzasız paketi başarılı yayın gibi sunmaz. Tamamlandığında `.app` imzası, stapled ticket ve Gatekeeper değerlendirmesi doğrulanır. `--skip-stapling` kullanılmaz; internet kapalıyken kullanılacak uygulamanın ticket'ı pakette bulunmalıdır. `build-report.json` yapılan kontrolleri ve kalan GUI kabulünü ayrı belirtir.

Apple'ın dağıtım sertifikası için geliştirici hesabı gerekebilir; bu, uygulamanın çalışırken kullandığı bir sunucu hizmeti değildir. Kendi Mac'inde ad-hoc derleme için bu hesap gerekmez.

## İsteğe bağlı GitHub paket üretimi

`.github/workflows/macos-release.yml` yalnızca elle başlatılır. `architecture=apple-silicon` varsayılanıyla M1 dahil Apple Silicon DMG üretir. `intel` ve `both` seçenekleri de vardır; `macos-15` ve `macos-15-intel` runner'ları kullanılır; paketler, hash ve rapor 14 gün saklanan Actions artifact'larıdır. Public release veya web sitesi yayımlamaz. Runner mimarileri [GitHub belgelerine](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) göre açıkça seçildi.

`signing=adhoc` varsayılandır. `signing=signed` için depo secrets alanına `APPLE_CERTIFICATE` (base64 `.p12`), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` girilir. CI sertifikayı geçici keychain'e alır; işlem sonunda arama listesini eski haline döndürür, keychain ve geçici dosyaları temizler. Secret değerleri rapora/artifact'a eklenmez.

Proje deposu: [LibraryOrganizer](https://github.com/ogttuna/LibraryOrganizer). Gerçek workflow/cihaz sonuçları `STATUS.md` içinde kaydedilir. CI kullanımı isteğe bağlıdır; hesap kotası dışında derleme ücreti oluşabileceği için yerel Mac komutları yeterli bir alternatiftir. Uygulama verileri her iki yöntemde de PC'de kalır.

CI ayrıca gerçek `.app` binary'sini başlatır; ana pencerenin görünür olduğunu ve boş SQLite kütüphanesinin migration/integrity kontrolünü doğrular. Destekleniyorsa pencere görüntüsü artifact'a eklenir. Bu açılış smoke'u PDF ve kullanıcı etkileşim kabulünün yerine geçmez. CI testi yalnızca yeni geçici runner arşivinde çalışır.

## Mac'te gerçek kullanım kabulü

Testleri ayrı bir macOS kullanıcı hesabında veya boş test kütüphanesinde yap. Normal kullanıcı arşivini test için silme. Veri kökü `~/Library/Application Support/com.tuna.folio/library/` olmalıdır; Ayarlar'da görünen yolu esas al. Sonuçları tarih, macOS sürümü, işlemci, paket SHA-256 ve ekran görüntüleriyle `docs/STATUS.md` içine işle.

| Akış                                                               | Beklenen sonuç                                             | Apple Silicon | Intel    |
| ------------------------------------------------------------------ | ---------------------------------------------------------- | ------------- | -------- |
| DMG → Applications → ilk açılış                                    | Boş kütüphane; kurulum/izin hatası yok                     | Bekliyor      | Bekliyor |
| Finder'dan PDF + EPUB sürükle; dosya seçiciyi ayrıca kullan        | Dosyalar arşive kopyalanır, özgün dosya korunur            | Bekliyor      | Bekliyor |
| Boşluk/Türkçe içeren ad; farklı adla aynı dosya                    | Kayıp yol yok, mükerrer dosya çoğalmaz                     | Bekliyor      | Bekliyor |
| Üç kategori, alt kategori, çoklu etiket; bir üyeliği kaldır        | Diğer üyelikler ve dosyalar korunur                        | Bekliyor      | Bekliyor |
| Başlık/açıklama/özet/not; `ogrenme isik istanbul` araması          | Özgün Türkçe korunur; filtreler birlikte çalışır           | Bekliyor      | Bekliyor |
| Not yazdıktan hemen sonra kayıt değiştir, ⌘Q ve yeniden aç         | Son karakter dahil not kalıcıdır                           | Bekliyor      | Bekliyor |
| Pencere kırmızı düğmesi, ⌘W, Dock'tan yeniden aç                   | Bekleyen işlem kaybolmaz; uygulama erişilebilir            | Bekliyor      | Bekliyor |
| ⌘A/C/V/Z ve ⌘K/⌘N; sekme ile gezinme                               | Yerel düzenleme ve uygulama kısayolları çalışır            | Bekliyor      | Bekliyor |
| Küçük, 200 MB, şifreli ve bozuk PDF                                | Sayfa/zoom/sığdırma; doğru hata/parola; UI yanıt verir     | Bekliyor      | Bekliyor |
| PDF sayfa 2, not yaz, okuyucuyu/uygulamayı kapat-aç                | Sayfa ve kayıt notları korunur                             | Bekliyor      | Bekliyor |
| EPUB'u varsayılan uygulamada aç                                    | Doğru arşiv dosyası açılır                                 | Bekliyor      | Bekliyor |
| 100 dosya ekleme, ardından yedek; aktarım sırasında kapatmayı dene | Kopyalar tutarlı; bekleyen işlem varken kapatma engellenir | Bekliyor      | Bekliyor |
| Çöp/geri al; yedekten geri yükle; bozuk yedeği reddet              | Notlar/ilişkiler/hash'ler korunur                          | Bekliyor      | Bekliyor |
| Wi-Fi kapalı, yeniden aç ve düzenle                                | Kütüphane, PDF, arama ve otomatik kayıt çalışır            | Bekliyor      | Bekliyor |

Mac paketi GitHub'ın macOS runner'ında üretilebilir; kullanıcının Mac'ine kaynak kod veya geliştirme araçları kurulması gerekmez. Build sonucu ve indirilecek paket `STATUS.md` içinde kaydedilir.
