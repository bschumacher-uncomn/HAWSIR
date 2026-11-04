#!/usr/bin/env python3
"""NAVIFI pitch deck in the hype video's visual language (video/hype.css).

Native PowerPoint objects: text, plates, callouts and diagrams stay editable; only the
backgrounds and the app screenshots are images. Criterion copy comes from video/timeline.mjs.

usage: python3 deck/build.py
  -> deck/out/NAVIFI_FleetHacker_2026.pptx, plus a font-embedded PDF and PNG previews
     when LibreOffice and pdftoppm are installed.
Presenting from PowerPoint needs the OFL fonts in deck/fonts installed on that machine.
"""
import json
import os
import shutil
import subprocess
from pathlib import Path

import numpy as np
from lxml import etree
from PIL import Image, ImageFilter, ImageFont
from pptx import Presentation
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, MSO_AUTO_SIZE, PP_ALIGN
from pptx.oxml import parse_xml
from pptx.oxml.ns import nsdecls, qn
from pptx.util import Emu, Pt

DECK = Path(__file__).resolve().parent
PROJ = DECK.parent
STILLS = PROJ / 'video/footage/stills'
FONTS = DECK / 'fonts'
BUILD = DECK / 'build'
OUT = DECK / 'out'
NAME = 'NAVIFI_FleetHacker_2026'

W, H = 1920, 1080  # layout units are the video's CSS px; 1 px = 6350 EMU = 0.5 pt
SCALE = 2  # raster assets at 4K

HEAD, BODY, MONO = 'Chakra Petch', 'Inter', 'JetBrains Mono'
TTF = {HEAD: 'ChakraPetch', BODY: 'Inter', MONO: 'JetBrainsMono'}
CYAN, OK, AMBER, CRIT, VIOLET, PURPLE = '22d3ee', '34d399', 'fbbf24', 'fb3b5c', 'a78bfa', 'c084fc'
WHITE, INK, TEXT, SOFT, SLATE, DIM = 'ffffff', 'e0f2fe', 'f1f5f9', 'cbd5e1', '94a3b8', '64748b'
PANEL, VOID = '020810', '02060c'
CLASS_TEXT = 'UNCLASSIFIED // SYNTHETIC DATA // FLEETHACKER NORFOLK 2026 // NOT AN AUTHORITATIVE RECORD'

CRITERIA = json.loads(subprocess.check_output(
    ['node', '--input-type=module', '-e',
     "import('./video/timeline.mjs').then((m) => console.log(JSON.stringify(m.CRITERIA)))"],
    cwd=PROJ))
for c in CRITERIA:
    c['color'] = c['color'].lstrip('#')

# left text column and right visual column on criterion slides
LX, LW = 80, 620
VX, VY, VW = 740, 296, 1100
VH = round(VW * 9 / 16)


def px(v):
    return Emu(int(round(v * 6350)))


def pts(v):
    return Pt(v / 2)


# ---------------------------------------------------------------- text metrics

_ttf = {}


def font(face, bold, size):
    key = (face, bold, size)
    if key not in _ttf:
        _ttf[key] = ImageFont.truetype(str(FONTS / f"{TTF[face]}-{'Bold' if bold else 'Regular'}.ttf"), size * 4)
    return _ttf[key]


def measure(text, face=HEAD, size=20, bold=True, spc=0.0):
    return font(face, bold, size).getlength(text) / 4 + spc * size * max(len(text) - 1, 0)


def wrap(text, face, size, bold, width):
    lines, cur = [], ''
    for word in text.split():
        nxt = f'{cur} {word}'.strip()
        if cur and measure(nxt, face, size, bold) > width:
            lines.append(cur)
            cur = word
        else:
            cur = nxt
    return lines + [cur] if cur else lines


# ---------------------------------------------------------------- DrawingML helpers

def E(tag, attrs=None, *children):
    e = etree.Element(qn(tag))
    for k, v in (attrs or {}).items():
        e.set(k, str(v))
    for ch in children:
        e.append(ch)
    return e


def srgb(hexv, alpha=None):
    c = E('a:srgbClr', {'val': hexv.upper()})
    if alpha is not None and alpha < 1:
        c.append(E('a:alpha', {'val': int(alpha * 100000)}))
    return c


def solid(hexv, alpha=None):
    return E('a:solidFill', None, srgb(hexv, alpha))


def glow_fx(hexv, rad, alpha):
    return E('a:effectLst', None, E('a:glow', {'rad': int(rad * 6350)}, srgb(hexv, alpha)))


def style_sppr(spPr, fill=None, fa=None, line=None, lw=1.0, la=None, dash=None, glow=None, gr=12, ga=0.5):
    for ch in list(spPr):
        if ch.tag not in (qn('a:xfrm'), qn('a:prstGeom'), qn('a:custGeom')):
            spPr.remove(ch)
    spPr.append(solid(fill, fa) if fill else E('a:noFill'))
    if line:
        ln = E('a:ln', {'w': int(lw * 6350)}, solid(line, la))
        if dash:
            ln.append(E('a:prstDash', {'val': dash}))
        spPr.append(ln)
    else:
        spPr.append(E('a:ln', None, E('a:noFill')))
    spPr.append(glow_fx(glow, gr, ga) if glow else E('a:effectLst'))


