"""Cuts the README media out of docs/media/raw (written by capture.mjs).

  python3 scripts/media/build.py

Writes docs/media/: launch.mp4 (20 s, captioned), launch.gif (the same, for the README),
tour.mp4 (the whole recording) and the screenshots. Needs ffmpeg and Pillow.
"""
import glob
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "docs/media/raw"
OUT = ROOT / "docs/media"
TMP = RAW / "tmp"
TMP.mkdir(exist_ok=True)
W, H = 1280, 720
FONT = next(p for p in ["/System/Library/Fonts/Helvetica.ttc", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"] if Path(p).exists())
video = glob.glob(str(RAW / "*.webm"))[0]


def run(*args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *map(str, args)], check=True)


def caption(text, path):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    f = ImageFont.truetype(FONT, 34)
    w = d.textlength(text, font=f)
    x0, y0 = (W - w) / 2 - 28, H - 120
    d.rounded_rectangle([x0, y0, x0 + w + 56, y0 + 66], radius=18, fill=(20, 24, 40, 215))
    d.text((x0 + 28, y0 + 13), text, font=f, fill=(255, 255, 255, 255))
    img.save(path)


def end_card(path):
    img = Image.new("RGB", (W, H), (24, 28, 48))
    d = ImageDraw.Draw(img)
    big, mid, small = (ImageFont.truetype(FONT, s) for s in (74, 38, 30))
    for y, t, f, c in [
        (230, "Agent Office: Parth's edition", big, (255, 255, 255)),
        (350, "A fork with a city, driving, a race track and an arena", mid, (190, 200, 230)),
        (450, "github.com/Ps23102004/agent-office", mid, (255, 214, 102)),
        (520, "Fork of AgentSystemLabs/agent-office (MIT)  ·  625 tests", small, (150, 160, 190)),
    ]:
        d.text(((W - d.textlength(t, font=f)) / 2, y), t, font=f, fill=c)
    img.save(path)


# (start second in the recording, length, caption)
SCENES = [
    (8.0, 3.5, "Agent Office: a 3D office for coding agents (my fork)"),
    (18.0, 5.0, "I added a city with traffic and driving physics"),
    (33.0, 7.5, "A race track with bots, laps and sector splits"),
    (51.0, 2.5, "An arena with server-side bots"),
]
parts = []
for i, (ss, ln, text) in enumerate(SCENES):
    cap = TMP / f"cap{i}.png"
    caption(text, cap)
    part = TMP / f"part{i}.mp4"
    run("-ss", ss, "-t", ln, "-i", video, "-i", cap,
        "-filter_complex", f"[0]fps=25,scale={W}:{H}[v];[v][1]overlay=0:0", "-an",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "27", part)
    parts.append(part)
card = TMP / "card.png"
end_card(card)
cardv = TMP / "card.mp4"
run("-loop", 1, "-t", 1.5, "-i", card, "-vf", "fps=25", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "23", cardv)
parts.append(cardv)
listing = TMP / "list.txt"
listing.write_text("".join(f"file '{p}'\n" for p in parts))
run("-f", "concat", "-safe", 0, "-i", listing, "-c", "copy", OUT / "launch.mp4")

# GIF for the README: 10 fps, 720 wide, one shared palette
pal = TMP / "pal.png"
run("-i", OUT / "launch.mp4", "-vf", "fps=8,scale=560:-1:flags=lanczos,palettegen=max_colors=64", pal)
run("-i", OUT / "launch.mp4", "-i", pal, "-filter_complex", "fps=8,scale=560:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4", OUT / "launch.gif")

# The whole recording, past the loading screen
run("-ss", 3.5, "-i", video, "-vf", "fps=25,scale=960:-2", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "31", OUT / "tour.mp4")

for src, dst in [("01-office", "office"), ("02-office-floor", "office-floor"), ("03-city-drive", "city"), ("04-circuit", "circuit"), ("05-circuit-corner", "circuit-corner"), ("06-arena", "arena")]:
    shutil.copy(RAW / f"{src}.png", OUT / f"{dst}.png")
print({p.name: round(p.stat().st_size / 1e6, 2) for p in sorted(OUT.glob("*")) if p.is_file()})
