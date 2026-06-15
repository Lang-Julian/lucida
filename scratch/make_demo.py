"""
Render a UI preview of Lucida for the README's Demo section: a macOS window
showing the canvas with a small flow, the sketch->clean beautify, a dashed
"ghost" AI suggestion, and the glass AI panel. An illustration (not a pixel
screenshot) until a real screen recording is added.

Run: sidecar/.venv/bin/python scratch/make_demo.py
Outputs /tmp/lucida-demo.png (1440x900).
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

S = 2
W, H = 1440 * S, 900 * S

INK = (40, 41, 56)
MUTED = (140, 146, 166)
INDIGO = (99, 102, 241)
VIOLET = (139, 92, 246)
GREEN = (46, 196, 117)
LINE = (120, 124, 140)


def font(size, bold=False):
    for path, idx in [("/System/Library/Fonts/Helvetica.ttc", 1 if bold else 0),
                      ("/System/Library/Fonts/SFNS.ttf", 0)]:
        try:
            return ImageFont.truetype(path, size * S, index=idx)
        except Exception:
            continue
    return ImageFont.load_default()


def page_gradient():
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    t = (xx / W * 0.5 + yy / H * 0.5)
    c0, c1 = (236, 238, 248), (228, 226, 244)
    arr = np.empty((H, W, 4), np.uint8)
    for i in range(3):
        arr[..., i] = (c0[i] + (c1[i] - c0[i]) * t).astype(np.uint8)
    arr[..., 3] = 255
    return Image.fromarray(arr, "RGBA")


def shadow_rect(box, radius, blur, alpha):
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle(box, radius=radius, fill=(20, 20, 40, alpha))
    return sh.filter(ImageFilter.GaussianBlur(blur))


def center_text(d, cx, cy, text, fnt, fill):
    bb = d.textbbox((0, 0), text, font=fnt)
    d.text((cx - (bb[2] - bb[0]) / 2, cy - (bb[3] - bb[1]) / 2 - bb[1]), text, font=fnt, fill=fill)


def arrow(d, p0, p1, color, width, head=14 * S):
    d.line([p0, p1], fill=color, width=width)
    ang = np.arctan2(p1[1] - p0[1], p1[0] - p0[0])
    for s in (0.4, -0.4):
        d.line([p1, (p1[0] - head * np.cos(ang - s), p1[1] - head * np.sin(ang - s))], fill=color, width=width)


def dashed_line(d, p0, p1, color, width, dash=16 * S, gap=12 * S):
    length = np.hypot(p1[0] - p0[0], p1[1] - p0[1])
    n = int(length / (dash + gap))
    for i in range(n + 1):
        a = i * (dash + gap) / length
        b = min((i * (dash + gap) + dash) / length, 1.0)
        d.line([(p0[0] + (p1[0] - p0[0]) * a, p0[1] + (p1[1] - p0[1]) * a),
                (p0[0] + (p1[0] - p0[0]) * b, p0[1] + (p1[1] - p0[1]) * b)], fill=color, width=width)


def node(d, cx, cy, w, h, label, fill, stroke, text_fill, dashed=False, radius=16 * S, sw=4 * S):
    box = [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2]
    if dashed:
        d.rounded_rectangle(box, radius=radius, fill=fill)
        for edge in [((box[0], box[1]), (box[2], box[1])), ((box[2], box[1]), (box[2], box[3])),
                     ((box[2], box[3]), (box[0], box[3])), ((box[0], box[3]), (box[0], box[1]))]:
            dashed_line(d, edge[0], edge[1], stroke, sw)
    else:
        d.rounded_rectangle(box, radius=radius, fill=fill, outline=stroke, width=sw)
    center_text(d, cx, cy, label, font(20, bold=True), text_fill)


def render():
    img = page_gradient()

    # Window card.
    card = [40 * S, 28 * S, 1400 * S, 872 * S]
    img = Image.alpha_composite(img, shadow_rect([card[0], card[1] + 10 * S, card[2], card[3] + 18 * S], 22 * S, 30, 70))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(card, radius=22 * S, fill=(252, 252, 254, 255))
    # Title bar.
    d.rounded_rectangle([card[0], card[1], card[2], card[1] + 52 * S], radius=22 * S, fill=(244, 245, 249, 255))
    d.rectangle([card[0], card[1] + 30 * S, card[2], card[1] + 52 * S], fill=(244, 245, 249, 255))
    for i, c in enumerate([(255, 95, 87), (254, 188, 46), (40, 200, 64)]):
        cx = card[0] + (30 + i * 26) * S
        d.ellipse([cx, card[1] + 19 * S, cx + 14 * S, card[1] + 33 * S], fill=c)
    center_text(d, (card[0] + card[2]) / 2, card[1] + 26 * S, "Lucida", font(17, bold=True), MUTED)

    # Faint dot grid on the canvas.
    for gx in range(int(card[0]) + 60 * S, int(card[2]) - 20 * S, 40 * S):
        for gy in range(int(card[1]) + 90 * S, int(card[3]) - 20 * S, 40 * S):
            d.ellipse([gx, gy, gx + 2 * S, gy + 2 * S], fill=(225, 227, 235))

    cy = 300 * S
    # Flow: Idea -> Sketch -> Ship.
    xs = [200 * S, 470 * S, 740 * S]
    for i in range(2):
        arrow(d, (xs[i] + 85 * S, cy), (xs[i + 1] - 85 * S, cy), LINE, 4 * S)
    node(d, xs[0], cy, 160 * S, 74 * S, "Idea", (238, 240, 253, 255), INDIGO, INK)
    node(d, xs[1], cy, 160 * S, 74 * S, "Sketch", (238, 240, 253, 255), INDIGO, INK)
    node(d, xs[2], cy, 160 * S, 74 * S, "Ship", (238, 240, 253, 255), INDIGO, INK)

    # Ghost AI suggestion below Ship.
    gy = 470 * S
    dashed_line(d, (xs[2], cy + 37 * S), (xs[2], gy - 37 * S), VIOLET, 4 * S)
    arrow(d, (xs[2], gy - 60 * S), (xs[2], gy - 37 * S), VIOLET, 4 * S)
    node(d, xs[2], gy, 160 * S, 74 * S, "Deploy", (245, 243, 255, 255), VIOLET, VIOLET, dashed=True)
    chip = [xs[2] + 95 * S, gy - 22 * S, xs[2] + 340 * S, gy + 22 * S]
    d.rounded_rectangle(chip, radius=22 * S, fill=(245, 243, 255, 255), outline=(225, 220, 250), width=2 * S)
    center_text(d, (chip[0] + chip[2]) / 2, gy, "AI · accept or dismiss", font(15, bold=True), VIOLET)

    # Beautify before -> after (bottom-left).
    by = 600 * S
    bx = 230 * S
    pts = [(bx + 60 * S * np.cos(a) * (1 + 0.12 * np.sin(a * 5)),
            by + 60 * S * np.sin(a) * (1 + 0.12 * np.sin(a * 6))) for a in np.linspace(0, 2 * np.pi, 80)]
    d.line(pts, fill=(190, 193, 205), width=4 * S, joint="curve")
    arrow(d, (bx + 95 * S, by), (bx + 175 * S, by), MUTED, 4 * S)
    d.ellipse([bx + 200 * S, by - 60 * S, bx + 320 * S, by + 60 * S], outline=INDIGO, width=6 * S)
    d.polygon([(bx + 330 * S, by - 70 * S), (bx + 337 * S, by - 50 * S), (bx + 357 * S, by - 43 * S),
               (bx + 337 * S, by - 36 * S), (bx + 330 * S, by - 16 * S), (bx + 323 * S, by - 36 * S),
               (bx + 303 * S, by - 43 * S), (bx + 323 * S, by - 50 * S)], fill=VIOLET)
    center_text(d, bx, by + 95 * S, "freehand", font(15, bold=True), MUTED)
    center_text(d, bx + 260 * S, by + 95 * S, "beautified", font(15, bold=True), INDIGO)

    # Glass AI panel (top-right).
    panel = [1150 * S, 96 * S, 1372 * S, 372 * S]
    img = Image.alpha_composite(img, shadow_rect([panel[0], panel[1] + 8 * S, panel[2], panel[3] + 14 * S], 18 * S, 22, 55))
    glass = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(glass).rounded_rectangle(panel, radius=18 * S, fill=(255, 255, 255, 230), outline=(225, 227, 238, 255), width=2 * S)
    img = Image.alpha_composite(img, glass)
    d = ImageDraw.Draw(img)
    px = panel[0] + 22 * S
    d.text((px, panel[1] + 18 * S), "Lucida", font=font(18, bold=True), fill=INK)
    d.ellipse([px, panel[1] + 58 * S, px + 14 * S, panel[1] + 72 * S], fill=GREEN)
    d.text((px + 24 * S, panel[1] + 54 * S), "Ready", font=font(14, bold=True), fill=INK)
    d.text((px + 90 * S, panel[1] + 55 * S), "Qwen2.5-3B", font=font(13), fill=MUTED)
    # Auto-beautify switch (on).
    d.text((px, panel[1] + 104 * S), "Auto-beautify", font=font(15), fill=INK)
    sw_box = [panel[2] - 70 * S, panel[1] + 100 * S, panel[2] - 22 * S, panel[1] + 128 * S]
    d.rounded_rectangle(sw_box, radius=14 * S, fill=INDIGO)
    d.ellipse([sw_box[2] - 26 * S, sw_box[1] + 2 * S, sw_box[2] - 2 * S, sw_box[3] - 2 * S], fill=(255, 255, 255))
    # Intent input.
    inp = [px, panel[1] + 150 * S, panel[2] - 22 * S, panel[1] + 190 * S]
    d.rounded_rectangle(inp, radius=10 * S, fill=(247, 248, 251), outline=(225, 227, 238), width=2 * S)
    d.text((inp[0] + 14 * S, inp[1] + 11 * S), "Describe your idea…", font=font(14), fill=MUTED)
    # Suggest button.
    btn = [px, panel[1] + 206 * S, panel[2] - 22 * S, panel[1] + 250 * S]
    grad = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grad)
    bw = btn[2] - btn[0]
    for i in range(int(bw)):
        c = tuple(int(INDIGO[k] + (VIOLET[k] - INDIGO[k]) * i / bw) for k in range(3))
        gd.line([(btn[0] + i, btn[1]), (btn[0] + i, btn[3])], fill=c + (255,))
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).rounded_rectangle(btn, radius=12 * S, fill=255)
    img.paste(grad, (0, 0), mask)
    d = ImageDraw.Draw(img)
    center_text(d, (btn[0] + btn[2]) / 2, (btn[1] + btn[3]) / 2, "Suggest next", font(16, bold=True), (255, 255, 255))

    img.convert("RGB").resize((1440, 900), Image.LANCZOS).save("/tmp/lucida-demo.png")
    print("wrote /tmp/lucida-demo.png")


if __name__ == "__main__":
    render()
