#!/usr/bin/env python3
"""NAVIFI deck, told as what the team built this week.

Plain Arial and native shapes, so it opens and edits the same on any machine; only the
app screenshots are images. The rubric-ordered pitch deck is deck/build.py.

usage: python3 deck/build_week.py
  -> deck/out/NAVIFI_this_week.pptx, plus a PDF and PNG previews when LibreOffice
     and pdftoppm are installed.
"""
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.dml import MSO_LINE
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Inches, Pt

DECK = Path(__file__).resolve().parent
STILLS = DECK.parent / 'video/footage/stills'
TEAM = DECK / 'team'
BUILD = DECK / 'build'
OUT = DECK / 'out'
NAME = 'NAVIFI_this_week'
FONT = 'Arial'

ABYSS = RGBColor(0x02, 0x06, 0x0C)
DEEP = RGBColor(0x07, 0x1A, 0x2C)
HULL = RGBColor(0x0A, 0x17, 0x26)
NODE = RGBColor(0x06, 0x12, 0x20)
CHIP = RGBColor(0x12, 0x22, 0x3A)
EDGE = RGBColor(0x1E, 0x3A, 0x52)
CYAN = RGBColor(0x22, 0xD3, 0xEE)
CYAN_DIM = RGBColor(0x15, 0x5E, 0x75)
VIOLET = RGBColor(0xA7, 0x8B, 0xFA)
AMBER = RGBColor(0xFB, 0xBF, 0x24)
GREEN = RGBColor(0x34, 0xD3, 0x99)
RED = RGBColor(0xFB, 0x3B, 0x5C)
BLUE = RGBColor(0x60, 0xA5, 0xFA)
SKY = RGBColor(0x7D, 0xD3, 0xFC)
INK = RGBColor(0xE0, 0xF2, 0xFE)
SOFT = RGBColor(0xB6, 0xCC, 0xDB)
MUTE = RGBColor(0x7F, 0x9C, 0xB3)

prs = Presentation()
prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)


class Slide:
    def __init__(self):
        self.slide = prs.slides.add_slide(prs.slide_layouts[6])
        self.S = self.slide.shapes
        bg = self.S.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
        bg.line.fill.background()
        bg.fill.gradient()
        bg.fill.gradient_angle = 90
        bg.fill.gradient_stops[0].color.rgb = DEEP
        bg.fill.gradient_stops[1].color.rgb = ABYSS
        bg.shadow.inherit = False

    def box(self, x, y, w, h, fill=None, line=None, radius=0.08, line_w=1.0):
        shp = self.S.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
        shp.adjustments[0] = radius
        if fill is None:
            shp.fill.background()
        else:
            shp.fill.solid()
            shp.fill.fore_color.rgb = fill
        if line is None:
            shp.line.fill.background()
        else:
            shp.line.color.rgb = line
            shp.line.width = Pt(line_w)
        shp.shadow.inherit = False
        tf = shp.text_frame
        tf.margin_left = tf.margin_right = Inches(0.08)
        tf.margin_top = tf.margin_bottom = Inches(0.04)
        tf.word_wrap = True
        return shp

    def rect(self, x, y, w, h, fill):
        shp = self.S.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
        shp.fill.solid()
        shp.fill.fore_color.rgb = fill
        shp.line.fill.background()
        shp.shadow.inherit = False
        return shp

    @staticmethod
    def text(target, paras, anchor=MSO_ANCHOR.MIDDLE, align=PP_ALIGN.CENTER, spacing=None):
        """paras: list of paragraphs; each paragraph is a list of (text, size, color, bold)."""
        tf = target.text_frame
        tf.vertical_anchor = anchor
        tf.word_wrap = True
        for i, runs in enumerate(paras):
            p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
            p.alignment = align
            if spacing:
                p.space_after = Pt(spacing)
            for t, size, color, bold in runs:
                r = p.add_run()
                r.text = t
                r.font.name = FONT
                r.font.size = Pt(size)
                r.font.color.rgb = color
                r.font.bold = bold
        return target

    def label(self, x, y, w, h, paras, **kw):
        tb = self.S.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
        tf = tb.text_frame
        tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
        kw.setdefault('align', PP_ALIGN.LEFT)
        return self.text(tb, paras, **kw)

    def line(self, x1, y1, x2, y2, color, width=1.75, head=True):
        c = self.S.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(x1), Inches(y1), Inches(x2), Inches(y2))
        c.line.color.rgb = color
        c.line.width = Pt(width)
        if head:
            ln = c.line._get_or_add_ln()
            ln.append(ln.makeelement(qn('a:tailEnd'), {'type': 'triangle', 'w': 'med', 'len': 'med'}))
        return c

    def header(self, kicker, title, subtitle_runs):
        self.label(0.6, 0.38, 12, 0.3, [[(kicker, 12, CYAN, True)]])
        self.label(0.6, 0.66, 12.2, 0.6, [[(title, 30, INK, True)]])
        self.label(0.6, 1.24, 12.2, 0.35, [subtitle_runs])

    def shot(self, name, x, y, w, color=EDGE, crop=None):
        """App screenshot downscaled from the 4K still, optionally cropped to a (left, top, right, bottom) pixel box."""
        jpg = BUILD / (f'week_{name}_{"_".join(map(str, crop))}.jpg' if crop else f'week_{name}.jpg')
        im = Image.open(STILLS / f'{name}.png').convert('RGB')
        if crop:
            im = im.crop(crop)
        cw, ch = im.size
        if not jpg.exists():
            scale = min(1.0, 1920 / cw)
            im.resize((round(cw * scale), round(ch * scale)), Image.LANCZOS).save(jpg, quality=88, optimize=True)
        h = w * ch / cw
        pic = self.S.add_picture(str(jpg), Inches(x), Inches(y), Inches(w), Inches(h))
        pic.line.color.rgb = color
        pic.line.width = Pt(1.25)
        return h

    def face(self, name, x, y, d, crop, ring):
        """Round headshot from deck/team, cropped to a square (left, top, size) pixel box."""
        png = BUILD / f'week_face_{name}.png'
        if not png.exists():
            left, top, size = crop
            im = Image.open(TEAM / f'{name}.jpg').convert('RGB').crop((left, top, left + size, top + size))
            im = im.resize((600, 600), Image.LANCZOS)
            mask = Image.new('L', (2400, 2400), 0)
            ImageDraw.Draw(mask).ellipse((0, 0, 2399, 2399), fill=255)
            im.putalpha(mask.resize((600, 600), Image.LANCZOS))
            im.save(png)
        self.S.add_picture(str(png), Inches(x), Inches(y), Inches(d), Inches(d))
        o = self.S.add_shape(MSO_SHAPE.OVAL, Inches(x - 0.05), Inches(y - 0.05), Inches(d + 0.1), Inches(d + 0.1))
        o.fill.background()
        o.line.color.rgb = ring
        o.line.width = Pt(2)
        o.shadow.inherit = False

    def card(self, x, y, w, h, color):
        self.box(x, y, w, h, fill=HULL, line=EDGE, radius=0.05)
        self.rect(x + 0.02, y + 0.02, w - 0.04, 0.06, color)

    def notes(self, text):
        self.slide.notes_slide.notes_text_frame.text = text


def beats(s, x, y, w, items, step=1.45, title_size=15, body_size=11.5):
    """Numbered beats down a column: (title, body, color)."""
    for i, (title, body, color) in enumerate(items, 1):
        s.label(x, y, 0.4, 0.4, [[(str(i), 20, color, True)]])
        s.label(x + 0.45, y + 0.02, w - 0.45, 0.32, [[(title, title_size, INK, True)]])
        s.label(x + 0.45, y + 0.38, w - 0.45, 0.8, [[(body, body_size, SOFT, False)]], anchor=MSO_ANCHOR.TOP)
        y += step


# ================================================================ 1. title
def slide_title():
    s = Slide()
    s.label(0.6, 0.55, 6, 0.3, [[('FLEETHACKER NORFOLK 2026', 12, CYAN, True)]])
    s.label(0.6, 0.9, 6, 1.0, [[('NAVIFI', 66, INK, True)]])
    s.label(0.6, 2.0, 5.7, 0.4, [[('A mission consequence engine for the watch floor', 18, SOFT, False)]])
    s.label(0.6, 2.45, 5.7, 0.45, [[('Know before it breaks the mission.', 22, CYAN, True)]])
    s.label(0.6, 3.15, 5.5, 1.0, [[(
        'We built it this week: the app, the engine under it, and a real cluster to run it on. '
        'This deck is what we did, what we hit, and where it stands.', 13, SOFT, False)]], anchor=MSO_ANCHOR.TOP)
    s.shot('thread_0600', 6.6, 0.75, 6.15, color=CYAN_DIM)

    days = [
        ('TUESDAY', CYAN, 'Engine and watch floor',
         'Consequence graph, Monte Carlo, hash-chained decision log, evidence pack, three scenarios'),
        ('WEDNESDAY', VIOLET, 'The mission thread',
         "Executable MCM thread, auto-laid threads, Connor's standalone mission engine, the video"),
        ('THURSDAY', GREEN, 'Live on our own cluster',
         'RHEL 9, RKE2 and UDS Core stood up on AWS; NAVIFI deployed from a git commit'),
    ]
    DW, DG, DY, DH = (12.15 - 2 * 0.25) / 3, 0.25, 4.85, 1.9
    for i, (day, color, title, body) in enumerate(days):
        x = 0.6 + i * (DW + DG)
        s.card(x, DY, DW, DH, color)
        s.label(x + 0.25, DY + 0.25, DW - 0.5, 0.25, [[(day, 11, color, True)]])
        s.label(x + 0.25, DY + 0.55, DW - 0.5, 0.35, [[(title, 17, INK, True)]])
        s.label(x + 0.25, DY + 1.0, DW - 0.5, 0.9, [[(body, 12, SOFT, False)]], anchor=MSO_ANCHOR.TOP)
        if i < 2:
            s.line(x + DW + 0.04, DY + DH / 2, x + DW + DG - 0.04, DY + DH / 2, MUTE, width=1.5)
    s.notes(
        "NAVIFI is a mission consequence engine for the watch floor: when status reports land, it shows which one "
        "actually controls the mission, what it costs, and which bounded options recover it.\n\n"
        "We built it this week. Tuesday was the engine and the watch floor. Wednesday was the executable mission "
        "thread; Connor also wrote a standalone mission engine, and we built the video. Wednesday night into "
        "Thursday we stood up a real cluster on AWS, on the same stack a ship would run, and deployed NAVIFI to it.\n\n"
        "Everything you will see uses synthetic data, and a human makes every decision.")


