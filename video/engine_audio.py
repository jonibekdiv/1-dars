"""'Inside a Rocket Engine' videosi uchun musiqa + SFX (diktorsiz).

Ishlatish: python3 engine_audio.py "[4, 8, 6, 6, 6, 6, 6, 8, 6]" chiqish.wav
Musiqa 120 BPM (1 takt = 2 s); sahnalar takt chegarasida almashadi, shuning uchun
musiqa bo'limlari (intro -> groove -> build -> DROP -> outro) sahnalarga mos tushadi.
"""
import json
import sys
import wave

import numpy as np
from scipy.signal import butter, sosfilt

SR = 44100
BPM = 120
BEAT = 60 / BPM
BAR = BEAT * 4
rng = np.random.default_rng(7)


def n(sec):
    return int(SR * sec)


def filt(x, kind, f, order=2):
    return sosfilt(butter(order, f, kind, fs=SR, output='sos'), x)


def noise(sec):
    return rng.standard_normal(n(sec))


def mtof(m):
    return 440 * 2 ** ((m - 69) / 12)


def add(buf, sig, at, gain=1.0):
    i = n(at)
    if i >= len(buf):
        return
    sig = sig[: len(buf) - i]
    buf[i:i + len(sig)] += sig * gain


def adsr(length, a=0.005, d=0.1, s=0.6, r=0.05):
    t = np.arange(length) / SR
    dur = length / SR
    e = np.where(t < a, t / a, np.where(t < a + d, 1 - (1 - s) * (t - a) / d, s))
    return e * np.clip((dur - t) / r, 0, 1)


# ---------- asboblar ----------
def osc(kind, f, sec, duty=0.5, vib=0.0):
    t = np.arange(n(sec)) / SR
    ph = np.cumsum(f * (1 + vib * np.sin(2 * np.pi * 5.5 * t) * np.clip(t / 0.2, 0, 1))) / SR
    if kind == 'saw':
        return 2 * (ph % 1) - 1
    if kind == 'pulse':
        return np.where((ph % 1) < duty, 1.0, -1.0)
    if kind == 'tri':
        return 2 * np.abs(2 * (ph % 1) - 1) - 1
    return np.sin(2 * np.pi * ph)


def kick():
    t = np.arange(n(0.35)) / SR
    f = 50 + 110 * np.exp(-t * 35)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9) * 1.0


def snare():
    t = np.arange(n(0.25)) / SR
    return (filt(noise(0.25), 'high', 1200) * 0.7 + np.sin(2 * np.pi * 190 * t) * 0.5) * np.exp(-t * 18)


def hat(open_=False):
    sec = 0.18 if open_ else 0.05
    t = np.arange(n(sec)) / SR
    return filt(noise(sec), 'high', 7000) * np.exp(-t * (14 if open_ else 70)) * 0.5


def crash():
    t = np.arange(n(2.0)) / SR
    return filt(noise(2.0), 'high', 4000) * np.exp(-t * 2.2) * 0.45


def bass_note(m, sec):
    x = osc('saw', mtof(m), sec) * 0.6 + osc('pulse', mtof(m - 12), sec, 0.5) * 0.4
    return x * adsr(n(sec), 0.004, 0.12, 0.7, 0.03)


def arp_note(m, sec):
    return osc('pulse', mtof(m), sec, 0.25) * adsr(n(sec), 0.002, 0.08, 0.25, 0.02)


def lead_note(m, sec):
    x = osc('pulse', mtof(m), sec, 0.5, vib=0.006) * 0.7 + osc('saw', mtof(m) * 1.003, sec) * 0.3
    return x * adsr(n(sec), 0.01, 0.15, 0.7, 0.06)


def pad_chord(ms, sec):
    out = np.zeros(n(sec))
    for m in ms:
        for det in (-0.004, 0.004):
            out += osc('saw', mtof(m) * (1 + det), sec)
    return out * adsr(n(sec), 0.4, 0.3, 0.8, 0.5) / (len(ms) * 2)