def drop_style(shape):
    st = shape._element.find(qn('p:style'))
    if st is not None:
        shape._element.remove(st)


def rect(slide, x, y, w, h, r=0, **style):
    shp = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE if r else MSO_SHAPE.RECTANGLE, px(x), px(y), px(w), px(h))
    if r:
        shp.adjustments[0] = min(0.5, r / min(w, h))
    drop_style(shp)
    style_sppr(shp._element.spPr, **style)
    return shp


def R(text, face=BODY, size=20, color=TEXT, bold=False, spc=0.0, glow=None, gr=14, ga=0.55,
      outline=None, ow=2.0, alpha=None, strike=False):
    return dict(text=text, face=face, size=size, color=color, bold=bold, spc=spc, glow=glow, gr=gr, ga=ga,
                outline=outline, ow=ow, alpha=alpha, strike=strike)


def P(*runs, line=None, before=0, align=None):
    return dict(runs=runs, line=line, before=before, align=align)


ALIGN = {'l': PP_ALIGN.LEFT, 'c': PP_ALIGN.CENTER, 'r': PP_ALIGN.RIGHT}
ANCHOR = {'t': MSO_ANCHOR.TOP, 'm': MSO_ANCHOR.MIDDLE, 'b': MSO_ANCHOR.BOTTOM}


def add_run(p, r):
    run = p.add_run()
    run.text = r['text']
    rPr = run._r.get_or_add_rPr()
    for ch in list(rPr):
        rPr.remove(ch)
    rPr.set('lang', 'en-US')
    rPr.set('sz', str(int(round(r['size'] / 2 * 100))))
    rPr.set('b', '1' if r['bold'] else '0')
    if r['spc']:
        rPr.set('spc', str(int(round(r['spc'] * r['size'] / 2 * 100))))
    if r['strike']:
        rPr.set('strike', 'sngStrike')
    if r['outline']:
        rPr.append(E('a:ln', {'w': int(r['ow'] * 6350)}, solid(r['outline'])))
        rPr.append(E('a:noFill'))
    else:
        rPr.append(solid(r['color'], r['alpha']))
    if r['glow']:
        rPr.append(glow_fx(r['glow'], r['gr'], r['ga']))
    rPr.append(E('a:latin', {'typeface': r['face']}))
    rPr.append(E('a:cs', {'typeface': r['face']}))


def text(slide, x, y, w, h, paras, align='l', anchor='t', inset=(0, 0, 0, 0), shape=None, wrap_text=True):
    shp = shape or slide.shapes.add_textbox(px(x), px(y), px(w), px(h))
    tf = shp.text_frame
    tf.word_wrap = wrap_text
    tf.auto_size = MSO_AUTO_SIZE.NONE
    tf.margin_left, tf.margin_top, tf.margin_right, tf.margin_bottom = (px(v) for v in inset)
    tf.vertical_anchor = ANCHOR[anchor]
    for i, para in enumerate(paras):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = ALIGN[para['align'] or align]
        if para['line']:
            p.line_spacing = pts(para['line'])
        if para['before']:
            p.space_before = pts(para['before'])
        for r in para['runs']:
            add_run(p, r)
    return shp


def picture(slide, path, x, y, w, h, border=None, ba=0.6, glow=None, ga=0.35):
    pic = slide.shapes.add_picture(str(path), px(x), px(y), px(w), px(h))
    spPr = pic._element.spPr
    if border:
        spPr.append(E('a:ln', {'w': int(1.5 * 6350)}, solid(border, ba)))
    spPr.append(glow_fx(glow, 18, ga) if glow else E('a:effectLst'))
    return pic


def set_background(slide, path):
    _, rid = slide.part.get_or_add_image_part(str(path))
    bg = parse_xml(
        f'<p:bg {nsdecls("p", "a", "r")}><p:bgPr><a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="{rid}"/>'
        '<a:srcRect/><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/></p:bgPr></p:bg>')
    slide._element.cSld.insert(0, bg)


# ---------------------------------------------------------------- raster assets

def hexf(h):
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], np.float32) if isinstance(h, str) else h


def radial(cx, cy, rx, ry, stops):
    y, x = np.ogrid[0:H * SCALE, 0:W * SCALE]
    t = np.clip(np.sqrt(((x / SCALE - cx) / rx) ** 2 + ((y / SCALE - cy) / ry) ** 2), 0, 1)
    pos = [s[0] for s in stops]
    cols = [hexf(s[1]) for s in stops]
    out = np.empty((H * SCALE, W * SCALE, 3), np.float32)
    for k in range(3):
        out[..., k] = np.interp(t, pos, [c[k] for c in cols])
    return out


