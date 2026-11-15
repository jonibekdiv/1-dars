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
   - Nok qilingan o'yinchi boshqa jamoa tomonidan o'ldirilsa "ELIM STEALER" o'zi chiqadi.
   - Jamoaning oxirgi o'yinchisi yiqilsa, nokdagilar ham o'ladi va jamoa o'rni o'zi belgilanadi.
   - Xato bo'lsa — **Bekor qilish** (Ctrl+Z).
3. Match tugagach **Matchni yakunlash** — natija saqlanadi, ochkolar hisoblanadi, yangi match ochiladi.
4. **Natijalar** bo'limida o'rinlarni tuzatish, damage kiritish va CSV yuklab olish mumkin.

## Internet orqali ishlatish

Tizim Supabase loyihasiga ulangan (`config.js`) va Vercel'da joylashgan:

- Admin: https://pubg-overlay.vercel.app/admin.html
- Overlay: https://pubg-overlay.vercel.app/overlay.html

Admin sahifasida **birinchi ro'yxatdan o'tgan hisob** admin bo'ladi. Keyingi hisoblar yoza olmaydi;
yana admin qo'shish uchun Supabase SQL Editor'da:
`insert into public.overlay_admins (email) values ('yangi@email.com');`

Boshqa Supabase loyihasiga ko'chirish uchun `supabase.sql` ni ishga tushirib, `config.js` dagi manzil va kalitni almashtiring.

## OBS ga ulash

Sources → **+** → **Browser** → URL: `https://pubg-overlay.vercel.app/overlay.html`, Width `1920`, Height `1080`.
Bir nechta turnir uchun URL ga `?room=nomi` qo'shing (admin va overlay da bir xil bo'lsin).
