# 🎧 Lyricly — Şarkılarla İngilizce

YouTube'dan sevdiğin şarkıyı aç; şarkı her satırdan sonra durur, sen de cümleyi kelimeleri seçerek, yazarak ya da boşlukları doldurarak tamamla.

**Canlı:** https://swipeus.github.io/lyricly

## Özellikler
- 🧩 **Kelime Seç** · ⌨️ **Dinle & Yaz** · ✏️ **Boşluk Doldur** · 🎧 **Dinle & Oku** (karaoke)
- Senkronlu sözler [LRCLIB](https://lrclib.net)'ten; senkronsuz sözler için dokunarak senkronlama
- Kelimeye tıkla → Türkçe anlamı, İngilizce tanımı, telaffuzu; kelime defterine ekle
- Aralıklı tekrarlı (Leitner) kelime kartları
- XP, seviye, günlük seri, günlük hedef
- Telefona "Ana Ekrana Ekle" ile uygulama gibi kurulur
- Yedekle / Geri yükle ile cihazlar arası aktarım (veriler sadece cihazda saklanır)

## Yerelde çalıştırma
Derleme gerekmez. Herhangi bir statik sunucu yeter:

```
python -m http.server 5178
```

Sonra http://localhost:5178 adresini aç (YouTube oynatıcısı `file://` ile çalışmaz).

## Geliştirme
Kaynak kod `src/` klasöründe. Eski iPhone'larda (iOS 11+) da çalışması için yayınlanan
`app.js` ve `style.css` derlenmiş çıktıdır:

```
npm install
npm run build
```
