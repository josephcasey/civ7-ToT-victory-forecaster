#!/usr/bin/env python3
"""Generate Steam Workshop preview image for ToT Victory Forecaster."""
import struct, zlib, os

W, H = 620, 620

# ── palette ──────────────────────────────────────────────────────────────────
BG       = (13,  17,  23)
PANEL    = (22,  28,  38)
PANEL2   = (28,  35,  48)
GOLD     = (201,162,  39)
GOLD2    = (240,200,  80)
GOLD_DIM = (100, 78,  16)
SEP      = ( 40, 48,  64)
WHITE    = (255,255, 255)
GREY     = (160,165, 175)
DGREY    = ( 60, 68,  80)

COL_MIL  = (190,  40,  40)
COL_CUL  = (140,  55, 200)
COL_ECO  = ( 50, 175,  75)
COL_SCI  = ( 50, 130, 220)

TRACK_BG = ( 20,  80,  30)
TRACK_FG = ( 50, 210,  90)
NOTRACK  = ( 55,  60,  70)
NOTRACK2 = ( 80,  85,  95)

# ── 5×7 pixel font (values are 5-bit row masks, MSB=left) ────────────────────
FONT = {
    'A':[0x0E,0x11,0x11,0x1F,0x11,0x11,0x11],
    'B':[0x1E,0x11,0x11,0x1E,0x11,0x11,0x1E],
    'C':[0x0E,0x11,0x10,0x10,0x10,0x11,0x0E],
    'D':[0x1C,0x12,0x11,0x11,0x11,0x12,0x1C],
    'E':[0x1F,0x10,0x10,0x1E,0x10,0x10,0x1F],
    'F':[0x1F,0x10,0x10,0x1E,0x10,0x10,0x10],
    'G':[0x0E,0x11,0x10,0x13,0x11,0x11,0x0F],
    'H':[0x11,0x11,0x11,0x1F,0x11,0x11,0x11],
    'I':[0x0E,0x04,0x04,0x04,0x04,0x04,0x0E],
    'J':[0x07,0x02,0x02,0x02,0x02,0x12,0x0C],
    'K':[0x11,0x12,0x14,0x18,0x14,0x12,0x11],
    'L':[0x10,0x10,0x10,0x10,0x10,0x10,0x1F],
    'M':[0x11,0x1B,0x15,0x11,0x11,0x11,0x11],
    'N':[0x11,0x19,0x15,0x13,0x11,0x11,0x11],
    'O':[0x0E,0x11,0x11,0x11,0x11,0x11,0x0E],
    'P':[0x1E,0x11,0x11,0x1E,0x10,0x10,0x10],
    'Q':[0x0E,0x11,0x11,0x11,0x15,0x12,0x0D],
    'R':[0x1E,0x11,0x11,0x1E,0x14,0x12,0x11],
    'S':[0x0F,0x10,0x10,0x0E,0x01,0x01,0x1E],
    'T':[0x1F,0x04,0x04,0x04,0x04,0x04,0x04],
    'U':[0x11,0x11,0x11,0x11,0x11,0x11,0x0E],
    'V':[0x11,0x11,0x11,0x11,0x11,0x0A,0x04],
    'W':[0x11,0x11,0x11,0x15,0x15,0x1B,0x11],
    'X':[0x11,0x11,0x0A,0x04,0x0A,0x11,0x11],
    'Y':[0x11,0x11,0x0A,0x04,0x04,0x04,0x04],
    'Z':[0x1F,0x01,0x02,0x04,0x08,0x10,0x1F],
    '0':[0x0E,0x11,0x13,0x15,0x19,0x11,0x0E],
    '1':[0x04,0x0C,0x04,0x04,0x04,0x04,0x0E],
    '2':[0x0E,0x11,0x01,0x02,0x04,0x08,0x1F],
    '3':[0x1F,0x02,0x04,0x02,0x01,0x11,0x0E],
    '4':[0x02,0x06,0x0A,0x12,0x1F,0x02,0x02],
    '5':[0x1F,0x10,0x1E,0x01,0x01,0x11,0x0E],
    '6':[0x06,0x08,0x10,0x1E,0x11,0x11,0x0E],
    '7':[0x1F,0x01,0x02,0x04,0x08,0x08,0x08],
    '8':[0x0E,0x11,0x11,0x0E,0x11,0x11,0x0E],
    '9':[0x0E,0x11,0x11,0x0F,0x01,0x02,0x0C],
    ' ':[0x00]*7,
    '-':[0x00,0x00,0x00,0x1F,0x00,0x00,0x00],
    '.':[0x00,0x00,0x00,0x00,0x00,0x0C,0x0C],
    ':':[0x00,0x06,0x06,0x00,0x06,0x06,0x00],
    'x':[0x00,0x00,0x11,0x0A,0x04,0x0A,0x11],
    '!':[0x04,0x04,0x04,0x04,0x04,0x00,0x04],
}

