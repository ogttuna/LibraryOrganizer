# Folio — Ürün tanımı

Durum: 0.2.0. Çalışma adı: Folio. Hedef: tek kullanıcı, çevrimdışı çalışan, Windows/macOS/Linux masaüstü kaynak kütüphanesi.

Kesin kullanıcı kısıtı: veriler yalnızca kullanıcının bilgisayarında tutulur. Sunucu, hesap, uzak veritabanı, telemetri, bulut yüklemesi veya bunlara bağlı çalışma maliyeti yoktur. Geliştirme bağımlılıklarının ilk indirmesi haricinde uygulamanın çekirdek işlevleri internet gerektirmez. Yedekler kullanıcının seçtiği yerel konuma yazılır.

## Temel iş

Kullanıcı bir kitap, makale veya başka belgeyi ekler; birden fazla kategoriye koyar; etiket, açıklama, özet ve kişisel notlarını yazar; okuma durumunu takip eder; daha sonra arayıp dosyayı açar. Hesap ve sunucu gerekmez.

## Terimler

| Terim        | Anlamı                                                                       |
| ------------ | ---------------------------------------------------------------------------- |
| Kaynak       | Dosyadan bağımsız kitap/makale/diğer kaydı; kalıcı UUID ile tanınır.         |
| Ek / dosya   | Bir kaynağa bağlı arşiv kopyası. Aynı kaynakta PDF ve EPUB bulunabilir.      |
| Kategori     | Çoklu üyelik destekleyen, isteğe bağlı hiyerarşik ana sınıflandırma.         |
| Etiket       | Kategoriler arasında ortak konuları bağlayan serbest sınıflandırma.          |
| Açıklama     | Kaynağın konusu ve kapsamı.                                                  |
| Özet         | İçeriğin kullanıcının yazdığı kısa özeti.                                    |
| Notlar       | Kullanıcının yorumları; PDF dosyasına yazılmaz.                              |
| Okuma durumu | `unread` (Okunmadı), `reading` (Okunuyor), `read` (Okundu).                  |
| Çöp          | Kaynağı, dosyaları, notları ve ilişkileri geri getirilebilir biçimde saklar. |

## Ana ekran ve davranışlar

Sol panel: tüm kaynaklar, son eklenenler, favoriler, okuma listesi, kategorisiz, çöp ve kategori ağacı. Orta panel: arama, filtreler, sıralama, kaynak ekleme ve liste. Sağ panel: Genel / Notlar / Dosyalar sekmeleri.

Tek tıklama ayrıntıyı açar; çift tıklama veya Enter birincil dosyayı açar. Cmd/Ctrl+K aramaya, Cmd/Ctrl+N kaynak eklemeye gider. Escape panel/diyalogdan çıkar. Shift ve Cmd/Ctrl çoklu seçim için kullanılır. Toplu kategori/etiket işlemleri mevcut üyeliklere ekler.

Metin değişiklikleri 500 ms sonra kaydedilir. Durum görünürdür. Kayıt değişiminde bekleyen yazma tamamlanır; başarısızsa kullanıcının taslağı korunur ve yeniden deneme sunulur. Boş başlık ve geçersiz yıl sessizce kaydedilmez.

## Filtre sözleşmesi

- Metin: başlık, yazar, açıklama, özet, notlar, kategori, etiket ve özgün dosya adı. Kullanıcının sözcükleri birlikte aranır; son sözcük dahil tüm sözcükler ön ek eşleşir.
- Kategori: seçilenlerden herhangi biri. Alt kategorileri dahil etme açık/kapalıdır.
- Etiket: tümü veya herhangi biri.
- Tür, dosya formatı, okuma durumu ve diğer filtre grupları AND ile birleşir.
- Son eklenenler: son 30 günde eklenen canlı kayıtlar.
- Okuma listesi: henüz bitirilmemiş kayıtlar (okunmadı veya okunuyor).
- Varsayılan sıralama son eklenen; arama sırasında uygunluk. Başlık ve yıla göre sıralama da sunulur.
- `I/İ/ı/i` ve Türkçe aksanlar arama temsilinde sadeleştirilir. Bu işlem kategori/etiket kimliğini birleştirmek için kullanılmaz.

## Tasarım kararı

**Görsel tez:** Sıcak kâğıt tonları, mürekkep koyuluğunda metin ve tek orman yeşili vurgu ile sakin, yoğun ama okunabilir bir masaüstü çalışma alanı.

**İçerik planı:** Gezinme → kaynak listesi ve birincil “Kaynak ekle” eylemi → seçili kaynağın bağlamı. Pazarlama başlığı veya istatistik dashboard'u yok. Boş durum ilk dosyanın nasıl ekleneceğini açıklar.

**Etkileşim tezi:** Hızlı satır odak/hover geçişleri, ayrıntı panelinin kısa giriş hareketi ve diyalogların yumuşak belirmesi; azaltılmış hareket tercihinde kapatılır. Modal odak yönetimi Radix ile yapılır. İkon düğmeleri erişilebilir ad taşır, odak halkaları belirgindir.

## İlk sürüm dışı

Hesap, sunucu, bulut senkronizasyonu, OCR, yapay zekâ özetleme, PDF anotasyonu, içerik tam metin indeksi, kaynakça yönetimi, gömülü EPUB okuyucusu ve eklenti sistemi. Şifreleme ayrı bir ürün kararıdır; yerel kayıt şifreleme anlamına gelmez.
