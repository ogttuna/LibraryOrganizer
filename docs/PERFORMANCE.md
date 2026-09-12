# Performans ve kesinti dayanıklılığı ölçümü

12 Eylül 2026. Ubuntu 24.04.4, x86_64, Intel Core i9-14900HX (32 mantıksal işlemci), Rust 1.95.0, release/optimized derleme. Ölçüm normal geliştirme makinesinde yapıldı; işletim sistemi yükü izole edilmedi. Bunlar aynı veriler için tekrarlanabilir ölçümlerdir, tüm bilgisayarlar için hız garantisi değildir.

## 10.000 kaynaklı kütüphane

```bash
cargo run --release --manifest-path src-tauri/Cargo.toml --no-default-features --example benchmark --locked
```

Fixture: 10.000 kitap/makale, her kayıtta **2.172 byte Türkçe not**, açıklama, özet, iki yazar, iki kategori, üç etiket ve bir dosyanın metadata'sı. Toplam 40 kategori (20 alt kategori), 30 etiket. PDF/EPUB biçimleri ve üç okuma durumu dağıtıldı. Türkçe özgün metinler ve üretimle aynı normalize FTS5 indeksi kullanıldı.

Fixture tek transaction içindeki toplu SQL işlemleriyle yaklaşık 1,48 saniyede hazırlanır; bu süre günlük dosya içe aktarma performansı olarak yorumlanmaz. Kaynak dosyalarının binary içeriği bu arama fixture'ında bulunmaz. Asıl dosya yaşam döngüsü aşağıdaki ayrı stress testinde doğrulanır.

Her senaryoda üç ısınma sorgusunun ardından 30 ölçüm alındı. Ölçülen sınır: **gerçek `Library::query` çağrısı + `serde_json` serialization**. Sonuç sayımı, sıralama, tam kaynak alanları ve ilişki/ek metadata yüklemesi dahildir. Sayfalar en fazla 100 kayıt döndürür; yaklaşık 330 KB JSON oluşur.

| Sorgu                                                             | Eşleşen | Önce p95 (ms) | Sonra ilk gözlem (ms) | Sonra p50 (ms) | Sonra p95 (ms) |
| ----------------------------------------------------------------- | ------: | ------------: | --------------------: | -------------: | -------------: |
| İlk 100 kayıt                                                     |   10000 |         26,12 |                 21,84 |          22,53 |          28,83 |
| Son 100 kayıt, offset 9.900                                       |   10000 |         40,75 |                 33,33 |          40,35 |          45,24 |
| Tek başlık: `kayit 04242`                                         |       1 |          2,76 |                  3,47 |           2,27 |           2,78 |
| Türkçe sadeleştirme: `isik`                                       |    1000 |         24,67 |                 36,32 |          14,02 |          16,69 |
| Tüm notlarda `orneklem`                                           |   10000 |        135,83 |                170,65 |         158,24 |         227,82 |
| Özgün dosya adı                                                   |       1 |          1,02 |                  0,88 |           0,37 |           0,68 |
| Kategori + altları + tüm etiketler + PDF + okunmadı + not araması |     167 |        161,66 |                109,99 |         111,71 |         144,29 |
| Seçilen etiketlerden herhangi biri                                |    2002 |         91,49 |                 61,02 |          50,57 |          60,31 |
| Türkçe başlık sıralaması                                          |   10000 |         41,67 |                 29,56 |          31,91 |          42,02 |

Bir optimizasyon iterasyonunda kategori/etiket filtreleri, her kayıt için tekrarlanan üyelik kontrolleri yerine reverse index kullanan tek seferlik kimlik kümelerine çevrildi. Etiketlerin “tümü/herhangi biri”, kategori altları, çöp ve diğer filtrelerin birlikte uygulanması korundu. Katalog sayıları önce gruplanıp kategori/etiket listelerine bağlandı. SQLite sayfa önbelleği bağlantı başına en fazla yaklaşık 16 MiB olacak şekilde ayarlandı; beş bağlantının bu ayardan doğan toplam üst sınırı yaklaşık 80 MiB'dir, bu uygulamanın tüm RAM kullanımı değildir.

