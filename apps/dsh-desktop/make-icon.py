#!/usr/bin/env python3
"""Generate the DSH desktop app icon (512x512 PNG) into assets/icon.png."""
import os
from PIL import Image, ImageDraw, ImageFont

SIZE = 512
BG_TOP = (38, 68, 220)     # deep blue
BG_BOTTOM = (16, 22, 48)   # dark navy
RADIUS = 112

img = Image.new("RGB", (SIZE, SIZE), (0, 0, 0))
draw = ImageDraw.Draw(img, "RGBA")
# vertical gradient
for y in range(SIZE):
    t = y / (SIZE - 1)
    r = int(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t)
    g = int(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t)
    b = int(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t)
    draw.line([(0, y), (SIZE, y)], fill=(r, g, b))
# rounded-rect mask
mask = Image.new("L", (SIZE, SIZE), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=RADIUS, fill=255)
out = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
out.paste(img, (0, 0), mask)
draw = ImageDraw.Draw(out)
# subtle inner highlight ring
draw.rounded_rectangle([6, 6, SIZE - 7, SIZE - 7], radius=RADIUS - 6,
                       outline=(255, 255, 255, 28), width=3)
# "DSH" monogram
font = None
for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
          "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
    if os.path.exists(p):
        font = ImageFont.truetype(p, 150)
        break
if font is None:
    font = ImageFont.load_default()
text = "DSH"
bbox = draw.textbbox((0, 0), text, font=font)
tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
draw.text(((SIZE - tw) / 2 - bbox[0], (SIZE - th) / 2 - bbox[1] - 8),
          text, font=font, fill=(255, 255, 255, 255))
# small spark dot under the text
cx, cy = SIZE // 2, SIZE // 2 + 118
draw.ellipse([cx - 10, cy - 10, cx + 10, cy + 10], fill=(120, 200, 255, 255))
os.makedirs("assets", exist_ok=True)
out.save("assets/icon.png")
print("wrote assets/icon.png", out.size)
