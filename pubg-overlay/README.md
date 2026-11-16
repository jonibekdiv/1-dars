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