def riser(sec):
    t = np.arange(n(sec)) / SR
    k = t / sec
    x = noise(sec)
    lo = filt(x, 'band', [400, 1500]); hi = filt(x, 'band', [2500, 8000])
    sweep = np.sin(2 * np.pi * np.cumsum(200 + 1800 * k ** 2) / SR) * 0.25
    return ((lo * (1 - k) + hi * k) * 0.6 + sweep) * k ** 2


def echo(x, delay, fb=0.35, mix=0.35):
    d = n(delay)
    y = x.copy()
    for k in range(1, 5):
        y[d * k:] += x[:-d * k] * (fb ** k) * mix / 0.35
    return y


# ---------- kompozitsiya ----------
CHORDS = [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]]   # Am  F  C  G
ROOTS = [45, 41, 48, 43]
MELODY = [  # 8-lik notalar, -1 = pauza (8 takt)
    [76, -1, 76, 74, 72, -1, 74, 76], [77, -1, 76, 74, 72, -1, 69, -1],
    [72, -1, 74, 76, 79, -1, 76, -1], [74, -1, 71, -1, 74, 76, 74, -1],
    [76, -1, 76, 74, 72, -1, 74, 76], [77, -1, 79, 77, 76, -1, 74, 72],
    [76, -1, 72, -1, 79, -1, 76, 74], [71, 74, 79, -1, 79, -1, -1, -1]]


def music(total, scene_bars):
    """scene_bars: har sahna boshlanadigan takt raqami."""
    L = n(total)
    drums = np.zeros(L); bass = np.zeros(L); arp = np.zeros(L); lead = np.zeros(L); pad = np.zeros(L); fx = np.zeros(L)
    bars = int(round(total / BAR))
    sb = scene_bars
    groove_from, build_from, drop_from, drop_to, outro_from = sb[1], sb[4], sb[6], sb[8], sb[8]
    for b in range(bars):
        t0 = b * BAR
        ch, root = CHORDS[b % 4], ROOTS[b % 4]
        intro, outro = b < groove_from, b >= outro_from
        drop = drop_from <= b < drop_to
        build = build_from <= b < drop_from
        add(pad, pad_chord([m + 12 for m in ch], BAR), t0, 1.0 if (intro or outro) else 0.5)
        # arpejio (16-lik)
        pat = [0, 1, 2, 1] if not drop else [0, 1, 2, 3]
        for s in range(16):
            notes = ch + [ch[0] + 12]
            m = notes[pat[s % 4]] + 12 + (12 if (drop and s % 8 >= 4) else 0)
            add(arp, arp_note(m, BEAT / 4 * 0.9), t0 + s * BEAT / 4, 0.55 if not intro else 0.35)
        if intro:
            continue
        # bas
        for e in range(8):
            if drop:
                m = root if e % 2 == 0 else root + 12
            elif outro:
                m = root if e == 0 else None
            else:
                m = root if e not in (3, 7) else root + 7
            if m is not None:
                add(bass, bass_note(m, BEAT / 2 * 0.92), t0 + e * BEAT / 2)
        if outro:
            continue
        # zarbli asboblar
        for q in range(4):
            if drop or q in (0, 2) or (build and q == 3):
                add(drums, kick(), t0 + q * BEAT)
            if (q in (1, 3)) and b >= sb[3]:
                add(drums, snare(), t0 + q * BEAT, 0.8)
        for e in range(8):
            add(drums, hat(open_=drop and e % 2 == 1), t0 + e * BEAT / 2, 0.6 if e % 2 else 0.35)
        # dropdan oldingi takt: snare "roll" va riser
        if b == drop_from - 1:
            for s in range(16):
                add(drums, snare(), t0 + s * BEAT / 4, 0.25 + 0.6 * s / 16)
            add(fx, riser(BAR), t0, 0.8)
        if b == drop_from or b == drop_from + 4:
            add(drums, crash(), t0)
        # melodiya: build va drop da
        if build or drop:
            row = MELODY[(b - build_from) % 8]
            for e, m in enumerate(row):
                if m > 0:
                    length = BEAT / 2
                    k = e + 1
                    while k < 8 and row[k] == -1:
                        length += BEAT / 2; k += 1
                    add(lead, lead_note(m + (12 if drop else 0), min(length, BEAT * 1.5) * 0.95), t0 + e * BEAT / 2, 0.9 if drop else 0.6)
    # yakuniy akkord
    add(pad, pad_chord([69, 72, 76, 81], BAR * 1.5), (bars - 1) * BAR, 1.2)

    bass = filt(bass, 'low', 900)
    pad = filt(pad, 'low', 2500)
    arp = echo(filt(arp, 'low', 6000), BEAT * 0.75)
    lead = echo(lead, BEAT * 0.75, 0.3, 0.3)
    # "sidechain": bochka zarbida boshqa asboblar biroz pasayadi
    sc = np.ones(L)
    kt = np.arange(n(0.25)) / SR
    duck = 1 - 0.45 * np.exp(-kt * 14)
    for b in range(bars):
        if drop_from <= b < drop_to:
            for q in range(4):
                i = n(b * BAR + q * BEAT); sc[i:i + len(duck)] = np.minimum(sc[i:i + len(duck)], duck[: L - i])
    return drums * 0.55 + (bass * 0.42 + arp * 0.16 + lead * 0.2 + pad * 0.2) * sc + fx * 0.3