Başlangıç hedefi sıcak aramada p95 < 150 ms idi. Karma filtre 161,66 → 144,29 ms, herhangi etiket 91,49 → 60,31 ms oldu. Tek seferlik katalog sorgusu 243,71 → 129,28 ms ölçüldü; bu iki değer p95 değildir. **Tüm 10.000 notu eşleştiren geniş FTS araması son çalıştırmada p95 227,82 ms ile hedefin üzerinde kaldı.** Bütün aramalar için hedef tamamlandı denmez. Geniş FTS sorgusunun SQL'i bu iterasyonda değişmedi; makine yükü izole olmadığı için bu artışın nedeni yalnızca kod değişimine bağlanamaz.

“İlk gözlem” senaryonun ilk çağrısıdır; SQLite bağlantılarının önbellekleri farklı sıcaklıkta olabilir. Ardından üç ısınma ve 30 ölçüm uygulanır. Fixture kısa süre önce yazıldığı için işletim sisteminin disk önbelleği sıcaktır: ilk gözlem **soğuk disk testi değildir**. Diğer uygulamaları etkileyen sistem önbelleği temizliği yapılmadı. Derleme/stress testiyle çakışan ara çalıştırma `library-10000-contended.json` olarak saklandı; tablodaki son ölçüm benchmark süreciyle eşzamanlı Cargo testi başlatılmadan alındı. Genel makine yükü yine yaklaşık 17 idi.

Ham raporlar: `output/benchmarks/library-10000-before.json` ve `output/benchmarks/library-10000.json`. Rapor ölçüm zamanı, profil, örnek sayısı, her sorgu, sonuç ve JSON boyutu içerir. Fixture geçici dizinde açılıp süreç bitiminde silinir; kullanıcının normal kütüphanesine erişilmez.

Bu ölçüme native IPC taşıması, React render/liste kaydırma, soğuk disk önbelleği, PDF render, büyük dosyalar ve macOS/Windows dahil değildir. 10.000 kayıtla kullanıcı arayüzü kare hızı/bellek kabulü ayrıca ölçülmelidir.

## Gerçek süreç kesintisi: 100 dosya

```bash
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --locked --test import_stress -- --test-threads=1
```

Üç stress testi geçti; bir `ignored` test sadece parent'ın ayrı süreçte çalıştırdığı worker girişidir. Worker normal test akışında ayrıca çalıştırılmaz. İlk ayrı stress çalıştırması 11,94 saniye; sonraki tüm Rust kontrollerinde 30 test geçti (stress grubu 7,93 saniye).

1. **100 dosyalı içe aktarma:** Worker ilk 49 dosyayı tamamlar. 50. kaynak 128 MiB'dir. DB'de `copying` işi ve staging dosyasında gerçek **65.536 byte** kopya görüldükten sonra child process `SIGKILL` ile sonlandırıldı. Yeniden açılışta 49 hazır dosyanın boyut ve SHA-256 değerleri doğrulandı; yarım iş `failed`, staging boş, yetim dosya dizini ve foreign key/integrity hatası yoktu. 100 dosya yeniden eklendi: ilk 49 mükerrer bulundu, kalanlar tamamlandı; sonuçtaki 100 dosyanın hash'i ve özgün büyük dosyanın boyutu doğrulandı.
2. **Kopyalanırken kaynak değişimi:** 128 MiB dosyanın staging kopyası gözlendikten sonra özgün dosyaya veri eklendi. İşlem değişimi bildirerek reddedildi; kayıt/ek veya staging artığı oluşmadı. Kararlı dosya ile tekrar deneme başarılı oldu.
3. **Okuma izni yok:** Unix kaynak dosyasının okuma izinleri kaldırıldı. İçe aktarma başarısız oldu, yarım kaynak bırakmadı. İzin geri verildiğinde aynı dosya eklendi. Root gibi izin denetimini aşabilen süreçlerde bu senaryo açıkça atlanır; bu çalıştırma normal kullanıcıyla geçti.

Ham kesinti raporu: `output/benchmarks/import-100-recovery.json`. Bütün dosyalar testin geçici dizinindedir. `child.kill()` Linux'ta gerçek `SIGKILL` kullanır; bu oturumda Windows `TerminateProcess` veya macOS çalıştırılmadı.

Bu testler ani güç kesintisi, dosya sistemi bozulması, fiziksel disk dolması veya her olası yarış durumunun kanıtı değildir. Import sürecinin gözlenen staging aşamasındaki zorla kapanmasını, kaynak değişimini ve erişim hatasını doğrudan kapsar.
