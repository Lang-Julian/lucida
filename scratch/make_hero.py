"""
Render the README hero banner: the Lucida icon + wordmark + tagline on a deep
brand gradient, with subtle sketch->clean motifs. Reuses the generated icon.

Run: sidecar/.venv/bin/python scratch/make_hero.py   (after make_icon.py)
Outputs /tmp/lucida-hero.png (1600x520).
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

SCALE = 2
W, H = 1600 * SCALE, 520 * SCALE


def load_font(size, bold=False):
    for path, idx in [
        ("/System/Library/Fonts/Helvetica.ttc", 1 if bold else 0),
        ("/System/Library/Fonts/SFNS.ttf", 0),
        ("/Library/Fonts/Arial.ttf", 0),
    ]:
        try:
            return ImageFont.truetype(path, size, index=idx)
        except Exception:
            continue
    return ImageFont.load_default()


def diagonal_gradient(w, h, c0, c1):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    t = (xx / w * 0.6 + yy / h * 0.4)
    arr = np.empty((h, w, 4), dtype=np.uint8)
    for i in range(3):
        arr[..., i] = (c0[i] + (c1[i] - c0[i]) * t).astype(np.uint8)
    arr[..., 3] = 255
    return Image.fromarray(arr, "RGBA")


def four_point_star(cx, cy, r, waist):
    return [
        (cx, cy - r), (cx + waist, cy - waist), (cx + r, cy), (cx + waist, cy + waist),
        (cx, cy + r), (cx - waist, cy + waist), (cx - r, cy), (cx - waist, cy - waist),
    ]


def render():
    img = diagonal_gradient(W, H, (79, 70, 229), (124, 58, 237))  # indigo-600 -> violet-600

    # Soft decorative blobs (very low opacity) for depth.
    deco = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dd = ImageDraw.Draw(deco)
    dd.ellipse([W * 0.62, -H * 0.4, W * 1.15, H * 0.7], fill=(255, 255, 255, 14))
    dd.ellipse([W * 0.78, H * 0.45, W * 1.2, H * 1.3], fill=(255, 255, 255, 10))
    img = Image.alpha_composite(img, deco.filter(ImageFilter.GaussianBlur(40)))

    d = ImageDraw.Draw(img)
    white = (255, 255, 255, 255)

    # Subtle "sketch -> clean" motif on the right: a loose gray scribble that
    # resolves into a crisp circle, with a sparkle.
    cx, cy = W * 0.80, H * 0.52
    pts = []
    for i in range(140):
        a = (i / 140) * np.pi * 1.9
        wobble = 1.0 + (0.10 * np.sin(a * 5) if i < 70 else 0.0)
        r = 150 * SCALE * wobble
        pts.append((cx + np.cos(a) * r, cy + np.sin(a) * r))
    d.line(pts[:70], fill=(255, 255, 255, 70), width=5 * SCALE, joint="curve")
    d.arc([cx - 150 * SCALE, cy - 150 * SCALE, cx + 150 * SCALE, cy + 150 * SCALE],
          start=15, end=210, fill=(255, 255, 255, 235), width=7 * SCALE)
    d.polygon(four_point_star(cx + 150 * SCALE, cy - 130 * SCALE, 26 * SCALE, 6 * SCALE), fill=white)

    # Icon (reuse the generated master) with a soft shadow.
    icon = Image.open("/tmp/lucida-icon.png").convert("RGBA").resize((300 * SCALE, 300 * SCALE), Image.LANCZOS)
    ix, iy = int(W * 0.055), int(H / 2 - 150 * SCALE)
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    shadow.paste((0, 0, 0, 90), (ix + 6 * SCALE, iy + 12 * SCALE), icon.split()[3])
    img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(18)))
    img.paste(icon, (ix, iy), icon)
    d = ImageDraw.Draw(img)

    # Wordmark + tagline.
    tx = ix + 300 * SCALE + 56 * SCALE
    f_title = load_font(132 * SCALE // 1, bold=True)
    f_tag = load_font(34 * SCALE, bold=False)
    f_pill = load_font(26 * SCALE, bold=True)
    d.text((tx, H * 0.27), "Lucida", font=f_title, fill=white)
    d.text((tx + 4 * SCALE, H * 0.55), "A local-first AI smart whiteboard for the Mac.", font=f_tag, fill=(255, 255, 255, 235))

    # Feature pills, drawn on an alpha-composited overlay so the translucent
    # fill actually blends (plain ImageDraw on an RGBA image overwrites alpha,
    # which is why a direct draw would turn into a solid-white blob).
    pills = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    pd = ImageDraw.Draw(pills)
    px, py = tx + 4 * SCALE, int(H * 0.70)
    for label in ["Beautify", "Suggest", "100% on-device"]:
        bb = pd.textbbox((0, 0), label, font=f_pill)
        tw, th = bb[2] - bb[0], bb[3] - bb[1]
        pad = 20 * SCALE
        h_pill = th + 2 * pad
        pd.rounded_rectangle([px, py, px + tw + 2 * pad, py + h_pill], radius=h_pill // 2,
                             fill=(255, 255, 255, 50))
        pd.text((px + pad, py + pad - bb[1]), label, font=f_pill, fill=(255, 255, 255, 255))
        px += tw + 2 * pad + 18 * SCALE
    img = Image.alpha_composite(img, pills)

    out = img.convert("RGB").resize((1600, 520), Image.LANCZOS)
    out.save("/tmp/lucida-hero.png")
    print("wrote /tmp/lucida-hero.png")


if __name__ == "__main__":
    render()