# ---------- SFX ----------
def boom(sec=2.0, vol=1.0):
    t = np.arange(n(sec)) / SR
    sub = np.sin(2 * np.pi * np.cumsum(70 * np.exp(-t * 1.5) + 30) / SR) * np.exp(-t * 2.5)
    return (sub * 0.9 + filt(noise(sec), 'low', 900) * np.exp(-t * 5) * 0.8) * vol


def bang(vol=1.0):
    sec = 1.4
    t = np.arange(n(sec)) / SR
    ring = (np.sin(2 * np.pi * 610 * t) + 0.6 * np.sin(2 * np.pi * 947 * t)) * np.exp(-t * 4) * 0.25
    return (filt(noise(sec), 'high', 1500) * np.exp(-t * 40) + np.sin(2 * np.pi * 55 * t) * np.exp(-t * 8) + ring) * vol


def blip(f=1200, sec=0.07, vol=0.25):
    t = np.arange(n(sec)) / SR
    return np.sign(np.sin(2 * np.pi * f * t)) * np.exp(-t * 30) * vol


def roar(sec, vol=1.0):
    x = filt(noise(sec), 'low', 320, 4) * 2.2 + filt(noise(sec), 'low', 90, 4) * 3.5
    crack = np.zeros(n(sec))
    idx = rng.choice(n(sec), size=int(sec * 220), replace=False)
    crack[idx] = rng.standard_normal(len(idx))
    x = x + filt(crack, 'band', [800, 5000]) * 2.0
    x /= np.percentile(np.abs(x), 99.5) + 1e-9
    return x * vol


def gurgle(sec, vol=0.3):
    out = np.zeros(n(sec))
    for k in range(int(sec * 9)):
        f0 = 300 + rng.random() * 500
        d = 0.05 + rng.random() * 0.05
        t = np.arange(n(d)) / SR
        add(out, np.sin(2 * np.pi * np.cumsum(f0 + 1500 * t / d) / SR) * np.exp(-t * 40), rng.random() * (sec - d))
    return out * vol


def whine(sec, f0, f1, vol=0.2):
    t = np.arange(n(sec)) / SR
    f = f0 + (f1 - f0) * (t / sec) ** 2
    ph = np.cumsum(f) / SR
    return (np.sin(2 * np.pi * ph) + 0.4 * np.sin(4 * np.pi * ph) + 0.2 * np.sin(6 * np.pi * ph)) * vol


def chime(vol=0.35):
    out = np.zeros(n(2.0))
    for i, m in enumerate([72, 76, 79, 84]):
        t = np.arange(n(1.5)) / SR
        add(out, np.sin(2 * np.pi * mtof(m) * t) * np.exp(-t * 2.5), i * 0.09)
    return out * vol


def whoosh(sec=0.6, vol=0.35):
    t = np.arange(n(sec)) / SR
    k = t / sec
    x = noise(sec)
    return (filt(x, 'band', [300, 1200]) * (1 - k) + filt(x, 'band', [1500, 5000]) * k) * np.sin(np.pi * k) ** 2 * vol