# ── pixel buffer ─────────────────────────────────────────────────────────────
pixels = [BG] * (W * H)

def px(x, y, c):
    if 0 <= x < W and 0 <= y < H:
        pixels[y * W + x] = c

def rect(x1, y1, x2, y2, c):
    for y in range(max(0,y1), min(H,y2)):
        for x in range(max(0,x1), min(W,x2)):
            px(x, y, c)

def hline(y, x1, x2, c):
    for x in range(max(0,x1), min(W,x2)): px(x, y, c)

def vline(x, y1, y2, c):
    for y in range(max(0,y1), min(H,y2)): px(x, y, c)

def lerp(c1, c2, t):
    return tuple(int(a+(b-a)*t) for a,b in zip(c1,c2))

def text(s, ox, oy, color, scale=1):
    cx = ox
    for ch in s.upper():
        glyph = FONT.get(ch, FONT[' '])
        for row, bits in enumerate(glyph):
            for col in range(5):
                if bits & (0x10 >> col):
                    for sy in range(scale):
                        for sx in range(scale):
                            px(cx + col*scale + sx, oy + row*scale + sy, color)
        cx += (5 + 1) * scale
    return cx

def text_centered(s, y, color, scale=1, x1=0, x2=W):
    char_w = (5+1)*scale
    total = len(s)*char_w - scale
    ox = x1 + (x2-x1-total)//2
    text(s, ox, y, color, scale)

# ── background gradient ───────────────────────────────────────────────────────
for y in range(H):
    t = y/H
    c = lerp((18,22,32),(10,13,20),t)
    hline(y, 0, W, c)

# ── header panel ──────────────────────────────────────────────────────────────
rect(0, 0, W, 100, PANEL)
for y in range(100):          # subtle vignette
    hline(y, 0, W, lerp(PANEL, BG, y/100*0.4))

# gold top bar
rect(0, 0, W, 5, GOLD)

# gold bottom of header
rect(0, 95, W, 100, GOLD_DIM)
rect(0, 97, W, 99, GOLD)

# VF logo badge
rect(22, 14, 68, 80, GOLD_DIM)
rect(24, 16, 66, 78, (25,30,40))
for i in range(3): rect(24+i, 16+i, 66-i, 78-i, lerp(GOLD, GOLD_DIM, i/3))
rect(26, 18, 64, 76, (18,22,32))
text('VF', 28, 26, GOLD, scale=3)

# Title text
text('TOT VICTORY', 82, 20, GOLD2, scale=2)
text('FORECASTER', 82, 46, WHITE, scale=2)
text('MODERN AGE THRESHOLD TRACKER', 82, 74, GREY, scale=1)

# ── column headers ────────────────────────────────────────────────────────────
COL_X  = [10, 160, 310, 460]   # left edges of 4 columns
COL_W  = 140
COLS   = [(COL_MIL,'MILITARY'),(COL_CUL,'CULTURE'),(COL_ECO,'ECONOMIC'),(COL_SCI,'SCIENCE')]

for i,(color,label) in enumerate(COLS):
    x = COL_X[i]
    # column header strip
    rect(x, 108, x+COL_W, 136, lerp(color,(0,0,0),0.6))
    for k in range(3): rect(x+k, 108+k, x+COL_W-k, 111, lerp(color,WHITE,0.3))
    text_centered(label, 116, WHITE, scale=1, x1=x, x2=x+COL_W)

# ── player rows ───────────────────────────────────────────────────────────────
PLAYERS = [
    ('YOU',       [92, 78, 85, 60], True,  [True, True,  False, True ]),
    ('BABYLON',   [88, 70, 91, 55], False, [True, False, True,  False]),
    ('ROME',      [65, 55, 48, 80], False, [False,False, False, True ]),
    ('EGYPT',     [50, 82, 33, 42], False, [False,True,  False, False]),
    ('CHINA',     [40, 38, 61, 35], False, [False,False, False, False]),
]

ROW_H   = 72
ROW_TOP = 144

