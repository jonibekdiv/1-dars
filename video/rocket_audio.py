"""Raketa videosi uchun faqat SFX ovoz yo'lagi (diktor ham, musiqa ham yo'q).

Ishlatish: python3 rocket_audio.py "[4.5, 6, 6, 5, 6.5, 9]" chiqish.wav
Effektlar vaqti rocket.html dagi sahna voqealariga (p — sahna ichidagi ulush) moslangan.
"""
import json
import sys
import wave

import numpy as np
from scipy.signal import butter, sosfilt

SR = 44100
rng = np.random.default_rng(42)


def n(sec):
    return int(SR * sec)


def lp(x, f, order=2):
    return sosfilt(butter(order, f, 'low', fs=SR, output='sos'), x)


def hp(x, f, order=2):
    return sosfilt(butter(order, f, 'high', fs=SR, output='sos'), x)


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], 'band', fs=SR, output='sos'), x)


def noise(sec):
    return rng.standard_normal(n(sec))


def env_curve(times, values, length):
    """Vaqt nuqtalari bo'yicha chiziqli konvert."""
    t = np.arange(length) / SR
    return np.interp(t, times, values)


def add(buf, sig, at, gain=1.0):
    i = n(at)
    if i >= len(buf) or i + len(sig) <= 0:
        return
    if i < 0:
        sig, i = sig[-i:], 0
    sig = sig[: len(buf) - i]
    buf[i:i + len(sig)] += sig * gain


def beep(freq, sec, vol=0.4):
    t = np.arange(n(sec)) / SR
    e = np.minimum(1, t / 0.005) * np.minimum(1, (sec - t) / 0.03)
    return (np.sin(2 * np.pi * freq * t) + 0.3 * np.sign(np.sin(2 * np.pi * freq * t))) * e * vol


def boom(sec=2.5, vol=1.0):
    t = np.arange(n(sec)) / SR
    f = 70 * np.exp(-t * 1.5) + 30
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.2)
    nz = lp(noise(sec), 900) * np.exp(-t * 4)
    return (sub * 0.9 + nz * 0.8) * vol


def bang(vol=1.0):
    sec = 1.6
    t = np.arange(n(sec)) / SR
    crack = hp(noise(sec), 1500) * np.exp(-t * 40)
    thump = np.sin(2 * np.pi * 55 * t) * np.exp(-t * 8)
    ring = (np.sin(2 * np.pi * 610 * t) + 0.6 * np.sin(2 * np.pi * 947 * t) + 0.4 * np.sin(2 * np.pi * 1390 * t)) * np.exp(-t * 3.5) * 0.25
    return (crack * 0.9 + thump * 0.9 + ring) * vol


def clunk(vol=0.8):
    sec = 0.5
    t = np.arange(n(sec)) / SR
    return (np.sin(2 * np.pi * 90 * t) * np.exp(-t * 18) + lp(noise(sec), 600) * np.exp(-t * 25) * 0.6) * vol


def whoosh(sec=0.7, vol=0.5):
    t = np.arange(n(sec)) / SR
    x = noise(sec)
    lo = bp(x, 300, 1200)
    hi = bp(x, 1500, 5000)
    k = t / sec
    return (lo * (1 - k) + hi * k) * np.sin(np.pi * k) ** 2 * vol


def chime(vol=0.35):
    out = np.zeros(n(2.2))
    for i, m in enumerate([72, 76, 79, 84]):
        f = 440 * 2 ** ((m - 69) / 12)
        t = np.arange(n(1.6)) / SR
        tone = (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t)) * np.exp(-t * 2.5)
        add(out, tone, i * 0.09)
    return out * vol