def main():
    durs = json.loads(sys.argv[1])
    out_path = sys.argv[2]
    total = sum(durs)
    st = np.cumsum([0] + durs[:-1])
    L = n(total)

    def at(sc, p):
        return st[sc] + durs[sc] * p

    mus = music(total, [int(round(s / BAR)) for s in st])
    sfx = np.zeros(L)
    # 0: shamol + lupa "ding"
    sfx += filt(noise(total), 'low', 500) * 0.04 * np.interp(np.arange(L) / SR, [0, st[1], st[1] + 1, total], [1, 1, 0, 0])
    add(sfx, blip(1600, 0.12, 0.25), at(0, 0.47))
    # 1: skaner va har bir yorliq uchun "blip"
    add(sfx, whine(1.3, 300, 1400, 0.12), st[1])
    for i in range(7):
        add(sfx, blip(900 + i * 110), at(1, 0.2 + i * 0.085))
    # 2: suyuqlik oqishi, kislorod bug'i
    add(sfx, gurgle(durs[2] + durs[3], 0.25), st[2])
    add(sfx, filt(noise(durs[2]), 'high', 5000) * 0.05, st[2])
    # 3: turbonasos aylanib tezlashadi
    add(sfx, whine(durs[3] + 0.1, 120, 1900, 0.16), st[3])
    add(sfx, whine(durs[4] + durs[5], 1900, 1900, 0.07), st[4])
    # 4: yonish — "vuf" va guvillash; 5: kuchliroq
    ign = at(4, 0.1)
    add(sfx, boom(2.2, 0.9), ign)
    rl = st[6] + durs[6] * 0.52 - ign
    r = roar(rl)
    r *= np.interp(np.arange(len(r)) / SR, [0, 0.3, st[5] - ign, st[5] - ign + 0.5, rl - 0.1, rl], [0, 0.45, 0.45, 0.75, 0.75, 0])
    add(sfx, r, ign)
    add(sfx, whoosh(0.8, 0.4), at(5, 0.3))
    # 6: boosterlar va 1-bosqich ajraladi, 2-dvigatel yonadi
    add(sfx, bang(0.85), at(6, 0.17))
    add(sfx, bang(0.85), at(6, 0.54))
    add(sfx, boom(1.0, 0.4), at(6, 0.66))
    l2 = st[7] + durs[7] * 0.44 - at(6, 0.66)
    hiss = filt(noise(l2), 'band', [1800, 6500]) * 0.1 + filt(noise(l2), 'low', 200) * 0.18
    hiss *= np.interp(np.arange(len(hiss)) / SR, [0, 0.3, l2 - 0.2, l2], [0, 1, 1, 0])
    add(sfx, hiss, at(6, 0.66))
    # 7: fairing (yengil portlash), ajralish "klak", panellar ochilishi, muvaffaqiyat
    add(sfx, bang(0.5), at(7, 0.14))
    add(sfx, blip(300, 0.15, 0.35), at(7, 0.46))
    add(sfx, whine(durs[7] * 0.2, 400, 700, 0.06), at(7, 0.66))
    add(sfx, chime(0.4), at(7, 0.86))
    # 8: radio signallari, yakuniy blip
    for k in range(3):
        add(sfx, blip(1760, 0.06, 0.12), st[8] + 0.6 + k * 1.6)
        add(sfx, blip(2349, 0.06, 0.1), st[8] + 0.71 + k * 1.6)
    add(sfx, blip(1300, 0.1, 0.3), at(8, 0.15))
    for sc in (2, 6, 7, 8):
        add(sfx, whoosh(0.6, 0.3), st[sc] - 0.2)

    mix = mus * 0.8 + sfx * 0.75
    mix *= np.clip((total - np.arange(L) / SR) / 0.8, 0, 1)
    mix = np.tanh(mix * 1.1)
    mix /= np.max(np.abs(mix)) / 0.89
    stereo = np.stack([mix, mix], axis=1)
    with wave.open(out_path, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((stereo * 32767).astype(np.int16).tobytes())
    print('audio:', out_path, f'{total:.2f}s')


if __name__ == '__main__':
    main()