for pi, (name, scores, is_local, on_track) in enumerate(PLAYERS):
    ry = ROW_TOP + pi * ROW_H
    # row background
    bg_c = lerp(PANEL2, PANEL, pi%2*0.4)
    if is_local: bg_c = lerp(bg_c, GOLD_DIM, 0.18)
    rect(0, ry, W, ry+ROW_H-2, bg_c)
    hline(ry+ROW_H-2, 0, W, SEP)

    # rank circle
    rank_c = [GOLD,(180,180,180),(180,120,50),(80,80,90),(80,80,90)][pi]
    rect(8, ry+8, 24, ry+28, lerp(rank_c,(0,0,0),0.5))
    rect(9, ry+9, 23, ry+27, rank_c)
    text(str(pi+1), 12, ry+12, (20,20,20), scale=1)

    # player name
    name_c = GOLD if is_local else WHITE
    text(name, 30, ry+12, name_c, scale=1)
    if is_local:
        text('(YOU)', 30, ry+24, GOLD_DIM, scale=1)

    # per-column score bars + ON TRACK badges
    for ci,(color,_) in enumerate(COLS):
        cx = COL_X[ci]
        sc = scores[ci]
        ot = on_track[ci]

        # score bar background
        rect(cx+2, ry+8, cx+COL_W-2, ry+32, lerp(color,(0,0,0),0.8))
        # filled portion
        bar_w = int((COL_W-6) * sc/100)
        for bx in range(bar_w):
            t = bx / max(bar_w,1)
            bc = lerp(lerp(color,(0,0,0),0.4), color, t)
            vline(cx+3+bx, ry+9, ry+31, bc)
        # score label
        text(str(sc), cx+4, ry+12, WHITE, scale=1)

        # ON TRACK badge
        if ot:
            rect(cx+2, ry+36, cx+COL_W-2, ry+62, TRACK_BG)
            rect(cx+2, ry+36, cx+COL_W-2, ry+38, TRACK_FG)
            rect(cx+2, ry+60, cx+COL_W-2, ry+62, TRACK_FG)
            text_centered('ON TRACK', ry+42, TRACK_FG, scale=1, x1=cx, x2=cx+COL_W)
            text_centered('x2.00', ry+53, lerp(TRACK_FG,WHITE,0.5), scale=1, x1=cx, x2=cx+COL_W)
        else:
            rect(cx+2, ry+36, cx+COL_W-2, ry+62, NOTRACK)
            text_centered('BEHIND', ry+47, NOTRACK2, scale=1, x1=cx, x2=cx+COL_W)

# ── threshold legend strip ────────────────────────────────────────────────────
LY = ROW_TOP + len(PLAYERS)*ROW_H + 4
rect(0, LY, W, LY+2, GOLD_DIM)
rect(0, LY+2, W, H, lerp(PANEL,(0,0,0),0.3))

legend_y = LY + 12
text('THRESHOLDS:', 14, legend_y, GREY, scale=1)
milestones = [('3.00x',0),('2.00x',60),('1.50x',100),('1.25x',150)]
mx = 130
for label,pts in milestones:
    dot_c = GOLD if pts <= 60 else GREY
    rect(mx, legend_y+1, mx+6, legend_y+7, dot_c)
    text(label, mx+8, legend_y, WHITE if pts<=60 else GREY, scale=1)
    mx += 80

text('NEXT LOWERING AT ~60 AGE PTS', 14, legend_y+18, lerp(GOLD,GREY,0.5), scale=1)

# gold bottom border
rect(0, H-5, W, H, GOLD)
rect(0, H-3, W, H-1, GOLD_DIM)

# ── encode PNG ────────────────────────────────────────────────────────────────
def make_png(w, h, pxs):
    def chunk(name, data):
        c = name + data
        return struct.pack('>I',len(data)) + c + struct.pack('>I',zlib.crc32(c)&0xFFFFFFFF)
    raw = bytearray()
    for y in range(h):
        raw += b'\x00'
        for x in range(w):
            r,g,b = pxs[y*w+x]
            raw += bytes([r,g,b])
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
    out  = b'\x89PNG\r\n\x1a\n'
    out += chunk(b'IHDR', ihdr)
    out += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    out += chunk(b'IEND', b'')
    return out

out_path = os.path.join(os.path.dirname(__file__), '..', 'preview.png')
with open(out_path, 'wb') as f:
    f.write(make_png(W, H, pixels))
print(f"Written: {os.path.abspath(out_path)}")