def finish(img):
    """Grid, scanlines, vignette and HUD corner brackets, as layered in hype.css."""
    hs, ws = img.shape[:2]
    step = 64 * SCALE
    grid = ((np.arange(ws) % step) < SCALE)[None, :] | ((np.arange(hs) % step) < SCALE)[:, None]
    img[grid] = img[grid] * 0.93 + np.array([56, 189, 248], np.float32) * 0.07
    scan = (np.arange(hs) // SCALE) % 3 == 0
    img[scan] += (255 - img[scan]) * 0.022
    y, x = np.ogrid[0:hs, 0:ws]
    r = np.sqrt(((x - ws / 2) / (ws / 2)) ** 2 + ((y - hs / 2) / (hs / 2)) ** 2) / np.sqrt(2)
    img *= (1 - np.clip((r - 0.52) / 0.48, 0, 1) * 0.6)[..., None]
    cc = np.array([34, 211, 238], np.float32)

    def paint(x0, y0, x1, y1):
        sl = img[y0 * SCALE:y1 * SCALE, x0 * SCALE:x1 * SCALE]
        sl[:] = sl * 0.5 + cc * 0.5

    for x0, y0, right, bottom in [(26, 42, 0, 0), (W - 72, 42, 1, 0), (26, H - 68, 0, 1), (W - 72, H - 68, 1, 1)]:
        ey = y0 + 44 if bottom else y0
        ex = x0 + 44 if right else x0
        paint(x0, ey, x0 + 46, ey + 2)
        paint(ex, y0, ex + 2, y0 + 46)
    return img


def save_jpg(arr, name):
    path = BUILD / f'{name}.jpg'
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).save(path, quality=90, subsampling=0, optimize=True)
    return path


def criterion_bg(color):
    mid = hexf(color) * 0.16 + hexf('030b15') * 0.84
    return save_jpg(finish(radial(300, 210, 1500, 900, [(0, mid), (0.58, '02060c'), (1, '010205')])), f'bg_{color}')


def title_bg():
    im = Image.open(STILLS / 'thread_0600.png').convert('RGB').resize((W * SCALE, H * SCALE), Image.LANCZOS)
    a = np.asarray(im.filter(ImageFilter.GaussianBlur(14 * SCALE)), np.float32) * 0.3
    y, x = np.ogrid[0:H * SCALE, 0:W * SCALE]
    t = np.clip(np.sqrt(((x / SCALE - 960) / 700) ** 2 + ((y / SCALE - 400) / 350) ** 2), 0, 1)
    g = (0.28 * (1 - t))[..., None]
    a = a * (1 - g) + hexf(CYAN) * g
    return save_jpg(finish(a), 'bg_title')


def still(name, box=(0, 0, 1, 1), out_w=VW * SCALE):
    im = Image.open(STILLS / f'{name}.png').convert('RGB')
    x0, y0, x1, y1 = box
    im = im.crop((round(x0 * im.width), round(y0 * im.height), round(x1 * im.width), round(y1 * im.height)))
    im = im.resize((out_w, round(out_w * im.height / im.width)), Image.LANCZOS)
    path = BUILD / f'shot_{name}_{out_w}.jpg'
    im.save(path, quality=90, subsampling=0, optimize=True)
    return path


# ---------------------------------------------------------------- slide furniture

def chrome(slide, n, total):
    bar = rect(slide, 0, 0, W, 26, fill='16a34a')
    text(slide, 0, 0, 0, 0, [P(R(CLASS_TEXT, MONO, 13, '03140a', True, 0.32))], align='c', anchor='m', shape=bar)
    text(slide, W - 86 - 460, 50, 460, 24,
         [P(R('●  ', MONO, 12, CRIT, True, glow=CRIT, gr=6), R(f'NAVIFI · {n:02d} / {total:02d}', MONO, 15, SLATE, True, 0.22))],
         align='r')


def rubric(slide, active):
    x, y, h, gap = 110, 990, 40, 8
    total = 1700 - gap * (len(CRITERIA) - 1)
    for j, c in enumerate(CRITERIA):
        w = total * c['weight'] / 100
        col = c['color']
        if j == active:
            seg = rect(slide, x, y, w, h, r=4, fill=col, glow=col, gr=12, ga=0.5)
            ink = VOID
        elif j < active:
            seg = rect(slide, x, y, w, h, r=4, fill=SLATE, fa=0.12, line=SLATE, la=0.25)
            ink = SLATE
        else:
            seg = rect(slide, x, y, w, h, r=4, line=SLATE, la=0.25)
            ink = DIM
        text(slide, 0, 0, 0, 0, [P(R(f"{c['n']} {c['short'].upper()}", MONO, 13, ink, True, 0.1))],
             anchor='m', inset=(14, 0, 0, 0), shape=seg, wrap_text=False)
        text(slide, x, y, w - 14, h, [P(R(f"{c['weight']}%", MONO, 13, ink, True))], align='r', anchor='m')
        x += w + gap