def main():
    durs = json.loads(sys.argv[1])
    out_path = sys.argv[2]
    total = sum(durs)
    st = np.cumsum([0] + durs[:-1])  # sahna boshlanishlari
    L = n(total)
    mix = np.zeros(L)

    def at(scene, p):
        return st[scene] + durs[scene] * p

    # --- 0: start maydoni: shamol, bug' shivirlashi, teskari sanoq ---
    wind = lp(noise(total), 500) * 0.05
    mix += wind * env_curve([0, at(1, 0), at(1, 0.2), total], [1, 1, 0.3, 0.3], L)
    for k in range(5):
        add(mix, hp(noise(0.9), 3000) * np.hanning(n(0.9)) * 0.08, 0.3 + k * 0.8)
    for k in (3, 2, 1):
        add(mix, beep(880, 0.16), st[1] - k)
    add(mix, beep(1320, 0.45, 0.45), st[1] - 0.05)

    # --- 1: alanga va dvigatel guvillashi (1-bosqich) ---
    add(mix, boom(3.0, 1.0), at(1, 0))
    meco = at(4, 0.24)
    rlen = meco - st[1]
    roar = hp(lp(noise(rlen), 300, 4) * 2.5 + lp(noise(rlen), 90, 4) * 4.0, 25)
    crackle = np.zeros(n(rlen))
    idx = rng.choice(n(rlen), size=int(rlen * 260), replace=False)
    crackle[idx] = rng.standard_normal(len(idx))
    crackle = bp(crackle, 800, 5000) * 2.2
    eng = roar + crackle
    eng /= np.percentile(np.abs(eng), 99.5) + 1e-9
    # balandroq ko'tarilish, keyin havo siyraklashgani sari pasayish
    eng *= env_curve([0, 0.5, 1.2, at(3, 0) - st[1], rlen - 0.12, rlen],
                     [0, 0.75, 1.0, 0.9, 0.55, 0], n(rlen))
    add(mix, eng * 0.75, st[1])
    add(mix, beep(660, 0.09, 0.2), at(1, 1.4 / durs[1]))  # o'qlar paydo bo'ladi

    # --- 2-3: tezlik bilan kuchayadigan havo oqimi, Max-Q tebranishi ---
    air = bp(noise(total), 700, 3500)
    air_env = env_curve([0, st[2], at(3, 0.5), at(4, 0.1), at(4, 0.3), total], [0, 0.05, 0.35, 0.1, 0, 0], L)
    mix += air * air_env * 0.5
    q0, q1 = st[3], st[3] + durs[3]
    qlen = q1 - q0
    t = np.arange(n(qlen)) / SR
    bellq = np.exp(-((t / qlen - 0.5) / 0.22) ** 2)
    rattle = bp(noise(qlen), 120, 900) * (0.5 + 0.5 * np.sign(np.sin(2 * np.pi * 23 * t))) * bellq
    groan = np.sin(2 * np.pi * (38 + 10 * np.sin(2 * np.pi * 0.7 * t)) * t) * bellq
    add(mix, rattle * 0.35 + groan * 0.25, q0)

    # --- 4: dvigatel o'chadi, ajralish portlashi, 2-dvigatel ---
    add(mix, clunk(0.7), meco)
    add(mix, bang(0.9), at(4, 0.36))
    ign2 = at(4, 0.46)
    add(mix, boom(1.2, 0.45), ign2)
    hlen = st[5] + 0.4 - ign2
    hiss = bp(noise(hlen), 1800, 6500) * 0.18 + lp(noise(hlen), 200) * 0.25
    hiss *= env_curve([0, 0.3, hlen - 0.5, hlen], [0, 1, 1, 0], n(hlen))
    add(mix, hiss, ign2)

    # --- 5: koinot: past guvillash, radio signallari, muvaffaqiyat qo'ng'irog'i ---
    slen = durs[5]
    t = np.arange(n(slen)) / SR
    pad = (np.sin(2 * np.pi * 55 * t) + 0.6 * np.sin(2 * np.pi * 82.5 * t) + 0.3 * np.sin(2 * np.pi * 110 * t)) \
        * (0.7 + 0.3 * np.sin(2 * np.pi * 0.25 * t))
    pad *= env_curve([0, 1.0, slen - 1.0, slen], [0, 1, 1, 0], n(slen)) * 0.12
    add(mix, pad, st[5])
    for k in range(int(slen / 1.6)):
        tt = st[5] + 0.8 + k * 1.6
        add(mix, beep(1760, 0.06, 0.12), tt)
        add(mix, beep(2349, 0.06, 0.10), tt + 0.11)
    add(mix, chime(0.4), at(5, 0.66))

    # sahna almashish "whoosh"lari (piksel o'tishli sahnalarda)
    for sc in (2, 4, 5):
        add(mix, whoosh(0.6, 0.35), st[sc] - 0.2)

    # yakun: muloyim so'nish, normallash
    mix *= np.clip((total - np.arange(L) / SR) / 0.6, 0, 1)
    mix = np.tanh(mix * 1.2)  # yumshoq cheklagich
    mix /= np.max(np.abs(mix)) / 0.89

    stereo = np.stack([mix, mix], axis=1)
    with wave.open(out_path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((stereo * 32767).astype(np.int16).tobytes())
    print('audio:', out_path, f'{total:.2f}s')


if __name__ == '__main__':
    main()
