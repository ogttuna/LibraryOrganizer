# Folio · LibraryOrganizer

Kitap, makale ve belgeler için kişisel masaüstü kütüphanesi. **Dosyalar, notlar ve veritabanı yalnızca bilgisayarında kalır. Hesap, sunucu, bulut yüklemesi ve uygulama aboneliği yok.**

Tauri 2 · React/TypeScript · Rust/SQLx · SQLite/FTS5 · PDF.js

**Sürüm: 0.2.1.** Çekirdek kütüphane, sınıflandırma, okuyucu, yedekleme/geri yükleme ve kalıcı çöp akışları uygulandı. Gerçekte çalıştırılan kontroller ve platform sınırları [STATUS.md](docs/STATUS.md) içinde tutulur.

## MacBook M1'e kurulum

Mac üzerinde Node.js, Rust veya geliştirme ortamı gerekmez. [Doğrulanmış M1 derlemesinden](https://github.com/ogttuna/LibraryOrganizer/actions/runs/34697742088) **apple-silicon** paketini indir. ZIP'i aç, içindeki DMG'yi açıp Folio'yu **Uygulamalar** klasörüne sürükle.

Hedef **macOS 15 ve üzeri**. Kişisel kullanım paketi ad-hoc imzalıdır. macOS ilk açılışta geliştiriciyi doğrulayamadığını bildirirse, açma denemesinden sonra **Sistem Ayarları → Gizlilik ve Güvenlik → Yine de Aç** yolunu kullan. Pakette `KURULUM.txt`, SHA-256 ve derleme/doğrulama raporu bulunur. [Mac paketleme ve kabul durumu](docs/MACOS.md).

## Neler yapabilirsin?

- PDF/EPUB, TXT, MD, DOC/DOCX, ODT, RTF ve DJVU ekle; dosyasız kayıt da oluştur.
- Aynı kaynağa birden fazla dosya bağla. Dosyaların özgün konumları değiştirilmez; arşive kopyalanır ve birebir mükerrerler hash ile tanınır.
- Çoklu, hiyerarşik kategoriler oluştur; taşı, yeniden adlandır veya sil. Kategoriyi silmek kaynakları silmez; alt kategoriler korunur, ad çakışması açıklanır.
- Etiketleri yazarken ekle, önerilerden seç; yan panelden ara, yeniden adlandır veya sil.
- Başlık, yazarlar, yıl, tür, dil; birbirinden ayrı açıklama, özet ve kişisel notlar düzenle. Notlar PDF'nin içine yazılmaz.
- Okunmadı / Okunuyor / Okundu ve favorileri kullan; çoklu seçimle kategori, etiket ve okuma durumu uygula.
- Başlık, yazar, açıklama, özet, not, kategori, etiket ve dosya adında Türkçe arama yap. Kategori, etiket, format, tür ve okuma filtrelerini birlikte kullan.
- PDF'yi uygulama içinde oku; sayfaya/genişliğe sığdırma, yüzdeyle yakınlaştırma ve klavye gezinmesini kullan; son sayfan ve okuyucu notların korunur. EPUB ve diğer biçimler varsayılan uygulamada açılır.
- Kaynakları çöpe taşı, geri getir veya onay vererek kalıcı sil. Özgün dosyalara dokunulmaz.
- `.folio` yedeği oluştur; yedeği doğrulayıp içeriğini inceleyerek geri yükle. Önceki kütüphane ayrı klasörde korunur.

Metinler 500 ms yazma arası sonrası kaydedilir. Not alanında Ctrl/⌘+S veya Kaydet ile hemen kayıt alabilirsin; PDF okurken mevcut sayfa başlığını imlecin olduğu yere ekleyebilirsin. Başarısız kayıt taslağı korunur ve yeniden denenebilir. Normal çıkış, macOS Cmd+Q dahil, bekleyen notları, okuma konumunu ve yazma işlemlerini tamamlar. Devam eden içe aktarma veya geri yükleme sırasında çıkış bekletilir. Süreci zorla öldürmek/pil kesintisi son henüz kaydedilmemiş tuş vuruşlarını koruma garantisi vermez; tamamlanmış dosyalar ve yarım aktarım toparlaması ayrıca test edilir.

## Günlük kullanım

“Kaynak ekle” ile başla. Tek tıklama ayrıntıları, çift tıklama veya Enter dosyayı açar. Birden fazla yazar için `;` kullan. Sağ panel Genel / Notlar / Dosyalar olarak ayrılır; masaüstünde kenarını sürükleyerek boyutlandırabilirsin. Sol panel üst çubuktaki düğmeyle kapanır.

| Kısayol                            | İşlem                          |
| ---------------------------------- | ------------------------------ |
| Cmd/Ctrl + K                       | Arama                          |
| Cmd/Ctrl + N                       | Kaynak ekle                    |
| Enter                              | Odaklı kaynağın dosyasını aç   |
| Yukarı / Aşağı                     | Kaynak satırları arasında odak |
| Cmd/Ctrl + tıklama                 | Çoklu seçim                    |
| Shift + tıklama                    | Aralık seçimi                  |
| Escape                             | Açık alanı kapat               |
| PDF'de sol/sağ ok, PageUp/PageDown | Sayfa değiştir                 |

Kategori filtresi seçilenlerden **herhangi birini** arar; alt kategorileri dahil edebilirsin. Etiketlerde **tümü / herhangi biri** seçilir. Farklı filtre grupları birlikte uygulanır. “Işık İstanbul Öğrenme” metni `isik istanbul ogrenme` ile bulunur; özgün metin ve etiket kimlikleri değiştirilmez.

## Veriler ve yedekler

Konumu **Ayarlar ve yedekleme** ekranında görürsün: işletim sisteminin yerel uygulama veri klasöründe `library/`. `library.sqlite` metadata/notları, `files/<uuid>/original.<format>` arşiv kopyalarını tutar. Kategori değişikliği diskte dosya taşımaz. Fontlar, PDF worker ve çözümleyiciler pakete dahildir; CDN kullanılmaz.

Yedeği uygulama içinden yeni bir `.folio` dosyasına kaydet. Geri yükleme, SQLite şeması/ilişkileri ve tüm dosyaların hash'lerini geçici klasörde doğrular. Onay sonrasında uygulama yeniden başlar ve yedek devreye girer. Önceki kütüphane aynı ana klasörde `Folio-onceki-kutuphane-<uuid>` adıyla tutulur. Canlı veritabanını elle/bulut eşitlemesiyle değiştirmen gerekmez.

## Geliştirme

Node.js 24, Rust 1.95 ve [Tauri sistem bağımlılıkları](https://v2.tauri.app/start/prerequisites/) gerekir. Geliştirici bilgisayarında bu araçlar kurulu olmalı.

```sh
npm ci
npm run desktop
```

Ubuntu 24.04'te eksik sistem bağımlılıkları:

```sh
sudo apt-get install libwebkit2gtk-4.1-dev build-essential libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

İlk geliştirme kurulumu bağımlılık indirir. Derlenmiş Folio internetsiz, HTTP sunucusu çalıştırmadan açılır. Geliştirmede Vite yalnızca yerel olarak çalışır.

```sh
npm test
npm run test:core
npm run check:rust
npm run build
npm run format:check
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
npm run desktop:build
```

`npm run dev`, `http://127.0.0.1:1420` adresinde **ayrı IndexedDB önizlemesi** açar. Tarayıcıdaki veri masaüstü arşivine aktarılmaz. Örnek kütüphane yalnızca açık seçimle tarayıcıya eklenir. Masaüstü temiz başlar.

## Belgeler

[Ürün tanımı](docs/PRODUCT.md) · [Mimari](docs/ARCHITECTURE.md) · [Yol haritası](docs/ROADMAP.md) · [Doğrulama](docs/STATUS.md) · [Test yönergesi](docs/TESTING.md) · [Performans](docs/PERFORMANCE.md) · [Mac kurulumu](docs/MACOS.md) · [Dağıtım](docs/RELEASE.md)

PDF içeriğinde arama, OCR, yapay zekâ, PDF anotasyonu, bulut senkronizasyonu ve gömülü EPUB okuyucu bu sürümün kapsamında değildir. Uygulama içindeki arama senin kaynak bilgilerini ve notlarını tarar.
