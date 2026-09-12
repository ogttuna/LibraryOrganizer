# Kapsam ve kabul kapıları

## 0.2.0 — Uygulanan çekirdek

- [x] Çevrimdışı Tauri/React ve ilişkisel SQLite/FTS5.
- [x] Kayıt/dosya ayrımı; PDF/EPUB/diğer belgeler; kopya/hash/mükerrer kontrolü.
- [x] Çoklu kategori/etiket, alt kategori, taşıma/yeniden adlandırma/silme; ilişkiler korunur.
- [x] Başlık/yazar/yıl/tür/dil, açıklama/özet/kişisel notlar.
- [x] Otomatik kaydetme ve hatada taslak koruma; macOS Quit dahil kapanışta yazmaları bekleme.
- [x] Okunmadı/okunuyor/okundu, favori, arama, tümü/herhangi biri ve birleşik filtreler.
- [x] Toplu işlemler, klavye kullanımı, boyutlanan ayrıntı paneli, kapanabilen gezinme, kaydırma konumu.
- [x] PDF okuyucu, sayfa/zoom/parola, okuma konumu, okuyucu notları; harici EPUB açma.
- [x] Çöp/geri getirme ve kalıcı temizleme günlüğü.
- [x] Tutarlı ZIP/SQLite yedekleme; kapsam/hash/şema doğrulamalı geri yükleme ve eski arşivi koruma.
- [x] 100 dosya aktarırken gerçek süreç sonlandırma, kaynak değişikliği ve izin reddi testleri.
- [x] 10.000 metadata kaydıyla p50/p95 ölçümü ve sorgu iyileştirmesi.
- [x] M1 için GitHub Actions DMG akışı, imza/mimari/paket kontrolleri ve gerçek Mac açılış kontrolü tanımı.

## Dağıtım kabulü

- [ ] M1 DMG iş akışının başarıyla tamamlanması ve indirilebilir paketin teslimi. Gerçek durum `STATUS.md` içinde güncellenir.
- [ ] Kullanıcının M1/macOS15+ üzerinde kurulum, dosya seçici/sürükle bırak ve gerçek belgelerle günlük kullanım kabulü.
- [ ] Windows11 ve Intel Mac gerçek cihaz kabulü.
- [ ] Developer ID/notarization kimlik bilgileri sağlandığında tam imzalı dağıtım.
- [ ] Gerçek taranmış büyük kitaplar için bellek ve açılış optimizasyonu; geniş FTS gecikmesini daha da düşürme.

## Ölçülebilir işlevsel kontroller

Aynı belgeyi farklı adlarla ekleme; tek kaynağa PDF+EPUB bağlama; üç kategoriden birini kaldırma; kategori/etiket yeniden adlandırdıktan sonra arama; özgün Türkçe metinleri değiştirmeden sadeleştirilmiş arama; not yazarken başka kayda geçme/çıkış; okundu/favori/çöp/geri getirme; kaynak değişirken kopyayı reddetme; ZIP ve veritabanı bozuksa aktif arşive dokunmama; geri yüklemenin iki rename adımında kesilip toparlanması otomatik testlerle kapsanır.

## Kapsam dışı

Hesap, sunucu, bulut senkronizasyonu, OCR, AI özetleme, PDF anotasyonu, kaynakça yönetimi, eklentiler, dosya içeriği arama indeksi ve gömülü EPUB okuyucusu. Liste şu an sınırlandırılmış sayfalama kullanır; sanallaştırma ölçüme göre ayrıca eklenebilir.
