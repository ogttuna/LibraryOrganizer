# Folio geliştirme kuralları

- Ürün ve kullanıcı arayüzü Türkçe. Kod, türler ve komut adları İngilizce.
- Ürün kapsamı ve terimler: `docs/PRODUCT.md`. Mimari ve değişmez kurallar: `docs/ARCHITECTURE.md`. Mevcut aşama: `docs/ROADMAP.md`.
- Gerçek masaüstü verisinin tek otoritesi Rust + SQLite. React SQL çalıştırmaz; dosya yolları arayüzden açılmaz. Dosya işlemleri ek kimliği üzerinden servislerde doğrulanır.
- Kayıt ile dosyayı, kaynak türü ile dosya formatını ayır. Bir kaynak birden fazla kategoriye ve etikete ait olabilir.
- Kullanıcının özgün dosyasını değiştirme. Kategori üyeliğini kaldırmak kaydı silmez. İlk silme her zaman çöpe taşır.
- Notlar, açıklama ve özet ayrı alanlar. Arama temsili türetilmiş veridir; Türkçe özgün metinleri değiştirme.
- Yeni masaüstü komutu eklerken `src/lib/types.ts`, `src/lib/backend.ts` ve Rust komut sözleşmesini birlikte güncelle.
- Tarayıcı önizlemesi ayrı IndexedDB verisi kullanır; gerçek masaüstü arşivine eriştiğini iddia etme ve örnek kayıtları üretim veritabanına otomatik ekleme.
- Dosya yaşam döngüsü değişikliklerinde Rust entegrasyon testlerini çalıştır. UI değişikliklerinde `npm run build`, ilgili Vitest kontrolleri ve tarayıcı görsel kontrolü yap.
- Linux'ta başarılı derleme Windows/macOS doğrulaması sayılmaz. Gerçekte çalıştırılan kontrolleri `docs/STATUS.md` içinde belirt.
- Sürüm kilit dosyalarını koru. Yeni özellik için gerekli değilse ek framework veya servis kurma.
