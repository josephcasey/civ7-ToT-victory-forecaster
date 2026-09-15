#!/usr/bin/env python3
"""Generate the Steam Workshop preview image for ToT Victory Forecaster.

The preview has to sell what the mod actually does in one glance: a leaderboard
score gone red, and the arithmetic that explains why. So it renders a cut-down
mock of the real Victories card plus the tooltip section the mod injects.

Steam requires JPG/PNG/GIF under 1 MB. Output is a ~640x640 PNG well inside that.
Run: python3 scripts/gen_preview.py
"""
import os
from PIL import Image, ImageDraw, ImageFont

W = H = 640
OUT = os.path.join(os.path.dirname(__file__), '..', 'preview.png')

BG        = (14, 18, 26)
CARD      = (26, 22, 38)
CARD_EDGE = (74, 58, 104)
TIP_BG    = (22, 27, 38)
GOLD      = (201, 162, 39)
GOLD_DIM  = (150, 122, 40)
WHITE     = (238, 240, 245)
GREY      = (150, 158, 172)
DIM       = (104, 112, 128)
RED       = (255, 90, 90)
CULT      = (196, 132, 232)

F = '/System/Library/Fonts/Supplemental/'
def font(name, size):
    for p in (F + name, '/System/Library/Fonts/Helvetica.ttc'):
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            continue
    return ImageFont.load_default()

f_title   = font('Georgia Bold.ttf', 40)
f_sub     = font('Georgia.ttf', 19)
f_card    = font('Georgia Bold.ttf', 25)
f_label   = font('Georgia Bold.ttf', 15)
f_row     = font('Georgia.ttf', 17)
f_num     = font('Georgia Bold.ttf', 19)
f_tiphead = font('Georgia Bold.ttf', 14)
f_calc    = font('Georgia.ttf', 15)
f_warn    = font('Georgia Bold.ttf', 15)
f_foot    = font('Georgia Italic.ttf', 15)

img = Image.new('RGB', (W, H), BG)
d = ImageDraw.Draw(img)

def centre(text, y, fnt, fill):
    w = d.textbbox((0, 0), text, font=fnt)[2]
    d.text(((W - w) // 2, y), text, font=fnt, fill=fill)

# vignette so the dark panel reads as depth rather than flat black
for i in range(90):
    a = int(16 * (1 - i / 90))
    d.rectangle([i, i, W - i, H - i], outline=(BG[0] + a, BG[1] + a, BG[2] + a + 2))

# ── title ────────────────────────────────────────────────────────────────────
centre('VICTORY', 34, f_title, GOLD)
centre('FORECASTER', 78, f_title, GOLD)
d.line([(150, 130), (W - 150, 130)], fill=GOLD_DIM, width=1)
centre('know who is about to win, and why', 142, f_sub, GREY)

# ── the mock victory card ────────────────────────────────────────────────────
cx0, cy0, cx1, cy1 = 58, 184, W - 58, 372
d.rectangle([cx0, cy0, cx1, cy1], fill=CARD, outline=CARD_EDGE)
centre('CULTURAL', cy0 + 14, f_card, CULT)

d.text((cx0 + 22, cy0 + 56), 'POINT GOAL', font=f_label, fill=GREY)
gw = d.textbbox((0, 0), '320', font=f_num)[2]
d.text((cx1 - 22 - gw, cy0 + 53), '320', font=f_num, fill=WHITE)
d.line([(cx0 + 20, cy0 + 80), (cx1 - 20, cy0 + 80)], fill=(58, 50, 78), width=1)

# The leader's score is red: 277 already clears the NEXT tier's goal of 240.
rows = [('1.  Xerxes, the Achaemenid', '277', RED, True),
        ('2.  Napoleon, Revolutionary', '160', GREY, False),
        ('3.  Jose Rizal', '149', DIM, False)]
y = cy0 + 92
for name, score, col, hot in rows:
    d.text((cx0 + 22, y), name, font=f_row, fill=WHITE if hot else GREY)
    sw = d.textbbox((0, 0), score, font=f_num)[2]
    d.text((cx1 - 22 - sw, y - 2), score, font=f_num, fill=col)
    y += 31

# ── the tooltip section the mod injects ──────────────────────────────────────
tx0, ty0, tx1, ty1 = 58, 396, W - 58, 556
d.rectangle([tx0, ty0, tx1, ty1], fill=TIP_BG, outline=GOLD_DIM)
centre('NEXT: SUBSTANTIVE VICTORY', ty0 + 13, f_tiphead, GOLD)
centre('Required: 1.5x the Second Place score', ty0 + 35, f_calc, GREY)
d.line([(tx0 + 40, ty0 + 60), (tx1 - 40, ty0 + 60)], fill=(70, 60, 34), width=1)
centre('Point Goal 240  =  x1.5 of 2nd place (160)', ty0 + 72, f_calc, GOLD)

# warning triangle, drawn rather than relying on an emoji glyph in the font
wy = ty0 + 106
d.polygon([(tx0 + 46, wy + 15), (tx0 + 56, wy - 2), (tx0 + 66, wy + 15)], fill=RED)
d.text((tx0 + 54, wy + 2), '!', font=f_tiphead, fill=TIP_BG)
d.text((tx0 + 76, wy), 'Xerxes (277) already clears this', font=f_warn, fill=RED)
d.text((tx0 + 76, wy + 21), 'countdown starts at 60% Age Progress', font=f_calc, fill=GREY)

centre('no projections - exact arithmetic on live standings', 578, f_foot, DIM)
d.line([(150, 606), (W - 150, 606)], fill=GOLD_DIM, width=1)

img.save(OUT, 'PNG', optimize=True)
print('wrote %s  %dx%d  %.1f KB' % (os.path.realpath(OUT), W, H, os.path.getsize(OUT) / 1024))