def header(slide, c):
    col = c['color']
    text(slide, 50, 34, 300, 240,
         [P(R(c['n'], HEAD, 200, col, True, -0.03, outline=col, ow=3, glow=col, gr=16, ga=0.5), line=220)])
    text(slide, 338, 72, 1300, 26, [P(R(f"JUDGING CRITERION {c['n']} / 05", MONO, 17, col, True, 0.36))])
    text(slide, 338, 98, 1500, 70, [P(R(c['name'].upper(), HEAD, 54, WHITE, True, 0.03))], wrap_text=False)
    text(slide, 338, 164, 140, 54, [P(R(f"{c['weight']}%", HEAD, 42, col, True, glow=col, gr=10, ga=0.5))])
    text(slide, 466, 181, 220, 24, [P(R('OF THE SCORE', MONO, 14, SLATE, True, 0.32))])
    rect(slide, 680, 186, 420, 9, r=4, fill=SLATE, fa=0.16)
    rect(slide, 680, 186, 420 * c['weight'] * 3 / 100, 9, r=4, fill=col, glow=col, gr=8, ga=0.6)


def punch(slide, lines, color, y=VY, size=56):
    size = min(size, int(size * LW / max(measure(l, HEAD, size) for l in lines)))
    pitch = round(size * 1.06)
    last = len(lines) - 1
    paras = [P(R(l, HEAD, size, color if j == last else WHITE, True, glow=color if j == last else None, gr=14, ga=0.4),
               line=pitch) for j, l in enumerate(lines)]
    text(slide, LX, y, LW, pitch * len(lines) + 16, paras)
    return y + pitch * len(lines) + 22


def answer(slide, c, y):
    col = c['color']
    body_w = LW - 28 - 22
    n = len(wrap(c['attack'], BODY, 19, False, body_w - 6))
    h = 14 + 20 + 8 + n * 26 + 18
    rect(slide, LX, y, LW, h, fill=VOID, fa=0.9)
    rect(slide, LX, y, 5, h, fill=col, glow=col, gr=6, ga=0.5)
    text(slide, LX + 28, y + 14, body_w, h - 20,
         [P(R('OUR ANSWER', MONO, 13, col, True, 0.28), line=20),
          P(R(c['attack'], BODY, 19, TEXT), line=26, before=8)])
    return y + h + 16


def proof(slide, y, lead, detail, color, kicker=None, dash=None, x=LX, w=LW, lead_size=22, det_size=15):
    body_w = w - 24 - 20
    det_lines = len(wrap(detail, BODY, det_size, False, body_w - 6))
    lead_pitch, det_pitch = round(lead_size * 1.27), round(det_size * 1.4)
    h = 12 + (22 if kicker else 0) + lead_pitch + 4 + det_lines * det_pitch + 12
    rect(slide, x, y, w, h, fill=PANEL, fa=0.9, line=color, lw=1.5 if dash else 1, la=0.8 if dash else 0.28, dash=dash)
    if not dash:
        rect(slide, x, y, 5, h, fill=color, glow=color, gr=6, ga=0.5)
    paras = [P(R(kicker, MONO, 14, color, True, 0.24), line=22)] if kicker else []
    paras += [P(R(lead, HEAD, lead_size, WHITE, True, 0.02), line=lead_pitch),
              P(R(detail, BODY, det_size, SOFT), line=det_pitch, before=4)]
    text(slide, x + 24, y + 11, body_w, h - 14, paras)
    return y + h + 10


def caption(slide, s, y=VY + VH + 12):
    text(slide, VX, y, VW, 20, [P(R(s, MONO, 12, DIM, True, 0.2))])


def screen(slide, name, box=(0, 0, 1, 1), x=VX, y=VY, w=VW, color=CYAN):
    h = round(w * (box[3] - box[1]) * 9 / ((box[2] - box[0]) * 16))
    picture(slide, still(name, box, round(w * SCALE)), x, y, w, h, border=color, ba=0.45, glow=color, ga=0.18)
    return dict(x=x, y=y, w=w, h=h, box=box)


def callout(slide, scr, rect_n, label, color, below=False, right=False):
    bx0, by0, bx1, by1 = scr['box']
    rx, ry, rw, rh = rect_n
    x = scr['x'] + (rx - bx0) / (bx1 - bx0) * scr['w']
    y = scr['y'] + (ry - by0) / (by1 - by0) * scr['h']
    w = rw / (bx1 - bx0) * scr['w']
    h = rh / (by1 - by0) * scr['h']
    pad = 4
    if w * h < 0.04 * scr['w'] * scr['h']:
        rect(slide, x - pad, y - pad, w + 2 * pad, h + 2 * pad, r=5, fill=color, fa=0.1, line=color, lw=2.5, glow=color, gr=12, ga=0.6)
    else:
        rect(slide, x - pad, y - pad, w + 2 * pad, h + 2 * pad, r=5, line=color, lw=3)
    if not label:
        return
    tw = measure(label.upper(), HEAD, 15, True, 0.12) + 26
    th = 28
    tx = x + w + pad - tw if right else x - pad
    ty = y + h + pad + 7 if below else y - pad - 7 - th
    tag = rect(slide, tx, ty, tw, th, r=3, fill=color, glow=color, gr=10, ga=0.45)
    text(slide, 0, 0, 0, 0, [P(R(label.upper(), HEAD, 15, VOID, True, 0.12))], align='c', anchor='m', shape=tag, wrap_text=False)