# ================================================================ 2. who we are
def slide_team():
    s = Slide()
    s.header('WHO WE ARE', 'A two-day sprint', [
        ('Questions, or a mission you want to see run through it? Email either of us.', 14, SOFT, False)])
    people = [
        ('bryce-schumacher', (70, 30, 520), CYAN, 'Bryce Schumacher', 'bschumacher@uncomn.com',
         'Built the NAVIFI app: the watch floor, the mission thread, the decision log and the evidence screens. '
         'Stood up the lab cluster on AWS.'),
        ('connor-barnsley', (60, 0, 520), VIOLET, 'Connor Barnsley', 'cbarnsley@uncomn.com',
         'Built the standalone mission engine: the dependency graph, Monte Carlo, the decision ledger, and naval '
         'and airlift mission packs, with 48 tests.'),
    ]
    CW, CG, CY, CH, D = (12.15 - 0.35) / 2, 0.35, 1.95, 4.6, 2.1
    for i, (photo, crop, color, name, email, body) in enumerate(people):
        x = 0.6 + i * (CW + CG)
        s.card(x, CY, CW, CH, color)
        s.face(photo, x + (CW - D) / 2, CY + 0.4, D, crop, color)
        s.label(x + 0.4, CY + D + 0.65, CW - 0.8, 0.45, [[(name, 22, INK, True)]], align=PP_ALIGN.CENTER)
        s.label(x + 0.45, CY + D + 1.15, CW - 0.9, 0.8, [[(body, 12.5, SOFT, False)]],
                align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.TOP)
        s.label(x + 0.4, CY + CH - 0.5, CW - 0.8, 0.3, [[(email, 13, color, True)]], align=PP_ALIGN.CENTER)
    s.label(0.6, 6.85, 12.15, 0.3, [[('NAVIFI  ·  FleetHacker Norfolk 2026', 11, MUTE, False)]], align=PP_ALIGN.CENTER)
    s.notes(
        "We're Bryce and Connor, and the two of us built this in a two-day sprint.\n\n"
        "Bryce built the NAVIFI app, the watch floor, mission thread, decision log and evidence screens, and stood "
        "up the lab cluster it runs on. Connor built the standalone mission engine: the dependency graph, Monte "
        "Carlo, the decision ledger and the naval and airlift mission packs.\n\n"
        "If you have questions, or a mission you want to see run through it, our emails are on the slide.")


