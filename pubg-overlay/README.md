# PUBG Mobile strim overlay

OBS Studio uchun real vaqtda ishlaydigan turnir bannerlari va qo'lda boshqariladigan admin panel.

- `admin.html` — admin panel (kompyuter yoki telefondan)
- `overlay.html` — OBS ga "Browser" manbasi sifatida ulanadigan shaffof sahifa (1920×1080)

## Nimalar bor

| Ekranda | Qanday chiqadi |
|---|---|
| O'ng tomonda jonli reyting (tirik / nok / o'lgan, kill soni) | Doim, avtomatik yangilanadi |
| `ELIMINATED` — jamoa yopildi (kim yopgani bilan) | Avtomatik |
| `FIRST BLOOD`, `ELIM STEALER`, `RAMPAGE`, `DOMINATION` | Avtomatik (sozlamada o'chirish mumkin) |
| `AIRDROP LOOTED`, `SHARPSHOOTER`, `DAMAGE`, o'z matningiz | Tugma bilan |
| `CIRCLE CLOSING IN` sanoq | Soniyani kiritib "Boshlash" |
| Final jamoalar va WWCD foizi | Tugma bilan |
| Chempion, match natijasi, umumiy reyting, top fraggers, jamoa statistikasi | To'liq ekran sahnalar |

## Admin qanday ishlaydi

1. **Jamoalar** bo'limida jamoa va o'yinchilarni kiriting (ro'yxatdan tez kiritish ham bor).
2. **Jonli** bo'limida:
   - Kill: o'ldirgan o'yinchi **ismini** bosing → qurbonning **☠** tugmasini bosing.
   - Nok: o'ldirgan o'yinchi ismini bosing → qurbonning **N** tugmasini bosing.
   - Zonadan o'lim: hech kim tanlanmagan holda (Esc) **☠** ni bosing.
   - Jamoaning oxirgi o'yinchisi yiqilsa, nokdagilar ham o'ladi va jamoa o'rni o'zi belgilanadi.
   - Xato bo'lsa — **Bekor qilish** (Ctrl+Z). Faqat o'zingizning oxirgi harakatingiz bekor bo'ladi.
3. Match tugagach **Matchni yakunlash** — natija saqlanadi, ochkolar hisoblanadi, yangi match ochiladi.
4. **Natijalar** bo'limida o'rinlarni tuzatish, damage kiritish, PNG va CSV yuklab olish mumkin.

### Klaviatura

Har bir jamoa kartasida raqam bor (01, 02…), o'yinchilarda ham (1–4).
**2 raqam jamoa + 1 raqam o'yinchi**, keyin: **A** — hujumchi, **K** — kill, **N** — nok.
Misol: `011 A 032 K` — 1-jamoaning 1-o'yinchisi 3-jamoaning 2-o'yinchisini o'ldirdi.
`Backspace` — raqamni tozalash, `Esc` — bekor qilish, `Ctrl+Z` — orqaga.

### Bir nechta turnir va adminlar

- **Asosiy admin (egasi)** — birinchi ro'yxatdan o'tgan hisob. Kirgandan keyin **Turnirlar** sahifasi ochiladi:
  yangi turnir ochish, nomini o'zgartirish, o'chirish va har bir turnirga admin emailini qo'shish/olib tashlash.
- **Turnir admini** — egasi qo'shgan email bilan admin sahifasida **Ro'yxatdan o'tish** ni bosadi (tasdiqlash xati kerak emas).
  U faqat o'ziga biriktirilgan turnir(lar)ni ko'radi va boshqaradi. Bir turnirda bir nechta admin bir vaqtda ishlay oladi.
- Har bir turnirning jamoalari, natijalari, xaritalari alohida. OBS havolasi: `overlay.html?room=TURNIR_KODI`,
  jadval: `table.html?room=TURNIR_KODI` — Turnirlar sahifasidagi tugmalar bilan nusxalanadi.
- Eski havola (`overlay.html`, room'siz) birinchi turnirni ("main") ko'rsatishda davom etadi.

### Sahnalar (hammasi faqat admin bosganda chiqadi, o'sha tugma qayta bosilsa yopiladi)

| Tugma | Nima ko'rsatadi |
|---|---|
| Match natijasi, Umumiy reyting | Jadval, yetakchi jamoa, o'rin o'zgarishi ▲▼, match point |
| Top fraggers, Statistika, Chempion | O'yinchi kartalari, g'olib |
| Xarita (drop) | **Xarita** bo'limida belgilangan tushish joylari |
| A vs B | Ikki jamoani yonma-yon taqqoslash |
| Match MVP, Turnir MVP, tanlangan o'yinchi | Bitta o'yinchi katta rasmi va statistikasi |
| Tez orada, Keyingi match, Tanaffus | Sanoq taymeri (daqiqa) bilan tanaffus ekrani |
| 🔊 Ovoz | Banner va sahnalarda qisqa ovoz effekti (OBS'da "Control audio via OBS" ni belgilang) |

### 🤖 Avto-kill (ekrandan o'qish)
Jonli bo'limning o'ng tomonida. O'yinga tegmaydi: faqat ekrandagi kill yozuvlarini o'qiydi (OCR).
1. **🖥 Ekranni ulash** — observer o'yini oynasini yoki OBS proyektorini tanlang (Chrome/Edge).
2. **▭ Joyni belgilash** — kill yozuvlari chiqadigan joyni sichqoncha bilan belgilang (bir marta, eslab qolinadi).
3. Rejim: **✋ Tasdiqlab** — har bir yozuv taklif bo'lib chiqadi, ✔ bilan tasdiqlaysiz; **⚡ To'liq avto** — o'zi yozadi.
- Nok yoki kill o'yin qoidasidan aniqlanadi: sherigi tik turgan bo'lsa — nok; nokdagi yoki oxirgi tik turgan — kill.
- Ismlar jamoalar ro'yxatidagi o'yinchilarga solishtiriladi (o'xshash harflar: $→S, 6→G, 7→T, kirillcha harflar hisobga olinadi). O'yinchi ismlarini o'yindagi nik bilan bir xil yozing.
- Faqat bitta ism o'qilgan yozuv (zona, yiqilish) avtomatik yozilmaydi — tasdiqlash rejimida "?" bilan chiqadi.
- Xato bo'lsa "Oxirgi harakatlar"dan bosib tuzating.

### Kill / nok tez kiritish
- **📌 Hujumchi qoladi**: hujumchi kill'dan keyin ham tanlangan turadi, ketma-ket killarni bosaverasiz (Esc — tozalash). O'chirilsa, har kill'dan keyin o'zi tozalanadi. Har bir admin uchun alohida eslab qolinadi.
- **Oxirgi hujumchilar**: qidirish satri ostida oxirgi 5 ta hujumchi turadi, bir bosishda tanlanadi.
- **☠ Hammasi** (jamoa sarlavhasida): zona yoki chiqib ketish — butun jamoa bir bosishda yopiladi, kill hech kimga yozilmaydi (nokdagilar nok qilganga). Ctrl+Z bilan qaytariladi.
- **Oxirgi harakatlar**ni bosib tuzatish: kim o'ldirgani/nok qilganini almashtirish yoki yozuvni o'chirish (o'yinchi tiriladi, kill olib tashlanadi).
- **⤴ Turg'izish**: nokdagi o'yinchining tugmasi ⤴ ga aylanadi, bosilsa tirik bo'ladi va jurnalga yoziladi.
- O'lgan o'yinchining ☠ ini qayta bosish — xatoni tuzatish: o'yinchi tiriladi va kill hujumchidan olib tashlanadi.
- **📱 Telefon rejimi**: `admin.html?m=1` (Sozlamalarda havola bor) — faqat kill/nok uchun katta tugmalar. Oddiy havola avvalgidek to'liq panelni ochadi.

### Musiqa
- "Jonli" sahifasidagi 🎵 bo'limi: o'z qo'shiqlaringizni yuklang yoki 5 ta tayyor (o'zimiz yozgan, mualliflik muammosi yo'q) musiqadan foydalaning: jang boshlanishi, lobbi/tanaffus, keyingi match sanog'i, chempion fanfarasi, strim intro.
- **Sahna musiqasi**: sahna ochilganda unga bog'langan musiqa o'zi boshlanadi (Chempion → fanfara, Tez orada / Tanaffus → lobbi, Keyingi match → sanoq), sahna yopilganda to'xtaydi yoki oldin chalinayotgan qo'shiq davom etadi. "⚙ Sozlash" — qaysi sahnaga qaysi musiqa. "🎬 Sahna musiqasi" tugmasi bilan butunlay o'chirib qo'yiladi.

### OBS ulanganini bilish
Yuqori panelda **🟢 OBS ulangan** / **🔴 OBS ulanmagan** — overlay sahifasi (OBS'da yoki brauzerda) hozir ochiqmi yo'qmi.

### Sharhlovchi kamerasi
"🎥 Sharhlovchi kamerasi" bo'limi: tugma bosilganda suyuq ramka (ism va pastki yozuv bilan) chiqadi, qayta bosilsa yashirinadi. Burchak va o'lcham tanlanadi. Ramka o'rtasi shaffof: OBS'da kamerangizni overlay manbasining **ostiga**, admin panel ko'rsatgan joyga (X, Y, kenglik×balandlik) qo'ying. Ramka chap pastda bo'lsa, pastki bannerlar avtomatik tepaga suriladi.

### 16 tadan ko'p jamoa

Match natijasi va umumiy reyting sahnalari 16 tadan varaqlarga bo'linadi. Jonli bo'limda **"1-varoq / 2-varoq"** tugmalari chiqadi —
admin qaysi varoq ekranda turishini tanlaydi (sahna ochilganda doim 1-varoqdan boshlanadi). PNG eksport har bir varoq uchun alohida rasm beradi.

### Sozlamalar

- **Bosqichlar** — kun / guruh / final: har birining o'z matchlari, o'z jadvali va o'z jamoalari bor.
- **Match point** — belgilangan ochkoga yetgan jamoa keyingi WWCD bilan chempion bo'ladi.
- **Zaxira nusxa** — hamma narsani bitta faylga yuklab olish va qayta tiklash.
- **Tomoshabinlar uchun jonli jadval** — `table.html` havolasi, telefonda ochiladi.

## Internet orqali ishlatish

Tizim Supabase loyihasiga ulangan (`config.js`) va Vercel'da joylashgan:

- Admin: https://pubg-overlay.vercel.app/admin.html
- Overlay: https://pubg-overlay.vercel.app/overlay.html
- Tomoshabinlar uchun jadval: https://pubg-overlay.vercel.app/table.html

Admin sahifasida **birinchi ro'yxatdan o'tgan hisob** admin bo'ladi. Keyingi hisoblar yoza olmaydi;
yana admin qo'shish uchun Supabase SQL Editor'da:
`insert into public.overlay_admins (email) values ('yangi@email.com');`

Boshqa Supabase loyihasiga ko'chirish uchun `supabase.sql` ni ishga tushirib, `config.js` dagi manzil va kalitni almashtiring.

## OBS ga ulash

Sources → **+** → **Browser** → URL: `https://pubg-overlay.vercel.app/overlay.html`, Width `1920`, Height `1080`.
Bir nechta turnir uchun URL ga `?room=nomi` qo'shing (admin va overlay da bir xil bo'lsin).
