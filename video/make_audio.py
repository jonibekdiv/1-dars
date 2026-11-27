"""Video uchun ovoz yo'lagini yasaydi: chiptune fon musiqasi + effektlar + diktor ovozi.

Ishlatish: python3 make_audio.py <durations_json> <chiqish.wav>
durations_json — sahna davomiyliklari ro'yxati, masalan "[7.2, 9.4, ...]".
Diktor fayllari: audio/vo0.mp3 ... audio/vo5.mp3 (har sahna boshidan VO_DELAY soniya keyin boshlanadi).
"""
import json
import os
import subprocess
import sys
import wave

import numpy as np

SR = 44100
VO_DELAY = 0.35
HERE = os.path.dirname(os.path.abspath(__file__))


def tone(freq, dur, kind="square", vol=1.0):
    t = np.arange(int(SR * dur)) / SR
    if kind == "square":
        w = np.sign(np.sin(2 * np.pi * freq * t)) * 0.6
    elif kind == "tri":
        w = 2 * np.abs(2 * ((t * freq) % 1) - 1) - 1
    else:
        w = np.sin(2 * np.pi * freq * t)
    env = np.minimum(1, t / 0.005) * np.exp(-t * 6)
    return w * env * vol


def add(buf, sig, at):
    i = int(at * SR)
    if i >= len(buf):
        return
    sig = sig[: len(buf) - i]
    buf[i:i + len(sig)] += sig


def midi(n):
    return 440 * 2 ** ((n - 69) / 12)


def music(total):
    buf = np.zeros(int(SR * total))
    bpm = 112
    step = 60 / bpm / 4  # 16-lik nota
    chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]  # Am F C G
    n_steps = int(total / step)
    rng = np.random.default_rng(1)
    for s in range(n_steps):
        t = s * step
        chord = chords[(s // 16) % 4]
        note = chord[[0, 1, 2, 1][s % 4]] + 12 + (12 if (s // 4) % 2 else 0)
        add(buf, tone(midi(note), step * 0.9, "square", 0.10), t)
        if s % 4 == 0:  # bas
            add(buf, tone(midi(chord[0] - 12), step * 3.5, "tri", 0.30), t)
        if s % 2 == 1:  # hi-hat
            n = rng.standard_normal(int(SR * 0.03)) * np.exp(-np.arange(int(SR * 0.03)) / SR * 120)
            add(buf, n * 0.04, t)
        if s % 8 == 4:  # snare
            n = rng.standard_normal(int(SR * 0.12)) * np.exp(-np.arange(int(SR * 0.12)) / SR * 30)
            add(buf, n * 0.08, t)
    return buf


def whoosh(dur=0.45):
    rng = np.random.default_rng(7)
    n = rng.standard_normal(int(SR * dur))
    # oddiy past chastotali filtr, chastotasi asta-sekin oshadi
    out = np.zeros_like(n)
    y = 0.0
    for i, x in enumerate(n):
        k = 0.02 + 0.25 * (i / len(n))
        y += k * (x - y)
        out[i] = y
    env = np.sin(np.pi * np.arange(len(n)) / len(n)) ** 2
    return out * env * 0.9


def pop():
    t = np.arange(int(SR * 0.12)) / SR
    f = 400 + 1400 * t / 0.12
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 25) * 0.35


def click():
    t = np.arange(int(SR * 0.02)) / SR
    return np.sign(np.sin(2 * np.pi * 1800 * t)) * np.exp(-t * 300) * 0.15


def ding():
    return tone(midi(84), 0.8, "sine", 0.35) + tone(midi(91), 0.8, "sine", 0.2)


def load_mp3(path):
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


def main():
    durs = json.loads(sys.argv[1])
    out_path = sys.argv[2]
    total = sum(durs)
    starts = np.cumsum([0] + durs[:-1])

    mus = music(total)
    sfx = np.zeros_like(mus)
    vo = np.zeros_like(mus)

    for i, (s, d) in enumerate(zip(starts, durs)):
        if i > 0:
            add(sfx, whoosh(), s - 0.1)
        path = os.path.join(HERE, "audio", f"vo{i}.mp3")
        if os.path.exists(path):
            add(vo, load_mp3(path), s + VO_DELAY)
    d0 = durs[0]
    for k in range(10):  # "google.com" yozilishi
        add(sfx, click(), d0 * (0.25 + 0.37 * k / 10))
    add(sfx, pop(), d0 * 0.72)                      # Paket paydo bo'ladi
    add(sfx, pop(), starts[1] + durs[1] * 0.4)      # routerga yetdi
    add(sfx, ding(), starts[2] + durs[2] * 0.55)    # IP topildi
    for k in range(6):                              # serverdan paketlar
        add(sfx, pop() * 0.6, starts[4] + durs[4] * (0.42 + k * 0.03))
    for k in range(9):                              # sahifa bloklari
        add(sfx, pop() * 0.5, starts[5] + durs[5] * (0.14 + k * 0.065))
    add(sfx, ding(), starts[5] + durs[5] * 0.72)    # TOTAL: 0.3 SEC

    # diktor gapirganda musiqani pasaytirish (ducking)
    env = np.abs(vo)
    win = int(SR * 0.25)
    env = np.convolve(env, np.ones(win) / win, mode="same")
    duck = 1 - 0.6 * np.clip(env / 0.03, 0, 1)
    mix = mus * 0.55 * duck + sfx * 0.7 + vo * 1.0
    # oxirida musiqa so'nadi
    fade = np.clip((total - np.arange(len(mix)) / SR) / 1.0, 0, 1)
    mix *= fade
    mix /= max(1e-9, np.max(np.abs(mix))) / 0.9

    with wave.open(out_path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((mix * 32767).astype(np.int16).tobytes())
    print("audio:", out_path, f"{total:.2f}s")


if __name__ == "__main__":
    main()