# ================================================================ 3. the question
def slide_question():
    s = Slide()
    s.header('WHERE WE STARTED', 'Four reports land. Which one breaks the mission?', [
        ('Today a Sailor answers that by hand. We wanted the watch to see it on one screen.', 14, SOFT, False)])

    s.card(0.6, 1.85, 5.3, 2.75, AMBER)
    s.label(0.85, 2.05, 4.8, 0.3, [[('How it gets answered today', 14, AMBER, True)]])
    steps = ['Pull the CASREP', 'Call supply', 'Check the watchbill', 'Redo the whiteboard']
    for i, step in enumerate(steps):
        y = 2.5 + i * 0.42
        chip = s.box(0.85, y, 2.4, 0.33, fill=CHIP, radius=0.25)
        s.text(chip, [[(step, 11.5, INK, False)]])
        if i < len(steps) - 1:
            s.line(2.05, y + 0.33, 2.05, y + 0.42, MUTE, width=1.25)
    s.label(3.45, 2.5, 2.25, 1.6, [
        [('30–60 min', 22, AMBER, True)],
        [('per change, by our own tabletop estimate. Not measured fleet data.', 11, SOFT, False)],
    ], anchor=MSO_ANCHOR.TOP, spacing=4)

    s.card(0.6, 4.8, 5.3, 2.35, CYAN)
    s.label(0.85, 5.0, 4.8, 0.3, [[('What we built instead', 14, CYAN, True)]])
    s.label(0.85, 5.42, 4.85, 1.6, [
        [('NAVIFI reads the records of eight systems, read-only, and recomputes the mission in milliseconds.', 12.5, INK, False)],
        [('Every number links back to the record it came from. Nothing is typed twice or written back.', 12, SOFT, False)],
    ], anchor=MSO_ANCHOR.TOP, spacing=8)

    h = s.shot('watch_mcm', 6.25, 1.85, 6.5, color=CYAN_DIM)
    feeds = ['OMMS-NG', 'R-SUPPLY', 'NSIPS', 'SKED', 'DRRS-N', 'WATCHBILL', 'MVCS', 'AMHS']
    FW, FG = (6.5 - 3 * 0.12) / 4, 0.12
    for i, name in enumerate(feeds):
        x = 6.25 + (i % 4) * (FW + FG)
        y = 1.85 + h + 0.2 + (i // 4) * 0.45
        chip = s.box(x, y, FW, 0.36, fill=HULL, line=AMBER, radius=0.2)
        s.text(chip, [[(name, 11, AMBER, True)]])
    s.label(6.25, 1.85 + h + 1.18, 6.5, 0.3, [[('Eight systems in one picture. Synthetic records for now.', 11, MUTE, False)]])
    s.notes(
        "We started from one question: when four status reports land at once, which one actually breaks the mission?\n\n"
        "Today the Sailor is the integration layer: pull the CASREP, call supply, check the watchbill, redo the "
        "whiteboard. Our own tabletop estimate is 30 to 60 minutes per change; that is our estimate, not fleet data.\n\n"
        "NAVIFI reads the records of eight systems read-only (OMMS-NG, R-Supply, NSIPS, SKED, DRRS-N, the watchbill, "
        "MVCS and AMHS; synthetic for now), puts them in one picture, and recomputes in milliseconds. Every number "
        "links to its source record, and nothing is written back.")


# ================================================================ 3. the mission thread
def slide_thread():
    s = Slide()
    s.header('WHAT WE BUILT', 'We made the mission itself executable', [
        ('Operation Open Passage: mine countermeasures for USS CAPE CHARLES (LCS-42), synthetic data', 14, SOFT, False)])
    s.shot('thread_1000', 0.6, 1.85, 7.7, color=CYAN_DIM)
    beats(s, 8.65, 1.9, 4.1, [
        ('Six swimlanes, one thread',
         'Mission commander to the MH-60S detachment, recomputed on every status report.', CYAN),
        ('Four reports in. One controls.',
         "At 1000 it points at the analyst's review window, not the degraded USV or helo: −1h 15m, not ready.", RED),
        ('Fixes simulated, not guessed',
         'Three bounded options run on the same thread. Reassigning a qualified reviewer gets to +1h 30m.', GREEN),
    ])
    s.label(0.6, 6.3, 7.7, 0.3, [[('The live app at 1000, mid-mission', 11, MUTE, False)]])
    s.notes(
        "We took the mine countermeasures mission for USS Cape Charles and made it an executable thread: six "
        "swimlanes from the mission commander to the MH-60S detachment, recomputed on every status report.\n\n"
        "At 1000 four reports are in. The engine shows that the one controlling the end time is the PMA reviewer's "
        "1300 to 1645 absence, not the degraded USV or helo: minus 1 hour 15, not ready.\n\n"
        "The bounded options are simulated on the same thread. Reassigning a qualified reviewer recovers to plus "
        "1 hour 30.")


# ================================================================ 4. who decides
def slide_decides():
    s = Slide()
    s.header('WHO DECIDES', 'The AI explains. A person decides.', [
        ('We kept the AI out of the math on purpose.', 14, SOFT, False)])
    items = [
        ('Deterministic engine', 'Same inputs, same answer, every time.', CYAN),
        ('The AI only narrates', 'Switch the language model off and the answer is identical.', VIOLET),
        ('Approve, reject or STOP', 'Approving applies a planning assumption, never an order. Source records stay untouched.', AMBER),
        ('Every decision on a hash chain', 'Tamper with the log and verification catches it, then restores from the edge copy.', GREEN),
    ]
    y = 1.85
    for title, body, color in items:
        s.card(0.6, y, 4.25, 1.02, color)
        s.label(0.85, y + 0.2, 3.8, 0.3, [[(title, 14, INK, True)]])
        s.label(0.85, y + 0.52, 3.8, 0.5, [[(body, 11, SOFT, False)]], anchor=MSO_ANCHOR.TOP)
        y += 1.14
    s.shot('thread_approved', 5.15, 1.85, 7.6, color=CYAN_DIM)
    s.label(5.15, 1.85 + 7.6 * 9 / 16 + 0.12, 7.6, 0.3,
            [[('After a person approved one option: −1h 15m became +1h 30m, and the decision went on the log', 11, MUTE, False)]])
    s.notes(
        "We kept the AI out of the math on purpose. The engine is deterministic: same inputs, same answer. The "
        "language model only explains the answer, and with it switched off the answer is identical.\n\n"
        "The watchstander approves, rejects or hits STOP. Approving applies a planning assumption, never an order, "
        "and the source records stay unchanged. Every decision goes on a hash-chained log; tamper with it and "
        "verification catches it, then restores from the edge copy.")


# ================================================================ 5. tried to break it
def slide_break():
    s = Slide()
    s.header('THEN WE TRIED TO BREAK IT', 'Twelve ways a real watch could trip it up', [
        ('We wrote the failure cases down, and the app runs every one of them live against the engine.', 14, SOFT, False)])
    groups = [
        ('Bad data', AMBER, ['Missing input', 'Stale input', 'Contradictory sources', 'Malformed record']),
        ('Bad conditions', GREEN, ['Disconnected (EMCON)', 'LLM unavailable']),
        ('Hard problems', VIOLET, ['Nonlinear consequence', 'Hidden cliff', 'No single fix works']),
        ('Known answers', CYAN, ['Classic baseline', 'Part slips to 1330', 'Team slips to 1600']),
    ]
    y = 1.85
    for name, color, cases in groups:
        s.label(0.6, y, 2.0, 0.3, [[(name, 12.5, color, True)]])
        for j, case in enumerate(cases):
            x = 2.55 + (j % 2) * 2.2
            cy = y + (j // 2) * 0.42
            chip = s.box(x, cy - 0.03, 2.08, 0.34, fill=CHIP, line=color, radius=0.25)
            s.text(chip, [[(case, 10.5, INK, False)]])
        y += 0.42 * ((len(cases) + 1) // 2) + 0.3

    facts = [('12', 'failure cases, run live'), ('39', 'app tests'), ('48', "tests on Connor's engine")]
    for i, (big, small) in enumerate(facts):
        fx = 0.6 + i * 2.2
        s.label(fx, 6.35, 0.65, 0.55, [[(big, 26, CYAN, True)]], anchor=MSO_ANCHOR.MIDDLE)
        s.label(fx + 0.68, 6.35, 1.4, 0.55, [[(small, 11, SOFT, False)]], anchor=MSO_ANCHOR.MIDDLE)

    # Failure-case table only; the rest of the evidence screen is the event's scoring map.
    h = s.shot('evidence', 7.15, 1.95, 5.6, color=CYAN_DIM, crop=(150, 590, 2920, 1575))
    s.label(7.15, 1.95 + h + 0.08, 5.6, 0.3, [[('The failure-case table in the app, all twelve passing', 10.5, MUTE, False)]])
    cy = 1.95 + h + 0.6
    s.card(7.15, cy, 5.6, 1.45, AMBER)
    s.label(7.4, cy + 0.2, 5.1, 1.2, [
        [('We wrote down what it does not do yet, too', 12.5, AMBER, True)],
        [('Durations are planner estimates, delays are treated as independent, and the picture is one ship. '
          'Those limits are on the evidence screen next to the results.', 11, SOFT, False)],
    ], anchor=MSO_ANCHOR.TOP, spacing=5)
    s.notes(
        "Then we tried to break it. We wrote twelve failure cases a real watch would hit: missing, stale, "
        "contradictory and malformed data; losing the link in EMCON; the language model being unavailable; and hard "
        "problems like a nonlinear consequence, a hidden cliff, and a case where no single fix works. The app runs "
        "every one live against the engine.\n\n"
        "Behind that are 39 app tests, and Connor's new standalone engine has 48 of its own.\n\n"
        "We also wrote down what it does not do yet: durations are planner estimates, delays are treated as "
        "independent, and it is a single-ship picture. Those limits sit on the evidence screen next to the results.")


# ================================================================ 6. more missions
def slide_missions():
    s = Slide()
    s.header('ONE ENGINE', 'Then we pointed it at three more missions', [
        ('We laid out the MCM thread by hand. The same engine laid out the rest from their dependency graphs.', 14, SOFT, False)])
    facts = [('4', 'mission threads', BLUE), ('2', 'ship classes', CYAN), ('3', 'hulls', GREEN), ('0', 'engine rewrites', AMBER)]
    for i, (big, small, color) in enumerate(facts):
        y = 1.95 + i * 1.0
        s.label(0.6, y, 1.0, 0.8, [[(big, 40, color, True)]], anchor=MSO_ANCHOR.MIDDLE)
        s.label(1.5, y, 2.8, 0.8, [[(small, 16, INK, True)]], anchor=MSO_ANCHOR.MIDDLE)
    s.label(0.6, 6.0, 3.9, 0.9, [[(
        'Threads, interfaces and deployment profiles are configuration, so a new ship class is data work, not code.',
        11.5, SOFT, False)]], anchor=MSO_ANCHOR.TOP)

    shots = [('thread_0600', 'LCS-42', 'Mine countermeasures · 12 h · hand-laid', CYAN),
             ('thread_ddg', 'DDG-170', 'Air and missile defense · 21 days', AMBER),
             ('thread_vls', 'DDG-173', 'VLS reload · 72 h', RED),
             ('thread_radar', 'DDG-170', 'Radar repair · 10 h', GREEN)]
    GW, GG = (12.75 - 4.7 - 0.15) / 2, 0.15
    GH = GW * 9 / 16
    for i, (name, hull, mission, color) in enumerate(shots):
        x = 4.7 + (i % 2) * (GW + GG)
        y = 1.85 + (i // 2) * (GH + GG)
        s.shot(name, x, y, GW, color=color)
        tag = s.box(x + 0.1, y + GH - 0.58, 2.9, 0.48, fill=ABYSS, line=color, radius=0.12)
        s.text(tag, [[(hull, 12, INK, True)], [(mission, 9.5, color, True)]], align=PP_ALIGN.LEFT)
    s.notes(
        "We laid out the mine countermeasures thread by hand. Then we pointed the same engine at three more "
        "missions and it laid them out from their dependency graphs: air and missile defense over 21 days, a VLS "
        "reload over 72 hours, and a radar repair over 10 hours. Four threads, two ship classes, three hulls, and "
        "no changes to the engine.\n\n"
        "Mission threads, system interfaces and deployment profiles are configuration, so adding a ship class is "
        "data work.")


# ================================================================ 7. built the platform (same as docs/slides)
def slide_platform_built():
    s = Slide()
    s.header('NAVIFI  ·  INFRASTRUCTURE', 'Built this week: a full Kubernetes platform on AWS', [
        ('From terraform apply to a hardened cluster serving NAVIFI at ', 14, SOFT, False),
        ('navifi.uds.demo.uncomn.ai', 14, CYAN, True),
        (', all from code in the repo', 14, SOFT, False),
    ])

    steps = [
        ('1', 'TERRAFORM', 'Provision AWS', AMBER,
         'Node, firewall, IAM role, load balancer rules, TLS certificate and DNS', '27 resources, one apply'),
        ('2', 'FIRST BOOT', 'Harden the host', SKY,
         'RHEL 9 with SELinux enforcing. SSM agent instead of SSH, no key pair', 'user-data.sh'),
        ('3', 'RKE2', 'Install Kubernetes', CYAN,
         'Single-node RKE2 v1.36 with SELinux, plus the kernel setup Istio needs', 'install-rke2.sh'),
        ('4', 'UDS CORE', 'Install the platform', VIOLET,
         'Zarf init, then UDS Core 1.14: policy, mTLS, SSO, logs, metrics, backups', 'install-core.sh, signed'),
        ('5', 'NAVIFI', 'Deploy the app', GREEN,
         'Any git commit: build, test, package with Zarf, roll out into the cluster', 'deploy.sh, SBOM per build'),
    ]
    SX, SY, SW, SH, SG = 0.6, 1.85, 2.25, 2.05, 0.225
    for i, (num, kicker, title, color, desc, tag) in enumerate(steps):
        x = SX + i * (SW + SG)
        s.box(x, SY, SW, SH, fill=HULL, line=EDGE, radius=0.06)
        s.rect(x + 0.02, SY + 0.02, SW - 0.04, 0.06, color)
        s.label(x + 0.18, SY + 0.2, SW - 0.36, 0.25, [[(num + '   ', 12, color, True), (kicker, 11, color, True)]])
        s.label(x + 0.18, SY + 0.5, SW - 0.36, 0.3, [[(title, 15, INK, True)]])
        s.label(x + 0.18, SY + 0.86, SW - 0.36, 0.75, [[(desc, 11, SOFT, False)]], anchor=MSO_ANCHOR.TOP)
        s.label(x + 0.18, SY + SH - 0.36, SW - 0.36, 0.25, [[(tag, 10, MUTE, False)]], anchor=MSO_ANCHOR.BOTTOM)
        if i < len(steps) - 1:
            gx = x + SW
            s.line(gx + 0.04, SY + SH / 2, gx + SG - 0.04, SY + SH / 2, MUTE, width=1.5)

    BY, BH = 4.2, 2.95
    s.box(0.6, BY, 3.75, BH, fill=HULL, line=EDGE, radius=0.05)
    s.label(0.85, BY + 0.2, 3.3, 0.3, [[('Where it runs', 14, AMBER, True)]])
    s.label(0.85, BY + 0.62, 3.3, 2.2, [
        [('AWS us-east-1', 12, INK, True), (', inside the existing lab VPC', 11.5, SOFT, False)],
        [('EC2 m7i.2xlarge', 12, INK, True), (': 8 vCPU, 32 GiB', 11.5, SOFT, False)],
        [('RHEL 9', 12, INK, True), (' with SELinux enforcing', 11.5, SOFT, False)],
        [('Behind an AWS load balancer with TLS', 11.5, SOFT, False)],
        [('navifi.uds.demo.uncomn.ai', 12, CYAN, True)],
    ], anchor=MSO_ANCHOR.TOP, spacing=7)

    PX, PW = 4.55, 4.45
    s.box(PX, BY, PW, BH, fill=HULL, line=EDGE, radius=0.05)
    s.label(PX + 0.25, BY + 0.2, PW - 0.5, 0.3, [[('Real problems we solved on the way', 14, VIOLET, True)]])
    problems = [
        ('SELinux locked a 2nd registry pod out of its volume', 'pinned the registry to one replica'),
        ("RKE2 1.36's Gateway API CRDs blocked UDS Core", "turned RKE2's bundled ingress off"),
        ('MinIO stopped publishing public images', 'moved to the Chainguard build'),
        ('Tight storage rules cut Loki off from the API', 'added explicit Kubernetes API rules'),
    ]
    tf = s.label(PX + 0.25, BY + 0.62, PW - 0.5, 2.25, [], anchor=MSO_ANCHOR.TOP).text_frame
    for i, (lead, fix) in enumerate(problems):
        for j, runs in enumerate(([(lead, 11, INK, False)], [('→  ', 11, VIOLET, True), (fix, 11, GREEN, False)])):
            p = tf.paragraphs[0] if (i == 0 and j == 0) else tf.add_paragraph()
            p.space_after = Pt(1 if j == 0 else 9)
            for t, size, color, bold in runs:
                r = p.add_run()
                r.text, r.font.name, r.font.size, r.font.color.rgb, r.font.bold = t, FONT, Pt(size), color, bold

    CX, CW = 9.2, 3.55
    s.box(CX, BY, CW, BH, fill=HULL, line=EDGE, radius=0.05)
    s.label(CX + 0.25, BY + 0.2, CW - 0.5, 0.3, [[('All in code', 14, CYAN, True)]])
    facts = [
        ('27', 'AWS resources from one Terraform apply'),
        ('4', 'scripts from first boot to live app'),
        ('3', 'Zarf and UDS packages, platform to app'),
    ]
    for i, (big, small) in enumerate(facts):
        fy = BY + 0.62 + i * 0.62
        s.label(CX + 0.25, fy, 0.75, 0.5, [[(big, 24, CYAN, True)]], anchor=MSO_ANCHOR.MIDDLE)
        s.label(CX + 1.0, fy, CW - 1.2, 0.5, [[(small, 11.5, SOFT, False)]], anchor=MSO_ANCHOR.MIDDLE)
    s.label(CX + 0.25, BY + BH - 0.42, CW - 0.5, 0.28, [[('Rebuild it from infra/README.md', 10.5, MUTE, False)]])

    s.notes(
        "This week we built the platform under NAVIFI as well as the app: a real Kubernetes cluster in AWS, "
        "running the same stack we plan to run aboard ship.\n\n"
        "Five steps, all in the repo. Terraform creates the node, its firewall, IAM role, load balancer rules, "
        "TLS certificate and DNS: 27 resources in one apply. First boot hardens the RHEL 9 host with SELinux "
        "enforcing and no SSH; we get in through AWS Systems Manager. A script installs RKE2 Kubernetes. Another "
        "installs Defense Unicorns' UDS Core through Zarf, with the platform packages signature-verified. The "
        "last one takes any git commit, builds and tests it, packages it with Zarf and rolls it out.\n\n"
        "It runs in AWS us-east-1 on one m7i.2xlarge with 8 vCPUs and 32 GiB, inside the existing lab network, "
        "behind the lab's load balancer, at navifi.uds.demo.uncomn.ai.\n\n"
        "It was not a copy-paste install. We hit and fixed real problems: SELinux locking a second registry pod "
        "out of its storage, RKE2's newest release shipping CRDs that blocked UDS Core, MinIO pulling its public "
        "images, and our own tighter network rules cutting Loki off from the Kubernetes API.")


# ================================================================ 8. how the cluster fits together (same as docs/slides)
def slide_platform_arch():
    s = Slide()
    s.header('NAVIFI  ·  LAB CLUSTER ON AWS', "One hardened node running the ship's stack", [
        ('RHEL 9  ·  RKE2 Kubernetes  ·  Defense Unicorns UDS Core  ·  Zarf', 14, SOFT, False),
        ('      live at ', 14, MUTE, False),
        ('navifi.uds.demo.uncomn.ai', 14, CYAN, True),
    ])
    TOP = 1.8

    public = s.box(0.6, 2.2, 1.6, 0.8, line=MUTE, radius=0.18)
    s.text(public, [[('Users', 12, INK, True)], [('any browser', 10.5, MUTE, False)]])
    oper = s.box(0.6, 5.3, 1.6, 0.8, line=MUTE, radius=0.18)
    s.text(oper, [[('Operator', 12, INK, True)], [('AWS IAM', 10.5, MUTE, False)]])

    alb = s.box(2.6, 2.0, 1.6, 1.6, fill=HULL, line=AMBER, line_w=1.25)
    s.text(alb, [
        [('Load balancer', 12, INK, True)],
        [('TLS via AWS ACM', 10.5, SOFT, False)],
        [('NAVIFI: public', 10.5, GREEN, True)],
        [('Admin tools: operator IPs only', 10.5, SOFT, False)],
    ], spacing=3)
    s.label(2.6, 3.75, 1.6, 0.5, [[("The node's firewall admits only this load balancer", 10, MUTE, False)]], align=PP_ALIGN.CENTER)

    NX, NW = 4.55, 3.9
    s.box(NX, TOP, NW, 4.55, fill=NODE, line=CYAN_DIM, radius=0.04, line_w=1.25)
    s.label(NX + 0.2, TOP + 0.1, NW - 0.4, 0.45, [
        [('AWS EC2  ·  RHEL 9  ·  SELinux enforcing', 11.5, INK, True)],
        [('RKE2 Kubernetes v1.36  ·  8 vCPU  ·  32 GiB', 10.5, MUTE, False)],
    ])

    IX, IW = NX + 0.2, NW - 0.4
    gw = s.box(IX, 2.45, IW, 0.42, fill=HULL, line=CYAN)
    s.text(gw, [[('Istio ingress gateways', 11.5, INK, True), ('   tenant  ·  admin', 10.5, MUTE, False)]])
    app = s.box(IX, 3.1, 1.75, 0.95, fill=CYAN, radius=0.1)
    s.text(app, [[('NAVIFI', 16, ABYSS, True)], [('app + audit volume', 10.5, ABYSS, False)]])
    reg = s.box(IX + 1.9, 3.1, IW - 1.9, 0.44, fill=HULL, line=EDGE)
    s.text(reg, [[('Zarf registry', 11, SOFT, True)]])
    minio = s.box(IX + 1.9, 3.61, IW - 1.9, 0.44, fill=HULL, line=EDGE)
    s.text(minio, [[('MinIO storage', 11, SOFT, True)]])

    s.box(IX, 4.22, IW, 1.98, fill=HULL, line=VIOLET, radius=0.05, line_w=1.25)
    s.label(IX + 0.12, 4.29, IW - 0.24, 0.3, [[('UDS Core 1.14', 12, VIOLET, True), ('   wraps every workload', 10.5, MUTE, False)]])
    chips = [
        'Pepr admission policy', 'Istio ambient mTLS',
        'App network policies', 'Keycloak sign-in',
        'Falco runtime alerts', 'Vector + Loki logs',
        'Prometheus + Grafana', 'Velero backups',
    ]
    CW2, CH, GX, GY = (IW - 0.24 - 0.1) / 2, 0.31, 0.1, 0.07
    for i, name in enumerate(chips):
        cx = IX + 0.12 + (i % 2) * (CW2 + GX)
        cy = 4.66 + (i // 2) * (CH + GY)
        chip = s.box(cx, cy, CW2, CH, fill=CHIP, radius=0.25)
        chip.text_frame.margin_left = chip.text_frame.margin_right = Inches(0.03)
        s.text(chip, [[(name, 10, INK, False)]])

    s.line(2.2, 2.6, 2.6, 2.6, CYAN)
    s.line(4.2, 2.66, IX, 2.66, CYAN)
    s.line(IX + 0.875, 2.87, IX + 0.875, 3.1, CYAN)
    s.line(2.2, 5.7, NX, 5.7, MUTE)
    s.label(2.32, 5.38, 2.2, 0.28, [[('SSM session  ·  no SSH, no keys', 10, SOFT, False)]])

    RX, RW = 8.85, 3.9
    blocks = [
        ('Locked down by default', CYAN, [
            'SSM sessions only, logged in CloudTrail',
            'Only NAVIFI is public; admin tools return 404',
            'Default-deny network policy and mTLS',
        ]),
        ('Commit to live in one command', GREEN, [
            'Typecheck and tests gate every image build',
            'Zarf packages it with an SBOM, air-gap style',
            'Every commit gets its own image tag',
        ]),
        ('Mirrors the shipboard deploy', AMBER, [
            'Same RHEL 9, RKE2, UDS Core and Zarf',
            'Lab only: TLS at the load balancer, sign-in off',
            'Ship adds DISA STIG, FIPS and Keycloak SSO',
        ]),
    ]
    by = TOP
    for title, color, bullets in blocks:
        s.rect(RX, by + 0.04, 0.06, 1.32, color)
        s.label(RX + 0.22, by, RW - 0.22, 0.32, [[(title, 14, color, True)]])
        s.label(RX + 0.22, by + 0.38, RW - 0.22, 1.0,
                [[('›  ', 11.5, color, True), (b, 11.5, INK, False)] for b in bullets],
                anchor=MSO_ANCHOR.TOP, spacing=4)
        by += 1.55

    s.box(0.6, 6.55, 12.15, 0.74, fill=HULL, line=EDGE, radius=0.12)
    stats = [
        ('8 vCPU · 32 GiB', 'the whole platform on one node'),
        ('0', 'node ports open to the internet'),
        ('Signed', 'Sigstore-verified, SBOM per build'),
        ('1 command', 'from any git commit to live'),
    ]
    SWS = 12.15 / len(stats)
    for i, (big, small) in enumerate(stats):
        sx = 0.6 + i * SWS
        s.label(sx + 0.25, 6.6, SWS - 0.35, 0.64, [[(big, 17, CYAN, True)], [(small, 10.5, SOFT, False)]])
        if i:
            s.line(sx, 6.67, sx, 7.17, EDGE, width=1, head=False)

    s.notes(
        "NAVIFI runs on the same stack it will use aboard ship: RHEL 9 with SELinux enforcing, RKE2 Kubernetes, "
        "and Defense Unicorns' UDS Core, all packaged with Zarf. Here it is one EC2 node behind an AWS load "
        "balancer.\n\n"
        "Traffic: the load balancer terminates TLS and serves only navifi.uds.demo.uncomn.ai to the public. "
        "Grafana, Keycloak and the UDS portal answer 404 unless the request comes from an operator IP. The node "
        "accepts traffic only from the load balancer, and there is no SSH: operators get in through AWS Systems "
        "Manager, authenticated by IAM and logged in CloudTrail.\n\n"
        "Inside the cluster, UDS Core wraps NAVIFI like every other workload: Pepr admission policies, Istio "
        "ambient mTLS, deny-by-default network policies generated from the app's Package, Falco runtime "
        "detection, and central logs and metrics.\n\n"
        "Delivery: one command takes any git commit, runs typecheck and tests in the image build, wraps the "
        "image in a Zarf package with an SBOM, and deploys it through the in-cluster registry, the same way the "
        "air-gapped ship bundle works. The lab differs only where an AWS demo needs it: TLS at the load balancer "
        "and sign-in off so the demo opens without an account. The ship build adds DISA STIG, FIPS and Keycloak SSO.")


# ================================================================ 9. the same picture aboard ship
def slide_ship_arch():
    """Slide 8's layout box for box, with everything that differs from the lab in amber."""
    s = Slide()
    s.header('NAVIFI  ·  THEORETICAL SHIPBOARD DEPLOYMENT', 'The same stack aboard, air-gapped', [
        ('RHEL 9  ·  RKE2 Kubernetes  ·  Defense Unicorns UDS Core  ·  Zarf', 14, SOFT, False),
        ('      same as the lab', 14, MUTE, False),
    ])
    s.box(9.55, 1.33, 0.32, 0.16, fill=AMBER, radius=0.3)
    s.label(9.97, 1.24, 2.8, 0.35, [[('Amber: changes from the lab', 12, AMBER, True)]], anchor=MSO_ANCHOR.MIDDLE)
    TOP = 1.8

    crew = s.box(0.6, 2.2, 1.6, 0.8, line=AMBER, radius=0.18)
    s.text(crew, [[('Watchstanders', 12, INK, True)], [('CAC, ship terminal', 10.5, AMBER, False)]])
    pier = s.box(0.6, 5.3, 1.6, 0.8, line=AMBER, radius=0.18)
    s.text(pier, [[('Pier side', 12, INK, True)], [('builds the bundle', 10.5, AMBER, False)]])

    lan = s.box(2.6, 2.0, 1.6, 1.6, fill=HULL, line=AMBER, line_w=1.25)
    s.text(lan, [
        [("Ship's LAN", 12, INK, True)],
        [('No route to the internet', 10.5, AMBER, True)],
        [('Admin tools: ship IT only', 10.5, SOFT, False)],
    ], spacing=3)
    s.label(2.6, 3.75, 1.6, 0.5, [[('Off-ship: audit to shore only, none in EMCON', 10, AMBER, False)]], align=PP_ALIGN.CENTER)

    NX, NW = 4.55, 3.9
    s.box(NX, TOP, NW, 4.55, fill=NODE, line=CYAN_DIM, radius=0.04, line_w=1.25)
    s.label(NX + 0.2, TOP + 0.1, NW - 0.4, 0.45, [
        [('Ship rack', 11.5, AMBER, True), ('  ·  RHEL 9  ·  SELinux enforcing', 11.5, INK, True)],
        [('RKE2 v1.36  ·  ', 10.5, MUTE, False), ('STIG, FIPS, CIS  ·  3 nodes', 10.5, AMBER, False)],
    ])

    IX, IW = NX + 0.2, NW - 0.4
    gw = s.box(IX, 2.45, IW, 0.42, fill=HULL, line=CYAN)
    s.text(gw, [[('Istio ingress gateways', 11.5, INK, True), ('   TLS ends here', 10.5, AMBER, True)]])
    app = s.box(IX, 3.1, 1.75, 0.95, fill=CYAN, radius=0.1)
    s.text(app, [[('NAVIFI', 16, ABYSS, True)], [('app + audit volume', 10.5, ABYSS, False)]])
    reg = s.box(IX + 1.9, 3.1, IW - 1.9, 0.44, fill=HULL, line=EDGE)
    s.text(reg, [[('Zarf registry', 11, SOFT, True)]])
    narr = s.box(IX + 1.9, 3.61, IW - 1.9, 0.44, fill=HULL, line=AMBER)
    s.text(narr, [[('AI narrator, optional', 10.5, AMBER, True)]])

    s.box(IX, 4.22, IW, 1.98, fill=HULL, line=VIOLET, radius=0.05, line_w=1.25)
    s.label(IX + 0.12, 4.29, IW - 0.24, 0.3, [[('UDS Core', 12, VIOLET, True), ('   Iron Bank images', 10.5, AMBER, True)]])
    chips = [
        ('Pepr admission policy', False), ('Istio ambient mTLS', False),
        ('App network policies', False), ('Keycloak CAC sign-in', True),
        ('Falco runtime alerts', False), ('Vector + Loki logs', False),
        ('Prometheus + Grafana', False), ('Velero backups', False),
    ]
    CW2, CH, GX, GY = (IW - 0.24 - 0.1) / 2, 0.31, 0.1, 0.07
    for i, (name, changed) in enumerate(chips):
        cx = IX + 0.12 + (i % 2) * (CW2 + GX)
        cy = 4.66 + (i // 2) * (CH + GY)
        chip = s.box(cx, cy, CW2, CH, fill=CHIP, line=AMBER if changed else None, radius=0.25)
        chip.text_frame.margin_left = chip.text_frame.margin_right = Inches(0.03)
        s.text(chip, [[(name, 10, AMBER if changed else INK, changed)]])

    s.line(2.2, 2.6, 2.6, 2.6, CYAN)
    s.line(4.2, 2.66, IX, 2.66, CYAN)
    s.line(IX + 0.875, 2.87, IX + 0.875, 3.1, CYAN)
    s.line(2.2, 5.7, NX, 5.7, AMBER)
    s.label(2.32, 5.38, 2.2, 0.28, [[('UDS bundle  ·  sneakernet or DDIL', 10, AMBER, False)]])

    RX, RW = 8.85, 3.9
    blocks = [
        ('Cut off by design', CYAN, [
            'No internet route; nothing downloads at sea',
            'CAC sign-in through Keycloak',
            'Default-deny network policy and mTLS',
        ]),
        ('Works with the link down', GREEN, [
            'SATCOM: audit goes ashore in batches',
            'DDIL: one entry at a time, local model',
            'EMCON: nothing leaves, everything works',
        ]),
        ('What changes from the lab', AMBER, [
            'One air-gapped bundle, not a git build',
            'TLS at the Istio gateway, no load balancer',
            'DISA STIG, FIPS, CIS and Iron Bank images',
        ]),
    ]
    by = TOP
    for title, color, bullets in blocks:
        s.rect(RX, by + 0.04, 0.06, 1.32, color)
        s.label(RX + 0.22, by, RW - 0.22, 0.32, [[(title, 14, color, True)]])
        s.label(RX + 0.22, by + 0.38, RW - 0.22, 1.0,
                [[('›  ', 11.5, color, True), (b, 11.5, INK, False)] for b in bullets],
                anchor=MSO_ANCHOR.TOP, spacing=4)
        by += 1.55

    s.box(0.6, 6.55, 12.15, 0.74, fill=HULL, line=EDGE, radius=0.12)
    stats = [
        ('1 bundle', 'Zarf init, UDS Core and NAVIFI'),
        ('0', 'downloads at sea, model included'),
        ('Signed', 'Sigstore-verified, SBOM per build'),
        ('3 link states', 'SATCOM, DDIL and EMCON'),
    ]
    SWS = 12.15 / len(stats)
    for i, (big, small) in enumerate(stats):
        sx = 0.6 + i * SWS
        s.label(sx + 0.25, 6.6, SWS - 0.35, 0.64, [[(big, 17, CYAN, True)], [(small, 10.5, SOFT, False)]])
        if i:
            s.line(sx, 6.67, sx, 7.17, EDGE, width=1, head=False)

    s.notes(
        "This is the same picture aboard ship. It is the design, not something we have deployed on a hull. "
        "Everything in amber is what changes from the lab cluster on the previous slide; everything else is the "
        "same software we ran this week.\n\n"
        "Watchstanders reach NAVIFI over the ship's LAN with a CAC, through Keycloak. There is no route to the "
        "internet and no load balancer: TLS ends at the Istio gateway. The only traffic that leaves the ship is "
        "the decision log going ashore, and in EMCON nothing leaves at all.\n\n"
        "The rack runs RHEL 9 with the DISA STIG and FIPS mode, and RKE2 with the CIS profile across three edge "
        "nodes. UDS Core uses Iron Bank images. The optional AI narrator runs in the cluster, so it works with the "
        "link down too.\n\n"
        "Delivery: pier side, connected, we build one UDS bundle carrying Zarf init, UDS Core and NAVIFI, with the "
        "model weights inside. It goes aboard by sneakernet or over a degraded link, and nothing is downloaded at sea.\n\n"
        "With the link up, the audit log forwards ashore in batches over SATCOM. In DDIL it trickles one entry at a "
        "time and uses a local model or template text. In EMCON nothing leaves the ship, and the engine, map, "
        "simulation and audit all keep working.")


# ================================================================ 10. where we are
def slide_where():
    s = Slide()
    s.header('WHERE WE ARE', "What's real, what isn't yet, and what's next", [
        ('Three days in. Here is the straight version.', 14, SOFT, False)])
    cols = [
        ('Real today', GREEN, [
            "Runs on the ship's stack, live on AWS",
            'Four mission threads on one engine',
            'Twelve failure cases and a hash-chained decision log',
            'Any git commit to live in one command',
        ]),
        ("Not real yet", AMBER, [
            'All data is synthetic',
            'Durations are planner estimates, not fleet history',
            "Correlated delays (one cause, many slips) aren't modeled",
            'One ship at a time; squadron roll-up is a prototype',
        ]),
        ('Next', CYAN, [
            "Wire Connor's new mission engine into the app",
            '30 days: read-only exports from one DDG; three watch teams try it against today\'s process',
            '60 days: workflow authoring, and UDS on an RKE2 edge node (we did a version of this one this week)',
            '90 days: three hulls plus a squadron roll-up',
        ]),
    ]
    CW, CG = (12.15 - 2 * 0.25) / 3, 0.25
    for i, (title, color, items) in enumerate(cols):
        x = 0.6 + i * (CW + CG)
        s.card(x, 1.85, CW, 4.3, color)
        s.label(x + 0.25, 2.07, CW - 0.5, 0.32, [[(title, 17, color, True)]])
        s.label(x + 0.25, 2.6, CW - 0.5, 3.4,
                [[('›  ', 13.5, color, True), (item, 13.5, INK, False)] for item in items],
                anchor=MSO_ANCHOR.TOP, spacing=14)
    s.label(0.6, 6.5, 12.15, 0.4, [[('Synthetic data only.  A human decides.', 16, SOFT, True)]], align=PP_ALIGN.CENTER)
    s.notes(
        "Straight version, three days in.\n\n"
        "Real today: it runs on the ship's stack and is live on AWS; four mission threads run on one engine; twelve "
        "failure cases run live; every decision goes on a hash-chained log; and any commit goes live in one command.\n\n"
        "Not real yet: all data is synthetic, durations are planner estimates, correlated delays are not modeled, "
        "and it is one ship at a time; the squadron roll-up is a prototype.\n\n"
        "Next: wire Connor's new mission engine into the app. Then the plan in the app: in 30 days, read-only "
        "exports from one DDG and three watch teams trying it against today's process; in 60, workflow authoring "
        "and UDS on an RKE2 edge node, which we did a version of this week; in 90, three hulls and a squadron "
        "roll-up.")


# ================================================================ appendix
APPENDIX = [
    ('A1', 'Nothing typed twice', 'Where the data comes from, and what happens when it is bad', CYAN),
    ('A2', 'What it gives back to the watch', 'Our before and after for one change landing mid-watch', GREEN),
    ('A3', 'Built for the person on watch', 'The screen, the words, the STOP button, and EMCON', VIOLET),
    ('A4', 'Slack is not margin', 'The one idea under the engine', AMBER),
    ('A5', 'Four things broke on the way to AWS', 'What we hit standing up the cluster, and the fixes', RED),
    ('A6', 'Beyond the surface fleet', "Connor's engine: other ships, other domains", BLUE),
]


def appendix_header(s, code, kicker, subtitle):
    title = next(t for c, t, _, _ in APPENDIX if c == code)
    s.header(f'APPENDIX {code}  ·  {kicker}', title, [(subtitle, 14, SOFT, False)])


def slide_appendix():
    s = Slide()
    s.header('APPENDIX', 'More detail, if you want it', [
        ('Each one goes a level deeper on something from the main deck.', 14, SOFT, False)])
    CW, CG, CH = (12.15 - 2 * 0.25) / 3, 0.25, 2.05
    for i, (code, title, desc, color) in enumerate(APPENDIX):
        x, y = 0.6 + (i % 3) * (CW + CG), 1.95 + (i // 3) * (CH + 0.3)
        s.card(x, y, CW, CH, color)
        s.label(x + 0.3, y + 0.3, CW - 0.6, 0.3, [[(code, 13, color, True)]])
        s.label(x + 0.3, y + 0.62, CW - 0.6, 0.7, [[(title, 17, INK, True)]], anchor=MSO_ANCHOR.TOP)
        s.label(x + 0.3, y + 1.38, CW - 0.6, 0.6, [[(desc, 12, SOFT, False)]], anchor=MSO_ANCHOR.TOP)
    s.notes("The appendix goes one level deeper on six things from the main deck. Jump to whichever one comes up.")


def slide_a_data():
    s = Slide()
    appendix_header(s, 'A1', 'WHERE THE DATA COMES FROM',
                    'NAVIFI reads the records the ship already keeps. Nobody re-enters a status to make the picture move.')
    s.label(0.6, 1.85, 2.3, 0.28, [[('Read-only connectors', 11, MUTE, True)]])
    systems = [('OMMS-NG', 'maintenance'), ('R-SUPPLY', 'parts and ETAs'), ('NSIPS', 'personnel'),
               ('WATCHBILL', 'watches and quals'), ('SKED', 'PMS schedule'), ('DRRS-N', 'readiness'),
               ('MVCS', 'unmanned vehicles'), ('AMHS', 'message traffic')]
    for i, (sys, role) in enumerate(systems):
        chip = s.box(0.6, 2.18 + i * 0.4, 2.3, 0.33, fill=CHIP, line=EDGE, radius=0.25)
        s.text(chip, [[(sys, 10, CYAN, True), (f'  {role}', 10, SOFT, False)]], align=PP_ALIGN.LEFT)
    patch = s.box(3.3, 2.95, 1.9, 1.55, fill=HULL, line=CYAN_DIM, line_w=1.25)
    s.text(patch, [[('Change event', 13, INK, True)], [('Time-stamped, with its source record attached', 10.5, SOFT, False)]], spacing=4)
    eng = s.box(5.6, 2.95, 2.0, 1.55, fill=CYAN, radius=0.08)
    s.text(eng, [[('Mission recomputed', 13, ABYSS, True)], [('in milliseconds, every number linked to its record', 10.5, ABYSS, False)]], spacing=4)
    s.line(2.95, 3.72, 3.3, 3.72, CYAN)
    s.line(5.2, 3.72, 5.6, 3.72, CYAN)
    s.label(3.3, 4.65, 4.3, 0.55, [[('Connectors only read. NAVIFI never writes back to a system of record.', 11, AMBER, True)]],
            align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.TOP)
    h = s.shot('evidence', 0.6, 5.6, 3.1, color=CYAN_DIM, crop=(1571, 1605, 2681, 2105))
    s.label(3.9, 5.6, 3.7, h, [[('The provenance panel: how many records each system supplied, all read-only.', 11, SOFT, False)]],
            anchor=MSO_ANCHOR.MIDDLE)

    RX, RW = 8.0, 4.75
    s.card(RX, 1.85, RW, 2.95, AMBER)
    s.label(RX + 0.25, 2.05, RW - 0.5, 0.32, [[('Bad data gets flagged, not retyped', 14, AMBER, True)]])
    flags = [('Missing', 'plans on a conservative value and says so'),
             ('Stale', 'flagged on the input that controls'),
             ('Contradictory', 'plans on the worse value, shows both'),
             ('Malformed', 'rejected; the last good value is kept')]
    for i, (k, v) in enumerate(flags):
        y = 2.5 + i * 0.55
        s.label(RX + 0.25, y, 1.45, 0.45, [[(k, 12, INK, True)]], anchor=MSO_ANCHOR.MIDDLE)
        s.label(RX + 1.7, y, RW - 1.95, 0.45, [[(v, 11.5, SOFT, False)]], anchor=MSO_ANCHOR.MIDDLE)
    s.card(RX, 5.05, RW, 1.95, CYAN)
    s.label(RX + 0.25, 5.25, RW - 0.5, 0.32, [[('The paperwork comes from the code', 14, CYAN, True)]])
    s.label(RX + 0.25, 5.65, RW - 0.5, 1.3, [[('›  ', 11.5, CYAN, True), (b, 11.5, INK, False)] for b in [
        'SBOM and signature on every image build',
        '48 NIST 800-53 controls in an OSCAL file generated from the code',
        'CI fails if that file drifts from the code',
    ]], anchor=MSO_ANCHOR.TOP, spacing=4)
    s.notes(
        "Where the data comes from. NAVIFI reads the records the ship already keeps, through read-only connectors "
        "shaped like OMMS-NG, R-Supply, NSIPS, the watchbill and the rest. Each change arrives as a time-stamped "
        "event with its source record attached, and the mission is recomputed in milliseconds. Nobody types a "
        "status twice, and NAVIFI never writes back.\n\n"
        "Bad data is the normal case, so the engine flags it instead of asking a Sailor to reconcile it: missing "
        "values get a conservative assumption, stale ones are flagged on the input that controls, contradictions "
        "plan on the worse value, and malformed records are rejected.\n\n"
        "The accreditation paperwork comes from the code too: an SBOM and signature on every build, and an OSCAL "
        "file mapping 48 NIST 800-53 controls that CI regenerates and checks. All records here are synthetic.")


def slide_a_impact():
    s = Slide()
    appendix_header(s, 'A2', 'BEFORE AND AFTER',
                    'Our tabletop comparison for one change landing mid-watch. Not measured fleet data yet.')
    cols = [('AFTER A CHANGE LANDS', 0.6, 3.9), ('TODAY', 4.6, 2.1), ('WITH NAVIFI', 6.8, 2.2), ('HOW', 9.1, 3.65)]
    for name, x, w in cols:
        s.label(x + 0.2, 1.95, w - 0.2, 0.3, [[(name, 11, MUTE, True)]])
    rows = [
        ('Time to a defensible answer', '30–60 min', 'Milliseconds', 'Recomputed the moment the report lands'),
        ('Systems consulted', '5–7, plus calls', 'One screen', 'Every number links to its source record'),
        ('Nonlinear effects caught', 'Often missed', '2 of 2', 'A missed sail window and a helo fly-on cliff'),
        ('Data problems surfaced', 'When they bite', '4 of 4', 'Missing, stale, contradictory, malformed'),
        ('Decision record', 'Notebook or email', 'Hash-chained log', 'Who decided what, on which facts, and when'),
    ]
    RH = 0.68
    for i, (metric, today, after, how) in enumerate(rows):
        y = 2.35 + i * RH
        s.box(0.6, y + 0.04, 12.15, RH - 0.08, fill=HULL if i % 2 == 0 else None, line=None, radius=0.1)
        s.label(0.8, y, 3.7, RH, [[(metric, 14, INK, True)]], anchor=MSO_ANCHOR.MIDDLE)
        s.label(4.8, y, 1.9, RH, [[(today, 14, AMBER, False)]], anchor=MSO_ANCHOR.MIDDLE)
        s.label(7.0, y, 2.0, RH, [[(after, 15, GREEN, True)]], anchor=MSO_ANCHOR.MIDDLE)
        s.label(9.3, y, 3.4, RH, [[(how, 11.5, SOFT, False)]], anchor=MSO_ANCHOR.MIDDLE)
    s.line(6.55, 2.4, 6.55, 2.35 + 5 * RH - 0.05, EDGE, width=1, head=False)
    s.card(0.6, 6.0, 12.15, 0.9, CYAN)
    s.label(0.85, 6.18, 11.65, 0.8, [
        [('How we would make it real  ', 13, CYAN, True),
         ('In the first 30 days: sanitized, read-only exports from one DDG, and three watch teams run this same '
          "comparison against today's process.", 12.5, INK, False)],
    ], anchor=MSO_ANCHOR.TOP)
    s.notes(
        "This is what we think it gives back to the watch, for one change landing mid-watch. The 'today' column is "
        "our own tabletop estimate, not measured fleet data, and we say so in the app too.\n\n"
        "Today a defensible answer takes 30 to 60 minutes of pulling the CASREP, calling supply, checking the "
        "watchbill and redoing the whiteboard. With NAVIFI it is recomputed in milliseconds when the report lands, "
        "on one screen, and every number links back to its record. The nonlinear effects and the bad data in our "
        "test cases are all caught, and every decision lands on a hash-chained log instead of a notebook.\n\n"
        "To make it real, the first 30 days are read-only exports from one DDG and three watch teams running this "
        "same comparison against today's process.")


def slide_a_watch():
    s = Slide()
    appendix_header(s, 'A3', 'THE SAILOR AT THE CONSOLE',
                    'One screen, plain words, and it keeps working when the ship goes quiet.')
    h = s.shot('watch_mcm', 0.6, 1.85, 2.75, color=CYAN_DIM, crop=(2936, 356, 3829, 1890))
    s.label(0.6, 1.85 + h + 0.08, 2.75, 0.3, [[('The written brief on the watch floor', 10.5, MUTE, False)]])
    beats(s, 3.75, 1.9, 4.7, [
        ('Five answers, always in this order',
         'Is it up now? Will it be up when needed? What controls it? How much margin? What are the options?', CYAN),
        ('Plain words first',
         'A written brief on top, numbers underneath. AI text is violet and labelled; with no model it falls back to a template.', VIOLET),
        ('One button to stop it',
         'STOP halts every recommendation at once, and the stop itself is logged.', RED),
        ('Hands stay on the keyboard',
         '1–9 jump between screens, Space plays the change stream, Shift+R resets the session.', GREEN),
    ], step=1.27)
    h2 = s.shot('edge_emcon', 8.75, 1.85, 4.0, color=CYAN_DIM, crop=(157, 1545, 1358, 2105))
    s.label(8.75, 1.85 + h2 + 0.08, 4.0, 0.5, [[('Flip to EMCON: nothing leaves the ship, and everything still works.', 11, SOFT, False)]],
            anchor=MSO_ANCHOR.TOP)
    cy = 1.85 + h2 + 0.75
    s.card(8.75, cy, 4.0, 1.4, AMBER)
    s.label(9.0, cy + 0.22, 3.5, 1.1, [
        [("What we haven't done yet", 13, AMBER, True)],
        [('Put it in front of a real watch team. That is the first thing in the 30-day plan.', 11.5, INK, False)],
    ], anchor=MSO_ANCHOR.TOP, spacing=5)
    s.notes(
        "Built for the person on watch. The watch floor gives five answers, always in the same order: is it up "
        "now, will it be up when needed, what controls it, how much margin is left, and what the options are.\n\n"
        "Plain words come first: a written brief on top and the numbers underneath. Anything the AI wrote is "
        "violet and labelled, and with no model available it falls back to a template, so the answer never "
        "changes. One STOP button halts every recommendation, and the stop is logged. Everything is reachable "
        "from the keyboard.\n\n"
        "Flip the ship to EMCON and nothing leaves, but the engine, map, simulation and audit all keep working.\n\n"
        "What we have not done is put it in front of a real watch team. That is the first thing in the 30-day plan.")


def slide_a_slack():
    s = Slide()
    appendix_header(s, 'A4', 'THE IDEA UNDER THE ENGINE',
                    "The late part gets the attention. The input that controls the mission often isn't the late one.")
    s.label(0.6, 1.9, 8.8, 0.75, [
        [('A radar repair: ', 14, INK, True),
         ('part due 1200, qualified team free at 1400, a 3-hour job, needed by 1800.', 14, SOFT, False)],
        [('Ready at 1700 with 1 hour of margin. ', 14, INK, True), ('The team controls, not the part.', 14, CYAN, True)],
    ], anchor=MSO_ANCHOR.TOP, spacing=4)

    BX, PER = 2.0, 1.65
    s.label(BX, 2.85, 6.6, 0.3, [[('HOW FAR EACH ONE CAN SLIP', 10.5, MUTE, True)]])
    bars = [
        ('The part', [(0, 2, GREEN, 'no effect'), (2, 3, AMBER, 'eats margin'), (3, 4, RED, 'fails')]),
        ('The team', [(0, 1, AMBER, 'eats margin'), (1, 4, RED, 'mission fails')]),
    ]
    for i, (who, segs) in enumerate(bars):
        y = 3.2 + i * 0.75
        s.label(0.6, y, 1.3, 0.55, [[(who, 13, INK, True)]], anchor=MSO_ANCHOR.MIDDLE)
        for a, b, color, text in segs:
            seg = s.box(BX + a * PER + 0.02, y, (b - a) * PER - 0.04, 0.55, fill=color, radius=0.12)
            s.text(seg, [[(text, 11, ABYSS, True)]])
    for hr in range(5):
        x = BX + hr * PER
        s.line(x, 4.75, x, 4.85, MUTE, width=1, head=False)
        s.label(x - 0.3, 4.88, 0.6, 0.25, [[(f'+{hr} h', 10, MUTE, False)]], align=PP_ALIGN.CENTER)

    cards = [
        ('Slack', GREEN, 'How far an input slips before anything changes. The part: 2 hours. The team: none.'),
        ('Margin', AMBER, 'How far the mission can slip before it fails. Here 1 hour, and the team sets it.'),
        ('Exact, not estimated', CYAN, 'Readiness rules only move one way, so bisection finds both numbers exactly for every input.'),
    ]
    CW = (8.8 - 2 * 0.2) / 3
    for i, (title, color, body) in enumerate(cards):
        x = 0.6 + i * (CW + 0.2)
        s.card(x, 5.35, CW, 1.65, color)
        s.label(x + 0.2, 5.55, CW - 0.4, 0.3, [[(title, 13, color, True)]])
        s.label(x + 0.2, 5.92, CW - 0.4, 1.0, [[(body, 11, SOFT, False)]], anchor=MSO_ANCHOR.TOP)

    h = s.shot('graph_mcm', 9.85, 1.9, 2.9, color=CYAN_DIM, crop=(2959, 307, 3829, 1725))
    s.label(9.85, 1.9 + h + 0.08, 2.9, 0.5, [[('The same check in the app: OS1 Vega on the mine countermeasures thread', 10, MUTE, False)]],
            anchor=MSO_ANCHOR.TOP)
    s.notes(
        "This is the one idea under the engine: slack is not margin.\n\n"
        "A radar repair. The part is due at 1200, the qualified team is free at 1400, the job takes three hours, "
        "and it is needed by 1800. It is ready at 1700, an hour of margin, and the team controls, not the part.\n\n"
        "So the part can slip two hours and nothing changes; after that it eats the hour of margin; past three "
        "hours the mission fails. The team has no slack at all: one hour late and the mission fails. Everyone "
        "chases the late part, and the thing that actually controls is somewhere else.\n\n"
        "Every readiness rule only moves one way, so a later input never makes the mission earlier, and bisection "
        "finds both numbers exactly for every input. On the right is the same check in the app, on the mine "
        "countermeasures thread.")


def slide_a_broke():
    s = Slide()
    appendix_header(s, 'A5', 'WHAT WE HIT', 'Each fix is in the scripts now, so the next node will not hit them.')
    items = [
        ('WED 21:58', "MinIO's public images were gone",
         'MinIO stopped publishing the images the storage chart pulled.',
         'Pull the Chainguard build that uds-k3d uses.'),
        ('WED 22:07', 'The registry kept failing',
         'A second registry pod shared the volume, and SELinux relabels it for the newest pod, locking the older one out.',
         'Pin the Zarf registry to one replica.'),
        ('WED 23:03', "UDS Core wouldn't install",
         "RKE2 1.36 ships Gateway API CRDs in its Traefik chart, and they blocked UDS Core's own.",
         'Set ingress-controller to none, which skips both charts.'),
        ('THU 01:11', 'Logs and backups lost the API',
         "Narrowing Loki and Velero to MinIO also removed the rule that let them reach the Kubernetes API.",
         'Add an explicit Kubernetes API rule for the pods that need it.'),
    ]
    CW, CG, CY, CH = (12.15 - 3 * 0.25) / 4, 0.25, 1.9, 4.0
    for i, (when, title, why, fix) in enumerate(items):
        x = 0.6 + i * (CW + CG)
        s.card(x, CY, CW, CH, RED)
        s.label(x + 0.25, CY + 0.25, CW - 0.5, 0.25, [[(when, 11, MUTE, True)]])
        s.label(x + 0.25, CY + 0.55, CW - 0.5, 0.65, [[(title, 15, INK, True)]], anchor=MSO_ANCHOR.TOP)
        s.label(x + 0.25, CY + 1.3, CW - 0.5, 1.6, [[('WHY', 10, AMBER, True)], [(why, 11.5, SOFT, False)]],
                anchor=MSO_ANCHOR.TOP, spacing=3)
        s.label(x + 0.25, CY + 2.75, CW - 0.5, 1.1, [[('FIX', 10, GREEN, True)], [(fix, 11.5, INK, False)]],
                anchor=MSO_ANCHOR.TOP, spacing=3)
        if i < 3:
            s.line(x + CW + 0.03, CY + 0.37, x + CW + CG - 0.03, CY + 0.37, MUTE, width=1.25)

    s.box(0.6, 6.45, 12.15, 0.74, fill=HULL, line=EDGE, radius=0.12)
    stats = [('4 fixes', 'each one now in the scripts'), ('10 of 10', 'UDS packages ready'),
             ('45 pods', 'running and ready, none unhealthy'), ('27', 'AWS resources from Terraform')]
    SWS = 12.15 / len(stats)
    for i, (big, small) in enumerate(stats):
        sx = 0.6 + i * SWS
        s.label(sx + 0.25, 6.5, SWS - 0.35, 0.64, [[(big, 17, CYAN, True)], [(small, 10.5, SOFT, False)]])
        if i:
            s.line(sx, 6.57, sx, 7.07, EDGE, width=1, head=False)
    s.notes(
        "Four things broke while we stood up the cluster, in the order we hit them on Wednesday night.\n\n"
        "MinIO's public images were gone, so we pull the Chainguard build that uds-k3d uses. The registry kept "
        "failing because a second pod shared its volume and SELinux relabels the volume for the newest pod, so we "
        "pinned it to one replica. UDS Core would not install because RKE2 1.36 ships its own Gateway API CRDs, so "
        "we turned RKE2's ingress off entirely. And when we narrowed Loki and Velero's network access down to "
        "MinIO, they lost the Kubernetes API, so they now get an explicit rule for it.\n\n"
        "Each fix is committed in the install scripts. As of Thursday morning, all ten UDS packages are ready and "
        "45 pods are running with none unhealthy.")


def slide_a_domains():
    s = Slide()
    appendix_header(s, 'A6', 'OTHER SHIPS, OTHER DOMAINS',
                    "Connor's engine keeps the core general and puts the domain knowledge in packs.")
    core = s.box(0.6, 1.9, 8.0, 1.0, fill=HULL, line=CYAN, line_w=1.25)
    s.text(core, [[('Mission engine core', 15, INK, True)],
                  [('Timelines, stock levels, the controlling chain, slack vs margin, options, Monte Carlo, hash-chained decisions',
                    10.5, SOFT, False)]], spacing=3)
    PW = (8.0 - 2 * 0.25) / 3
    packs = [
        ('Naval pack', BLUE, 'Strike group, logistics force, maintenance, C2',
         'Operation STEEL TIDE', '7 hulls: a carrier, a cruiser, three DDGs, an oiler and a T-AKE', False),
        ('Airlift pack', VIOLET, 'Flight legs, ground time, checklist items',
         'REACH 417', 'A C-17A on three legs, Dover to Diego Garcia', False),
        ('The next domain', MUTE, 'A new pack of factor tables and routines, not an engine rewrite',
         'NAVIFI classic', "The app's radar repair case passes unchanged on this engine", True),
    ]
    for i, (name, color, what, scen, scen_body, dashed) in enumerate(packs):
        x = 0.6 + i * (PW + 0.25)
        pack = s.box(x, 3.3, PW, 1.3, fill=NODE, line=color, line_w=1.5)
        if dashed:
            pack.line.dash_style = MSO_LINE.DASH
        s.text(pack, [[(name, 13.5, color if not dashed else INK, True)], [(what, 10.5, SOFT, False)]], spacing=3)
        s.line(x + PW / 2, 2.9, x + PW / 2, 3.3, color if not dashed else MUTE)
        sc = s.box(x, 4.85, PW, 1.25, fill=HULL, line=EDGE)
        s.text(sc, [[(scen, 12, INK, True)], [(scen_body, 10.5, SOFT, False)]], spacing=3)
    s.label(0.6, 6.3, 8.0, 0.8, [
        [('›  ', 11.5, CYAN, True), ('Packs work together: the naval pack calls the airlift pack to check the carrier onboard delivery flight.', 11.5, INK, False)],
        [('›  ', 11.5, CYAN, True), ('Crews are tracked by qualification (AMD, strike, FC, ET), so who can cover a task is part of the math.', 11.5, INK, False)],
    ], anchor=MSO_ANCHOR.TOP, spacing=4)

    RX, RW = 8.95, 3.8
    s.card(RX, 1.9, RW, 3.0, CYAN)
    s.label(RX + 0.25, 2.1, RW - 0.5, 0.32, [[('In the NAVIFI app today', 14, CYAN, True)]])
    s.label(RX + 0.25, 2.6, RW - 0.5, 2.2, [[('›  ', 12.5, CYAN, True), (b, 12.5, INK, False)] for b in [
        'Four mission threads on one engine',
        'Two ship classes, three hulls',
        'A fleet picture prototype: 38 hulls, 12 missions, 140+ packages timed by the engine',
    ]], anchor=MSO_ANCHOR.TOP, spacing=9)
    s.card(RX, 5.15, RW, 1.95, AMBER)
    s.label(RX + 0.25, 5.35, RW - 0.5, 1.65, [
        [('Not yet', 13, AMBER, True)],
        [("The app still runs its own engine. Wiring Connor's in is the next job; his engine's 48 tests "
          'run on their own today.', 12.5, INK, False)],
    ], anchor=MSO_ANCHOR.TOP, spacing=5)
    s.notes(
        "Beyond the surface fleet. Connor's new engine keeps the core general, with timelines, stock levels, the "
        "controlling chain, slack versus margin, options, Monte Carlo and the decision log, and puts domain "
        "knowledge in packs.\n\n"
        "There are two packs today. The naval pack runs Operation STEEL TIDE, seven hulls across a strike group "
        "and its logistics force. The airlift pack runs REACH 417, a C-17 on three legs from Dover to Diego "
        "Garcia. They work together: the naval pack calls the airlift pack to check the carrier onboard delivery "
        "flight. Crews are tracked by qualification, so who can cover a task is part of the math. A new domain is "
        "a new pack, not an engine rewrite, and the app's original radar repair case passes unchanged on it.\n\n"
        "In the app today there are four mission threads on one engine and a 38-hull fleet picture prototype. "
        "The app still runs its own engine; wiring Connor's in is the next job. All scenario data is synthetic.")


def export_previews(pptx):
    soffice = shutil.which('soffice')
    if not soffice or not shutil.which('pdftoppm'):
        print('LibreOffice/pdftoppm not found; skipping PDF and previews')
        return
    subprocess.run([soffice, f'-env:UserInstallation=file://{BUILD / "lo-profile"}', '--headless',
                    '--convert-to', 'pdf', '--outdir', str(OUT), str(pptx)], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    pdf = OUT / f'{NAME}.pdf'
    prev = OUT / 'week_preview'
    shutil.rmtree(prev, ignore_errors=True)
    prev.mkdir()
    subprocess.run(['pdftoppm', '-png', '-r', '120', str(pdf), str(prev / 'slide')], check=True)
    print(pdf)
    print(prev)


def main():
    BUILD.mkdir(exist_ok=True)
    OUT.mkdir(exist_ok=True)
    for build in (slide_title, slide_team, slide_question, slide_thread, slide_decides, slide_break, slide_missions,
                  slide_platform_built, slide_platform_arch, slide_ship_arch, slide_where,
                  slide_appendix, slide_a_data, slide_a_impact, slide_a_watch, slide_a_slack, slide_a_broke,
                  slide_a_domains):
        build()
    pptx = OUT / f'{NAME}.pptx'
    prs.save(pptx)
    print(pptx)
    export_previews(pptx)


if __name__ == '__main__':
    main()