def stat(slide, x, y, big, line, color, foot=None):
    bw = measure(big.upper(), HEAD, 46, True) + 10
    lw_ = measure(line, BODY, 19, False) if line else 0
    fw = measure(foot, MONO, 12, True, 0.06) if foot else 0
    w = max(bw, lw_, fw) + 28 + 30
    h = 16 + 50 + (34 if line else 0) + (24 if foot else 0) + 16
    rect(slide, x, y, w, h, fill=VOID, fa=0.94)
    rect(slide, x, y, 6, h, fill=color, glow=color, gr=8, ga=0.6)
    paras = [P(R(big.upper(), HEAD, 46, color, True, glow=color, gr=12, ga=0.4), line=50)]
    if line:
        paras.append(P(R(line, BODY, 19, TEXT), line=26, before=8))
    if foot:
        paras.append(P(R(foot, MONO, 12, SLATE, True, 0.06), line=18, before=6))
    text(slide, x + 28, y + 14, w - 36, h - 20, paras, wrap_text=False)


def notes(slide, s):
    slide.notes_slide.notes_text_frame.text = s


# ---------------------------------------------------------------- slides

def slide_title(prs, total):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    set_background(s, title_bg())
    chrome(s, 1, total)
    text(s, 0, 150, W, 30, [P(R('> USS CAPE CHARLES (LCS-42) · OPERATION OPEN PASSAGE · MCM APPROACH ASSESSMENT', MONO, 20, '7dd3fc', True, 0.2))], align='c')
    text(s, 0 + 230 * 0.1, 196, W, 290, [P(R('NAVIFI', HEAD, 230, 'f0fdff', True, 0.2, glow=CYAN, gr=28, ga=0.45))], align='c')
    text(s, 0 + 24 * 0.31, 486, W, 36, [P(R('MISSION CONSEQUENCE ENGINE', MONO, 24, CYAN, True, 0.62))], align='c')
    text(s, 0, 540, W, 64, [P(R('Know before it breaks the mission.', HEAD, 44, WHITE, True, 0.04))], align='c')
    x, y, gap = 160, 676, 20
    w = (1600 - gap * 4) / 5
    for c in CRITERIA:
        col = c['color']
        rect(s, x, y, w, 168, fill=PANEL, fa=0.88, line=col, la=0.45)
        rect(s, x, y, w, 4, fill=col, glow=col, gr=8, ga=0.6)
        text(s, x + 20, y + 18, 100, 44, [P(R(c['n'], HEAD, 36, col, True, glow=col, gr=8, ga=0.4))])
        text(s, x + w - 120, y + 22, 100, 40, [P(R(f"{c['weight']}%", HEAD, 28, col, True))], align='r')
        text(s, x + 20, y + 70, w - 40, 26, [P(R(c['short'].upper(), HEAD, 17, WHITE, True, 0.1))], wrap_text=False)
        text(s, x + 20, y + 100, w - 40, 60, [P(R(' '.join(c['punch']), BODY, 15, SLATE), line=21)])
        x += w + gap
    text(s, 26 * 0.16, 894, W, 40, [P(R('UNCOMN · FLEETHACKER NORFOLK 2026', HEAD, 26, INK, True, 0.32))], align='c')
    text(s, 0, 938, W, 24, [P(R('SYNTHETIC DATA ONLY · NOT AN AUTHORITATIVE SYSTEM · A HUMAN DECIDES', MONO, 15, DIM, True, 0.18))], align='c')
    notes(s, 'NAVIFI is a mission consequence engine. It turns the ship\'s operational architecture into an executable '
             'mission thread, so when status reports land the watch sees which one actually controls the mission, what it '
             'costs, and which bounded options recover it. Deterministic engine; GenAI only explains; a human decides. '
             'Five slides, one per judging criterion, in rubric order.')


def criterion_slide(prs, idx, total):
    c = CRITERIA[idx]
    s = prs.slides.add_slide(prs.slide_layouts[6])
    set_background(s, criterion_bg(c['color']))
    chrome(s, idx + 2, total)
    header(s, c)
    rubric(s, idx)
    return s, c


def slide_impact(prs, total):
    s, c = criterion_slide(prs, 0, total)
    col = c['color']
    y = punch(s, ['Executable mission', 'readiness.'], col)
    y = answer(s, c, y)
    y = proof(s, y, 'The architecture executes.', 'Six swimlanes from mission commander to MH-60S detachment, recomputed against every status report.', col)
    y = proof(s, y, 'Responses simulated, not guessed.', 'Three bounded options scored on the thread. Reassigning a qualified reviewer turns −1h 15m into +1h 30m.', col)
    proof(s, y, 'Less for the Sailor to carry.', 'One screen: what breaks, why, and what fixes it, with every number linked to its source.', col)
    scr = screen(s, 'thread_1000', color=col)
    callout(s, scr, [0.44, 0.09, 0.116, 0.055], 'Controlling constraint', AMBER, below=True)
    callout(s, scr, [0.629, 0.512, 0.08, 0.088], 'Waits 1300–1645 · OS1 Vega', CRIT)
    callout(s, scr, [0.882, 0.213, 0.085, 0.069], '−1h 15m · not ready', CRIT, below=True, right=True)
    stat(s, VX + 22, VY + 380, '4 reports. 1 controls.', 'The analyst’s review window, not the hardware.', CRIT)
    caption(s, 'LIVE APP · USS CAPE CHARLES (LCS-42) · MCM THREAD AT 1000 · SYNTHETIC DATA')
    notes(s, f"{c['attack']}\n\nFive systems report status; only one controls the mission. At 1000 the engine shows the "
             'PMA reviewer\'s 1300–1645 absence, not the degraded USV or helo, sets the end time: −1h 15m, not ready. '
             'The bounded options are simulated on the same thread; reassigning a qualified reviewer recovers to +1h 30m.')


def slide_speed(prs, total):
    s, c = criterion_slide(prs, 1, total)
    col = c['color']
    y = punch(s, ['The link drops.', 'NAVIFI doesn’t.'], col)
    y = answer(s, c, y)
    y = proof(s, y, 'RHEL 9 + RKE2 + Zarf + UDS Core', 'One signed Zarf package installs air-gapped and keeps running in EMCON.', OK, kicker='PROFILE A · DEMONSTRATED')
    y = proof(s, y, 'OpenShift / CANES ACS', 'Same OCI images and Helm chart on the Navy’s PaaS. A transition target, not a certification claim.', AMBER, kicker='PROFILE B · TARGET', dash='dash')
    proof(s, y, 'Signed, scanned, attested.', 'Cosign · Syft SBOM · Grype CVE gate · OSCAL, every commit.', col)
    scr = screen(s, 'edge_emcon', color=col)
    callout(s, scr, [0.043, 0.148, 0.496, 0.547], 'One rack · no internet', OK, below=False)
    callout(s, scr, [0.549, 0.148, 0.445, 0.547], 'Commit to hull · signed · CVE-gated', CYAN, right=True)
    callout(s, scr, [0.252, 0.759, 0.096, 0.043], 'EMCON · still computing', AMBER, below=True)
    caption(s, 'LIVE APP · EDGE VIEW IN EMCON · SHIPBOARD STACK · AI-ASSISTED CI/CD · SYNTHETIC FLEET')
    notes(s, f"{c['attack']}\n\nNo new technology stack: NAVIFI is a container workload. Profile A is what we demo: RHEL 9, "
             'RKE2, Defense Unicorns UDS Core, delivered as one signed Zarf package across the air gap. Profile B is the '
             'transition target: the same images and Helm chart on OpenShift / CANES ACS. Cut the link (SATCOM, DDIL, '
             'EMCON) and the engine, options and audit keep running on the ship.')


def slide_scale(prs, total):
    s, c = criterion_slide(prs, 2, total)
    col = c['color']
    y = punch(s, ['One engine.', 'Every mission', 'thread.'], col)
    y = answer(s, c, y)
    tiles = [('4', 'MISSION THREADS', '60a5fa'), ('2', 'SHIP CLASSES', CYAN), ('3', 'HULLS', OK), ('1', 'ENGINE', AMBER)]
    tw = (LW - 3 * 12) / 4
    for j, (n, label, tc) in enumerate(tiles):
        tx = LX + j * (tw + 12)
        rect(s, tx, y, tw, 150, r=6, fill=PANEL, fa=0.9, line=tc, la=0.55, glow=tc, gr=10, ga=0.18)
        text(s, tx, y + 8, tw, 92, [P(R(n, HEAD, 84, tc, True, glow=tc, gr=14, ga=0.5))], align='c')
        text(s, tx + 8, y + 102, tw - 16, 44, [P(R(label, HEAD, 14, WHITE, True, 0.12), line=18)], align='c')
    text(s, LX, y + 166, LW, 60, [P(R('Threads are data: hand-laid for MCM, auto-laid from the dependency graph for every other mission. Zero engine rewrites.', BODY, 17, SOFT), line=24)])
    gw = (VW - 12) / 2
    shots = [('thread_0600', 'LCS-42', 'MINE COUNTERMEASURES · 12 H · HAND-LAID', CYAN),
             ('thread_ddg', 'DDG-170', 'AIR & MISSILE DEFENSE · 21 DAYS', AMBER),
             ('thread_vls', 'DDG-173', 'VLS RELOAD · 72 H', CRIT),
             ('thread_radar', 'DDG-170', 'RADAR REPAIR · 10 H', OK)]
    for j, (name, hull, mission, tc) in enumerate(shots):
        sx = VX + (j % 2) * (gw + 12)
        sy = VY + (j // 2) * (round(gw * 9 / 16) + 12)
        scr = screen(s, name, x=sx, y=sy, w=gw, color=tc)
        lw_ = max(measure(hull, HEAD, 26, True, 0.06), measure(mission, MONO, 11, True, 0.16)) + 34
        rect(s, sx + 12, sy + scr['h'] - 78, lw_, 64, fill=VOID, fa=0.9)
        rect(s, sx + 12, sy + scr['h'] - 78, 5, 64, fill=tc, glow=tc, gr=6, ga=0.5)
        text(s, sx + 30, sy + scr['h'] - 72, lw_ - 20, 56,
             [P(R(hull, HEAD, 26, WHITE, True, 0.06), line=30), P(R(mission, MONO, 11, tc, True, 0.16), line=16, before=4)], wrap_text=False)
    caption(s, 'LIVE APP · FOUR MISSION THREADS · TWO SHIP CLASSES · SAME ENGINE · SYNTHETIC DATA', y=VY + 2 * round(gw * 9 / 16) + 12 + 12)
    notes(s, f"{c['attack']}\n\nThe MCM thread is hand-laid; air and missile defense, VLS reload and radar repair are "
             'auto-laid from the same dependency graph. Four threads, two ship classes, three hulls, one engine. Mission '
             'threads, SoS interfaces and deployment profiles are configuration, so adding a ship class is data work.')


def slide_barriers(prs, total):
    s, c = criterion_slide(prs, 3, total)
    col = c['color']
    y = punch(s, ['The Sailor is not', 'the integration', 'layer.'], col)
    y = answer(s, c, y)
    y = proof(s, y, 'Read-only adapters. No re-entry.', 'Eight systems feed one picture. Nothing is typed twice; nothing is written back to the record of authority.', col)
    proof(s, y, 'Every number has a source.', 'Provenance chips link each value to its record. Missing, stale, contradictory and malformed data are flagged at ingest.', col)
    feeds = [('OMMS-NG', 'CASREP'), ('R-SUPPLY', 'parts'), ('NSIPS', 'orders'), ('SKED', 'schedule'),
             ('DRRS-N', 'readiness'), ('WATCHBILL', 'people'), ('MVCS', 'USV link'), ('AMHS', 'messages')]
    fx, fw, fh, step = VX, 236, 42, 54
    sx, sw = 1060, VX + VW - 1060
    sh = round(sw * 9 / 16)
    hub_y = VY + sh / 2
    for j, (sysname, what) in enumerate(feeds):
        fy = VY + j * step
        cx = s.shapes.add_connector(MSO_CONNECTOR.CURVE, px(fx + fw), px(fy + fh / 2), px(sx), px(hub_y))
        drop_style(cx)
        style_sppr(cx._element.spPr, line=AMBER, lw=2, la=0.7)
    for j, (sysname, what) in enumerate(feeds):
        fy = VY + j * step
        chip = rect(s, fx, fy, fw, fh, r=5, fill='030c16', fa=0.95, line=AMBER, la=0.6)
        text(s, 0, 0, 0, 0, [P(R(sysname, MONO, 19, 'fde68a', True, 0.1))], anchor='m', inset=(16, 0, 0, 0), shape=chip, wrap_text=False)
        text(s, fx, fy, fw - 14, fh, [P(R(what, MONO, 12, SLATE, False, 0.06))], align='r', anchor='m')
    picture(s, still('watch_mcm', out_w=round(sw * SCALE)), sx, VY, sw, sh, border=CYAN, ba=0.6, glow=CYAN, ga=0.3)
    hub = rect(s, sx + 16, VY + 16, 340, 76, r=6, fill=VOID, fa=0.92, line=CYAN, lw=2, glow=CYAN, gr=14, ga=0.45)
    text(s, 0, 0, 0, 0, [P(R('ONE OPERATIONAL PICTURE', HEAD, 22, WHITE, True, 0.08), line=28),
                         P(R('READ-ONLY · NO RE-ENTRY', MONO, 12, CYAN, True, 0.2), line=18, before=4)],
         anchor='m', inset=(18, 0, 10, 0), shape=hub, wrap_text=False)
    ty = VY + sh + 22
    cols = (VX + 22, 1330, 1580)
    text(s, cols[0], ty, 500, 22, [P(R('BASELINE VS ASSISTED', MONO, 12, col, True, 0.24))])
    text(s, cols[1], ty, 240, 22, [P(R('TABLETOP BASELINE *', MONO, 12, SLATE, True, 0.14))])
    text(s, cols[2], ty, 240, 22, [P(R('NAVIFI', MONO, 12, SLATE, True, 0.14))])
    rows = [('Time to a defensible answer after a change', '30–60 min', '6 ms'),
            ('Systems consulted per change', '5–7+ calls', '1 screen'),
            ('Data problems surfaced', 'When they bite', '4 of 4')]
    for j, (metric, base, assisted) in enumerate(rows):
        ry = ty + 28 + j * 50
        rect(s, VX, ry, VW, 44, fill=PANEL, fa=0.9, line=col if j == 0 else SLATE, la=0.7 if j == 0 else 0.18,
             glow=col if j == 0 else None, gr=10, ga=0.25)
        text(s, cols[0], ry, 560, 44, [P(R(metric, BODY, 18, TEXT))], anchor='m')
        text(s, cols[1], ry, 240, 44, [P(R(base, MONO, 17, SLATE, strike=True))], anchor='m')
        text(s, cols[2], ry, 240, 44, [P(R(assisted, HEAD, 28, col, True, glow=col, gr=10, ga=0.45))], anchor='m')
    text(s, VX, ty + 28 + 3 * 50 + 2, VW, 20,
         [P(R('* BASELINE IS A TEAM TABLETOP ESTIMATE, NOT MEASURED FLEET DATA · NAVIFI TIME MEASURED LIVE · SYNTHETIC DATA', MONO, 11, DIM, True, 0.14))])
    notes(s, f"{c['attack']}\n\nToday the Sailor is the integration layer: pull the CASREP, call supply, check the "
             'watchbill, redo the whiteboard. NAVIFI reads OMMS-NG, R-Supply, NSIPS, SKED, DRRS-N, the watchbill, MVCS and '
             'AMHS read-only and executes the workflow on one picture. Be explicit that the 30–60 minute baseline is our '
             'team\'s tabletop estimate, not fleet data.')


def slide_discretion(prs, total):
    s, c = criterion_slide(prs, 4, total)
    col = c['color']
    y = punch(s, ['The AI explains.', 'The human commands.'], col)
    y = answer(s, c, y)
    lines = [('Deterministic engine.', 'Same inputs, same answer, every time.', CYAN),
             ('GenAI only explains.', 'Identical answer with the LLM off.', VIOLET),
             ('Approve · reject · STOP.', 'Every call logged to a tamper-evident hash chain.', PURPLE),
             ('39/39 tests · 12/12 failure cases.', 'Run live, in front of the judges.', OK)]
    for lead, detail, lc in lines:
        y = proof(s, y, lead, detail, lc)
    scr = screen(s, 'thread_approved', color=col)
    callout(s, scr, [0.273, 0.09, 0.118, 0.054], '+1h 30m · qualified', OK, below=True)
    callout(s, scr, [0.803, 0.877, 0.185, 0.088], 'Decision logged · hash-chained', col, right=True)
    stat(s, VX + 22, VY + 395, '−1h 15m → +1h 30m', 'A human approved one bounded option.', col,
         foot='PLANNING ASSUMPTION, NEVER AN ORDER · SOURCE RECORDS UNCHANGED')
    caption(s, 'LIVE APP · MCM THREAD AFTER HUMAN APPROVAL · SYNTHETIC DATA')
    notes(s, f"{c['attack']}\n\nLive events propagate through the executable graph; the engine is deterministic and the "
             'LLM only narrates, with an identical answer when it is off. The watchstander approves, rejects or hits STOP; '
             'approval applies a planning assumption, never an order, and the source records stay unchanged. Every '
             'decision is hash-chained; tamper with the log and verification catches it, then restores from the edge copy.')


def export_previews(pptx):
    soffice = shutil.which('soffice')
    if not soffice or not shutil.which('pdftoppm'):
        print('LibreOffice/pdftoppm not found; skipping PDF and previews')
        return
    conf = BUILD / 'fonts.conf'
    conf.write_text('<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig>'
                    f'<include ignore_missing="yes">/etc/fonts/fonts.conf</include><dir>{FONTS}</dir>'
                    f'<cachedir>{BUILD / "fc-cache"}</cachedir></fontconfig>')
    env = dict(os.environ, FONTCONFIG_FILE=str(conf))
    subprocess.run([soffice, f'-env:UserInstallation=file://{BUILD / "lo-profile"}', '--headless',
                    '--convert-to', 'pdf', '--outdir', str(OUT), str(pptx)], check=True, env=env,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    pdf = OUT / f'{NAME}.pdf'
    prev = OUT / 'preview'
    shutil.rmtree(prev, ignore_errors=True)
    prev.mkdir()
    subprocess.run(['pdftoppm', '-png', '-r', '144', str(pdf), str(prev / 'slide')], check=True)
    print(pdf)
    print(prev)


def main():
    BUILD.mkdir(exist_ok=True)
    OUT.mkdir(exist_ok=True)
    prs = Presentation()
    prs.slide_width, prs.slide_height = px(W), px(H)
    builders = [slide_title, slide_impact, slide_speed, slide_scale, slide_barriers, slide_discretion]
    for b in builders:
        b(prs, len(builders))
    pptx = OUT / f'{NAME}.pptx'
    prs.save(pptx)
    print(pptx)
    export_previews(pptx)


if __name__ == '__main__':
    main()
