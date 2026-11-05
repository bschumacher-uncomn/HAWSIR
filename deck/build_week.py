#!/usr/bin/env python3
"""HAWSIR deck, told as what the team built this week.

Plain Arial and native shapes, so it opens and edits the same on any machine; only the
app screenshots are images. The rubric-ordered pitch deck is deck/build.py.

usage: python3 deck/build_week.py
  -> deck/out/HAWSIR_this_week.pptx, plus a PDF and PNG previews when LibreOffice
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
NAME = 'HAWSIR_this_week'
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


# ================================================================ title
def slide_title():
    s = Slide()
    s.label(0.6, 0.55, 6, 0.3, [[('FLEETHACKER NORFOLK 2026', 12, CYAN, True)]])
    s.label(0.6, 0.9, 6, 1.0, [[('HAWSIR', 66, INK, True)]])
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
         'RHEL 9, RKE2 and UDS Core stood up on AWS; HAWSIR deployed from a git commit'),
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
        "HAWSIR is a mission consequence engine for the watch floor: when status reports land, it shows which one "
        "actually controls the mission, what it costs, and which bounded options recover it.\n\n"
        "We built it this week. Tuesday was the engine and the watch floor. Wednesday was the executable mission "
        "thread; Connor also wrote a standalone mission engine, and we built the video. Wednesday night into "
        "Thursday we stood up a real cluster on AWS, on the same stack a ship would run, and deployed HAWSIR to it.\n\n"
        "Everything you will see uses synthetic data, and a human makes every decision.")


# ================================================================ who we are
def slide_team():
    s = Slide()
    s.header('WHO WE ARE', 'A two-day sprint', [
        ('Questions, or a mission you want to see run through it? Email either of us.', 14, SOFT, False)])
    people = [
        ('bryce-schumacher', (70, 30, 520), CYAN, 'Bryce Schumacher', 'bschumacher@uncomn.com',
         'Built the HAWSIR app: the watch floor, the mission thread, the decision log and the evidence screens. '
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
    s.label(0.6, 6.85, 12.15, 0.3, [[('HAWSIR  ·  FleetHacker Norfolk 2026', 11, MUTE, False)]], align=PP_ALIGN.CENTER)
    s.notes(
        "We're Bryce and Connor, and the two of us built this in a two-day sprint.\n\n"
        "Bryce built the HAWSIR app, the watch floor, mission thread, decision log and evidence screens, and stood "
        "up the lab cluster it runs on. Connor built the standalone mission engine: the dependency graph, Monte "
        "Carlo, the decision ledger and the naval and airlift mission packs.\n\n"
        "If you have questions, or a mission you want to see run through it, our emails are on the slide.")


# ================================================================ three terms
def slide_terms():
    s = Slide()
    s.header('FIRST, THREE TERMS', 'MBSE, mission engineering and mission readiness', [
        ('Engineers model systems and missions. Ships report readiness. Today a Sailor joins the two by hand.', 14, SOFT, False)])
    terms = [
        ('MBSE', 'Model-based systems engineering', BLUE,
         'Design a system as one connected model instead of a stack of documents. Requirements, parts, interfaces '
         'and behavior link to each other, so a change shows where it lands.',
         'How is this system built, and what does it need to work?',
         'Design and acquisition, usually in SysML',
         'What USV-1, the MH-60S and the analyst each need: parts, maintenance, a qualified person'),
        ('Mission engineering', 'Start from the mission, not the platform', VIOLET,
         'Break a mission into a thread of tasks, systems, people and timing, and engineer across all of them so '
         'the mission works, not just each system.',
         'What has to happen, in what order, for this mission to succeed?',
         'Planning and analysis; the DoD Mission Engineering Guide',
         'Operation Open Passage: USV sonar and a helo survey in parallel, an analyst reviews both, report by 1800'),
        ('Mission readiness', 'Can we do it, and when?', GREEN,
         'Whether a unit can do its assigned missions, now and when they are needed. The Navy reports it in DRRS-N '
         'against mission essential tasks, rated Y, Q or N.',
         'Will this mission happen on time, and if not, why?',
         'DRRS-N, CASREPs, supply status, the watchbill',
         "MCM rated N: 1 h 15 m short, held up by the analyst's watch"),
    ]
    CW, CG, CY, CH = (12.15 - 2 * 0.35) / 3, 0.35, 1.9, 5.15
    for i, (term, sub, color, definition, answers, lives, demo) in enumerate(terms):
        x = 0.6 + i * (CW + CG)
        s.card(x, CY, CW, CH, color)
        s.label(x + 0.3, CY + 0.25, CW - 0.6, 0.5, [[(term, 21, color, True)]])
        s.label(x + 0.3, CY + 0.78, CW - 0.6, 0.3, [[(sub, 12, MUTE, True)]])
        s.label(x + 0.3, CY + 1.2, CW - 0.6, 1.4, [[(definition, 12.5, INK, False)]], anchor=MSO_ANCHOR.TOP)
        rows = [('ANSWERS', answers), ('WHERE IT LIVES', lives), ('IN OUR DEMO', demo)]
        for j, (k, v) in enumerate(rows):
            ry = CY + 2.65 + j * 0.8
            s.label(x + 0.3, ry, CW - 0.6, 0.22, [[(k, 9.5, color, True)]])
            s.label(x + 0.3, ry + 0.22, CW - 0.6, 0.6, [[(v, 11.5, SOFT, False)]], anchor=MSO_ANCHOR.TOP)
        if i < 2:
            s.line(x + CW + 0.06, CY + CH / 2, x + CW + CG - 0.06, CY + CH / 2, CYAN, width=2)
    s.notes(
        "Three terms before the demo, because HAWSIR sits where they meet.\n\n"
        "MBSE, model-based systems engineering, designs a system as one connected model instead of a stack of "
        "documents, so you can see what each system needs to work: parts, maintenance, a qualified person.\n\n"
        "Mission engineering starts from the mission instead of the platform. It breaks a mission into a thread of "
        "tasks, systems, people and timing, and engineers across all of them. In our demo that is Operation Open "
        "Passage: a USV and a helo survey the channel in parallel, an analyst reviews both, and the report is due "
        "at 1800.\n\n"
        "Mission readiness is whether a unit can do its missions, now and when they are needed. The Navy reports "
        "it in DRRS-N against mission essential tasks as Y, Q or N. Today a Sailor joins these by hand: the "
        "mission thread lives in a plan, readiness is reported system by system, and the whiteboard connects them.")


# ================================================================ the digital thread
def slide_digital_thread():
    s = Slide()
    s.header('THE DIGITAL THREAD', 'How mission engineering threads into readiness', [
        ('Each link points to the next, so a status change finds the mission it hits, and the answer traces back.', 14, SOFT, False)])
    links = [
        ('1  ·  MISSION', CYAN, 'Mine assessment', 'Thimble Shoal approach, due to the commander by 1800', 'From the tasking'),
        ('2  ·  MISSION THREAD', VIOLET, 'Six lanes of tasks', 'Survey, review and report, with every handoff and its timing',
         'From mission engineering'),
        ('3  ·  SYSTEMS AND PEOPLE', BLUE, 'Its dependencies',
         'USV-1, the MH-60S and the analyst, and the parts, upkeep or quals each needs', 'From the system models'),
        ('4  ·  LIVE RECORDS', AMBER, "Today's status",
         'CASREP, supply ETA and watchbill, read-only, as they change', 'From the ship'),
        ('5  ·  READINESS', GREEN, 'MCM: N, −1 h 15 m', 'Controlled by OS1 Vega, with bounded options to recover',
         'Y, Q or N, as DRRS-N rates it'),
    ]
    NW, NG, NY, NH = (12.15 - 4 * 0.3) / 5, 0.3, 2.2, 2.0
    s.label(0.6, 1.85, 12.15, 0.28, [[('BUILT DOWN THE THREAD', 10.5, MUTE, True)]])
    for i, (step, color, title, body, src) in enumerate(links):
        x = 0.6 + i * (NW + NG)
        s.box(x, NY, NW, NH, fill=HULL, line=color, line_w=1.5)
        s.label(x + 0.18, NY + 0.15, NW - 0.36, 0.25, [[(step, 9.5, color, True)]])
        s.label(x + 0.18, NY + 0.42, NW - 0.36, 0.35, [[(title, 13, INK, True)]])
        s.label(x + 0.18, NY + 0.8, NW - 0.36, 0.8, [[(body, 10.5, SOFT, False)]], anchor=MSO_ANCHOR.TOP)
        s.label(x + 0.18, NY + NH - 0.38, NW - 0.36, 0.25, [[(src, 9.5, MUTE, True)]])
        if i < 4:
            s.line(x + NW + 0.03, NY + NH / 2, x + NW + NG - 0.03, NY + NH / 2, CYAN, width=2)
    s.line(12.7, NY + NH + 0.3, 0.65, NY + NH + 0.3, GREEN, width=1.5)
    s.label(0.6, NY + NH + 0.38, 12.15, 0.3, [[(
        'Traced back: every answer points to the task, the system and the record behind it', 11, GREEN, True)]],
        align=PP_ALIGN.CENTER)

    HW = (12.15 - 0.3) / 2
    rows = [
        ('TODAY', AMBER, 'The thread is a plan or a slide. Readiness is reported system by system. The watch joins '
                         'them on a whiteboard, by hand, every time a report lands.'),
        ('WITH HAWSIR', CYAN, 'The thread runs. Records attach to its nodes as they change, and readiness is computed '
                              'per mission: Y, Q or N, the margin, and what controls it.'),
    ]
    for i, (k, color, text) in enumerate(rows):
        x = 0.6 + i * (HW + 0.3)
        s.card(x, 5.15, HW, 1.35, color)
        s.label(x + 0.25, 5.35, HW - 0.5, 0.25, [[(k, 10.5, color, True)]])
        s.label(x + 0.25, 5.65, HW - 0.5, 0.8, [[(text, 12.5, INK, False)]], anchor=MSO_ANCHOR.TOP)
    s.label(0.6, 6.7, 12.15, 0.4, [[
        ('Not yet:  ', 11, AMBER, True),
        ('we write the thread and the system dependencies by hand. Reading them from the engineering model is the '
         'next link.', 11, SOFT, False)]], align=PP_ALIGN.CENTER)
    s.notes(
        "This is how mission engineering threads into readiness, and it is the idea the rest of the demo runs on.\n\n"
        "Start with the mission: a mine assessment of the Thimble Shoal approach, due by 1800. Mission engineering "
        "turns it into a thread: six lanes of tasks and handoffs with their timing. The system models say what each "
        "piece needs: USV-1, the MH-60S and the analyst each need parts, maintenance or a qualified person. The "
        "ship's own records say where those stand right now. Put together, readiness comes out per mission: MCM "
        "is N, an hour and fifteen minutes short, controlled by OS1 Vega's watch.\n\n"
        "And it traces back. Every answer points to the task, the system and the record behind it.\n\n"
        "Today that thread is broken: the mission plan sits in a model or a slide, readiness is reported system by "
        "system, and a Sailor joins them on a whiteboard. HAWSIR makes the thread run.\n\n"
        "What is not done yet: we write the thread and the dependencies by hand. Reading them straight from the "
        "engineering model is the next link.")


# ================================================================ mission engineering, concretely
def slide_mission_eng():
    s = Slide()
    s.header('MISSION ENGINEERING, CONCRETELY', 'One mission, from its phases down to the systems it rides on', [
        ('Operation Open Passage as the engine sees it at 1000. The red path is what controls the mission.', 14, SOFT, False)])
    X0, G = 2.0, 0.18
    W = [2.65, 2.2, 2.35, 1.68, 1.15]
    XS = [X0 + sum(W[:i]) + i * G for i in range(len(W))]
    TY, TH = 3.15, 1.0
    SY = 4.5

    layers = [(1.8, 'MISSION', 'what the commander needs'), (2.45, 'PHASES', 'when'),
              (TY, 'MISSION THREAD', 'who does what, in order'),
              (SY, 'SYSTEM OF SYSTEMS', 'what each task rides on, and the record that reports it')]
    for y, name, sub in layers:
        s.label(0.6, y, 1.3, 1.2, [[(name, 10, CYAN, True)], [(sub, 9, MUTE, False)]], anchor=MSO_ANCHOR.TOP, spacing=2)

    mission = s.box(X0, 1.8, 10.75, 0.5, fill=HULL, line=CYAN, line_w=1.25)
    s.text(mission, [[('OPERATION OPEN PASSAGE', 11.5, CYAN, True),
                      ('    Mine assessment of Thimble Shoal lanes 1–4  ·  to the commander by 1800  ·  task group transits 2000',
                       10.5, INK, False)]], align=PP_ALIGN.LEFT)

    phases = [
        (MSO_SHAPE.PENTAGON, XS[0], XS[2] + W[2] - XS[0] + 0.1, CYAN, [[('ASSESS APPROACH', 11, CYAN, True), ('   0600–1800', 10, SOFT, False)]]),
        (MSO_SHAPE.CHEVRON, XS[3] - 0.08, W[3] + 0.16, AMBER, [[('COMMANDER DECISION', 9, AMBER, True)], [('1800–2000', 9, SOFT, False)]]),
        (MSO_SHAPE.CHEVRON, XS[4] - 0.08, W[4] + 0.08, AMBER, [[('TRANSIT', 9.5, AMBER, True)], [('2000', 9, SOFT, False)]]),
    ]
    for kind, x, w, color, runs in phases:
        shp = s.S.add_shape(kind, Inches(x), Inches(2.45), Inches(w), Inches(0.5))
        shp.adjustments[0] = 0.35
        shp.fill.solid()
        shp.fill.fore_color.rgb = CHIP
        shp.line.color.rgb = color
        shp.line.width = Pt(1.25)
        shp.shadow.inherit = False
        shp.text_frame.margin_left = shp.text_frame.margin_right = Inches(0.15)
        s.text(shp, runs)

    tasks = [
        ('SURFACE  ·  USV-1', BLUE, 'Launch › sonar survey, lanes 1–4 › recover › transfer', '0730–1400', SOFT),
        ('AIR  ·  MH-60S DET 1', SKY, 'Flight window › ALMDS sortie › collect', '0815–1115', SOFT),
        ('ANALYSIS', VIOLET, 'Review sonar AND airborne, with a qualified reviewer', '1645–1915', RED),
        ('COMMANDER', AMBER, 'Decides on the transit', 'due 1800', AMBER),
        ('TASK GROUP', CYAN, 'Transits the approach', '2000', SOFT),
    ]
    for i, (head, color, body, when, when_color) in enumerate(tasks):
        x, w = XS[i], W[i]
        critical = i == 2
        s.box(x, TY, w, TH, fill=HULL, line=RED if critical else color, line_w=2 if critical else 1.25, radius=0.06)
        s.label(x + 0.14, TY + 0.1, w - 0.28, 0.22, [[(head, 9, color, True)]])
        s.label(x + 0.14, TY + 0.33, w - 0.28, 0.45, [[(body, 10, INK, False)]], anchor=MSO_ANCHOR.TOP)
        s.label(x + 0.14, TY + TH - 0.28, w - 0.28, 0.22, [[(when, 10, when_color, True)]])

    mid = TY + TH / 2
    s.line(XS[1] + W[1] + 0.02, mid, XS[2] - 0.02, mid, MUTE, width=1.5)
    s.line(XS[2] + W[2] + 0.02, mid, XS[3] - 0.02, mid, RED, width=2)
    s.line(XS[3] + W[3] + 0.02, mid, XS[4] - 0.02, mid, AMBER, width=1.5)
    cy, sx, ex = TY + TH + 0.15, XS[0] + W[0] - 0.4, XS[2] + 0.4
    s.line(sx, TY + TH, sx, cy, MUTE, width=1.5, head=False)
    s.line(sx, cy, ex, cy, MUTE, width=1.5, head=False)
    s.line(ex, cy, ex, TY + TH + 0.01, MUTE, width=1.5)

    def chip(x, y, w, h, name, status, color, lane, critical=False):
        c = s.box(x, y, w, h, fill=CHIP, line=RED if critical else lane, line_w=2 if critical else 1, radius=0.12)
        c.text_frame.margin_left = c.text_frame.margin_right = Inches(0.06)
        s.text(c, [[(name, 9.5, INK, True)], [(status, 8.5, color, critical)]])

    CH, CG = 0.42, 0.04
    surface = [('USV-1', 'OMMS-NG · +30 min', AMBER), ('AQS-20C sonar', 'DRRS-N · up', GREEN),
               ('USV operators', 'WATCHBILL · ready', GREEN), ('MVCS link', 'MVCS · drops out', AMBER)]
    SW = (W[0] - 0.08) / 2
    for j, (n, st, c) in enumerate(surface):
        chip(XS[0] + (j % 2) * (SW + 0.08), SY + (j // 2) * (CH + CG), SW, CH, n, st, c, BLUE)
    air = [('MH-60S aircraft 61', 'HSC-DET · ready 0815, +45 min', AMBER), ('Det 1 aircrew', 'WATCHBILL · rested at 0700', GREEN),
           ('MPCE computing', 'DRRS-N · up, shared with the USV', GREEN)]
    for j, (n, st, c) in enumerate(air):
        chip(XS[1], SY + j * (CH + CG), W[1], CH, n, st, c, SKY)
    chip(XS[2], SY, W[2], CH, 'OS1 R. Vega · reviewer', 'WATCHBILL · CIC watch 1300–1645', RED, VIOLET, critical=True)
    chip(XS[2], SY + CH + CG, W[2], CH, 'MPAS analysis software', 'DRRS-N · up', GREEN, VIOLET)
    s.line(XS[2] + W[2] / 2, SY - 0.01, XS[2] + W[2] / 2, TY + TH + 0.01, RED, width=2)

    verdict = s.box(XS[3], SY, W[3], 1.0, fill=HULL, line=RED, line_w=2, radius=0.08)
    s.text(verdict, [[('CAPABILITY', 8.5, MUTE, True)], [('MCM:  N', 15, RED, True)],
                     [('−1 h 15 m  ·  ready 1915', 9, SOFT, False)]], spacing=1)
    s.line(XS[3] + W[3] / 2, SY - 0.01, XS[3] + W[3] / 2, TY + TH + 0.01, RED, width=2)
    chip(XS[4], SY, W[4], CH, 'CTG 20.4', 'AMHS · 0600', GREEN, CYAN)

    s.card(0.6, 6.1, 12.15, 0.88, RED)
    s.label(0.85, 6.22, 11.65, 0.8, [
        [('READ IT BOTTOM-UP   ', 10.5, RED, True),
         ("OS1 Vega takes the CIC watch 1300–1645 on the watchbill › the review can't start until 1645 › MCM is ready "
          "at 1915, 1 h 15 m past due › the commander's decision and the 2000 transit slip with it. The USV and helo "
          'reports landed first and looked bigger; neither one controls.', 11.5, INK, False)],
    ], anchor=MSO_ANCHOR.TOP)
    s.notes(
        "This is mission engineering made concrete, on the demo mission.\n\n"
        "At the top is the mission: assess the Thimble Shoal approach lanes for the commander by 1800, so the task "
        "group can transit at 2000. It runs in three phases: assess the approach, the commander's decision, and the "
        "transit.\n\n"
        "The assess phase is a thread of tasks: a USV sonar survey and an MH-60S airborne survey run in parallel, "
        "and both feed an analysis step that needs sonar and airborne evidence and a qualified reviewer. That goes "
        "to the commander, who decides on the transit.\n\n"
        "Under each task is the system of systems it rides on: the USV, its sonar, its operators and its control "
        "link; the helo, its aircrew and the mission computer; the analysis software and the reviewer. Each one is "
        "tagged with the record that reports it: OMMS-NG, DRRS-N, the watchbill, MVCS, the helo detachment.\n\n"
        "Read it bottom-up at 1000. The USV and helo delays landed first and look bigger, but they are absorbed. "
        "The one that controls is the watchbill: OS1 Vega, the only qualified reviewer, is on the CIC watch from "
        "1300 to 1645. The review cannot start until 1645, the assessment is ready at 1915, an hour and fifteen "
        "minutes late, and the commander's decision and the transit slip with it. All of this is synthetic data.")


# ================================================================ the question
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
        [('HAWSIR reads the records of eight systems, read-only, and recomputes the mission in milliseconds.', 12.5, INK, False)],
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
        "HAWSIR reads the records of eight systems read-only (OMMS-NG, R-Supply, NSIPS, SKED, DRRS-N, the watchbill, "
        "MVCS and AMHS; synthetic for now), puts them in one picture, and recomputes in milliseconds. Every number "
        "links to its source record, and nothing is written back.")


# ================================================================ the mission thread
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


# ================================================================ who decides
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


# ================================================================ tried to break it
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


# ================================================================ more missions
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


# ================================================================ built the platform (same as docs/slides)
def slide_platform_built():
    s = Slide()
    s.header('HAWSIR  ·  INFRASTRUCTURE', 'Built this week: a full Kubernetes platform on AWS', [
        ('From terraform apply to a hardened cluster serving HAWSIR at ', 14, SOFT, False),
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
        ('5', 'HAWSIR', 'Deploy the app', GREEN,
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
        "This week we built the platform under HAWSIR as well as the app: a real Kubernetes cluster in AWS, "
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


# ================================================================ how the cluster fits together (same as docs/slides)
def slide_platform_arch():
    s = Slide()
    s.header('HAWSIR  ·  LAB CLUSTER ON AWS', "One hardened node running the ship's stack", [
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
        [('HAWSIR: public', 10.5, GREEN, True)],
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
    s.text(app, [[('HAWSIR', 16, ABYSS, True)], [('app + audit volume', 10.5, ABYSS, False)]])
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
            'Only HAWSIR is public; admin tools return 404',
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
        "HAWSIR runs on the same stack it will use aboard ship: RHEL 9 with SELinux enforcing, RKE2 Kubernetes, "
        "and Defense Unicorns' UDS Core, all packaged with Zarf. Here it is one EC2 node behind an AWS load "
        "balancer.\n\n"
        "Traffic: the load balancer terminates TLS and serves only navifi.uds.demo.uncomn.ai to the public. "
        "Grafana, Keycloak and the UDS portal answer 404 unless the request comes from an operator IP. The node "
        "accepts traffic only from the load balancer, and there is no SSH: operators get in through AWS Systems "
        "Manager, authenticated by IAM and logged in CloudTrail.\n\n"
        "Inside the cluster, UDS Core wraps HAWSIR like every other workload: Pepr admission policies, Istio "
        "ambient mTLS, deny-by-default network policies generated from the app's Package, Falco runtime "
        "detection, and central logs and metrics.\n\n"
        "Delivery: one command takes any git commit, runs typecheck and tests in the image build, wraps the "
        "image in a Zarf package with an SBOM, and deploys it through the in-cluster registry, the same way the "
        "air-gapped ship bundle works. The lab differs only where an AWS demo needs it: TLS at the load balancer "
        "and sign-in off so the demo opens without an account. The ship build adds DISA STIG, FIPS and Keycloak SSO.")


# ================================================================ the same picture aboard ship
def slide_ship_arch():
    """The lab cluster slide's layout box for box, with everything that differs from the lab in amber."""
    s = Slide()
    s.header('HAWSIR  ·  THEORETICAL SHIPBOARD DEPLOYMENT', 'The same stack aboard, built for DDIL', [
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
        [('Runs with no shore link', 10.5, AMBER, True)],
        [('Admin tools: ship IT only', 10.5, SOFT, False)],
    ], spacing=3)
    s.label(2.6, 3.75, 1.6, 0.5, [[('Uses the link when it has one; nothing leaves in EMCON', 10, AMBER, False)]], align=PP_ALIGN.CENTER)

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
    s.text(app, [[('HAWSIR', 16, ABYSS, True)], [('app + audit volume', 10.5, ABYSS, False)]])
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
        ('Locked down aboard', CYAN, [
            'Installed whole; nothing downloads at sea',
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
        ('1 bundle', 'Zarf init, UDS Core and HAWSIR'),
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
        "It is built for DDIL: installed air-gapped, then it runs whatever the link is doing. Watchstanders reach "
        "HAWSIR over the ship's LAN with a CAC, through Keycloak. It needs no shore link to run, and there is no "
        "load balancer: TLS ends at the Istio gateway. When there is a link, the decision log goes ashore; in "
        "EMCON nothing leaves at all.\n\n"
        "The rack runs RHEL 9 with the DISA STIG and FIPS mode, and RKE2 with the CIS profile across three edge "
        "nodes. UDS Core uses Iron Bank images. The optional AI narrator runs in the cluster, so it works with the "
        "link down too.\n\n"
        "Delivery: pier side, connected, we build one UDS bundle carrying Zarf init, UDS Core and HAWSIR, with the "
        "model weights inside. It goes aboard by sneakernet or over a degraded link, and nothing is downloaded at sea.\n\n"
        "With the link up, the audit log forwards ashore in batches over SATCOM. In DDIL it trickles one entry at a "
        "time and uses a local model or template text. In EMCON nothing leaves the ship, and the engine, map, "
        "simulation and audit all keep working.")


# ================================================================ where we are
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


# ================================================================ nothing typed twice
def slide_data():
    s = Slide()
    s.header('WHERE THE DATA COMES FROM', 'Nothing typed twice', [
        ('HAWSIR reads the records the ship already keeps. Nobody re-enters a status to make the picture move.', 14, SOFT, False)])
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
    s.label(3.3, 4.65, 4.3, 0.55, [[('Connectors only read. HAWSIR never writes back to a system of record.', 11, AMBER, True)]],
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
        "Where the data comes from. HAWSIR reads the records the ship already keeps, through read-only connectors "
        "shaped like OMMS-NG, R-Supply, NSIPS, the watchbill and the rest. Each change arrives as a time-stamped "
        "event with its source record attached, and the mission is recomputed in milliseconds. Nobody types a "
        "status twice, and HAWSIR never writes back.\n\n"
        "Bad data is the normal case, so the engine flags it instead of asking a Sailor to reconcile it: missing "
        "values get a conservative assumption, stale ones are flagged on the input that controls, contradictions "
        "plan on the worse value, and malformed records are rejected.\n\n"
        "The accreditation paperwork comes from the code too: an SBOM and signature on every build, and an OSCAL "
        "file mapping 48 NIST 800-53 controls that CI regenerates and checks. All records here are synthetic.")


# ================================================================ what it gives back
def slide_impact():
    s = Slide()
    s.header('BEFORE AND AFTER', 'What it gives back to the watch', [
        ('Our tabletop comparison for one change landing mid-watch. Not measured fleet data yet.', 14, SOFT, False)])
    cols = [('AFTER A CHANGE LANDS', 0.6, 3.9), ('TODAY', 4.6, 2.1), ('WITH HAWSIR', 6.8, 2.2), ('HOW', 9.1, 3.65)]
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
        "watchbill and redoing the whiteboard. With HAWSIR it is recomputed in milliseconds when the report lands, "
        "on one screen, and every number links back to its record. The nonlinear effects and the bad data in our "
        "test cases are all caught, and every decision lands on a hash-chained log instead of a notebook.\n\n"
        "To make it real, the first 30 days are read-only exports from one DDG and three watch teams running this "
        "same comparison against today's process.")


# ================================================================ built for the person on watch
def slide_watch():
    s = Slide()
    s.header('THE SAILOR AT THE CONSOLE', 'Built for the person on watch', [
        ('One screen, plain words, and it keeps working when the ship goes quiet.', 14, SOFT, False)])
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


# ================================================================ slack is not margin
def slide_slack():
    s = Slide()
    s.header('THE IDEA UNDER THE ENGINE', 'Slack is not margin', [
        ("The late part gets the attention. The input that controls the mission often isn't the late one.", 14, SOFT, False)])
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


# ================================================================ beyond the surface fleet
def slide_domains():
    s = Slide()
    s.header('OTHER SHIPS, OTHER DOMAINS', 'Beyond the surface fleet', [
        ("Connor's engine keeps the core general and puts the domain knowledge in packs.", 14, SOFT, False)])
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
         'HAWSIR classic', "The app's radar repair case passes unchanged on this engine", True),
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
    s.label(RX + 0.25, 2.1, RW - 0.5, 0.32, [[('In the HAWSIR app today', 14, CYAN, True)]])
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


# ================================================================ appendix: the app, screen by screen
def app_slide(kicker, title, subtitle, still, items, caption, step=1.22):
    """One full app screenshot on the left, numbered callouts down the right."""
    s = Slide()
    s.header(kicker, title, [(subtitle, 14, SOFT, False)])
    h = s.shot(still, 0.6, 1.85, 8.55, color=CYAN_DIM)
    s.label(0.6, 1.85 + h + 0.08, 8.55, 0.3, [[(caption, 10.5, MUTE, False)]])
    beats(s, 9.45, 1.9, 3.35, items, step=step, title_size=13, body_size=10.5)
    return s


def slide_appendix():
    s = Slide()
    s.header('APPENDIX', 'The app, screen by screen', [
        ('Screenshots from the running app, for anyone who wants to look closer. All scenario data is synthetic.', 14, SOFT, False)])
    screens = [
        ('fleet_globe', 'Fleet picture', 'The whole fleet on one globe'),
        ('fleet_whatif', 'Fleet what-if', 'Three disruptions at once'),
        ('fleet_mission', 'Fleet drill-down', 'One mission, hull by hull'),
        ('sim_ddg', 'Monte Carlo', '2,000 seeded futures'),
        ('sim_radar', 'Monte Carlo', 'The radar repair, run 2,000 times'),
        ('horizon_ddg', 'Readiness horizon', 'Deadlines before they hit'),
        ('theater_ddg', 'Theater', 'Where the parts and people are'),
        ('thread_vls', 'Other workflows', 'Four threads, one engine'),
    ]
    TW, G = (12.15 - 3 * 0.25) / 4, 0.25
    for i, (still, name, what) in enumerate(screens):
        x, y = 0.6 + (i % 4) * (TW + G), 1.95 + (i // 4) * 2.55
        h = s.shot(still, x, y, TW, color=CYAN_DIM)
        s.label(x, y + h + 0.1, TW, 0.25, [[(name.upper(), 10.5, CYAN, True)]])
        s.label(x, y + h + 0.36, TW, 0.25, [[(what, 11.5, INK, False)]])
    s.notes(
        "The appendix is the app itself, screen by screen: the fleet picture and its what-if, a mission drill-down, "
        "the Monte Carlo simulation on two scenarios, the readiness horizon, the theater map, and the other mission "
        "threads that run on the same engine. Everything here is synthetic data.")


def slide_fleet_globe():
    s = app_slide('APPENDIX · FLEET PICTURE', 'The whole fleet on one globe',
                  'A labs prototype: every mission, hull and inbound package, timed by the same engine.', 'fleet_globe', [
        ('38 hulls, 150 packages',
         'Twelve missions across six numbered fleets. Each mission ring takes its readiness color, and the list on the left runs worst first.', CYAN),
        ('Every arc is a package',
         'Parts, people and data moving toward a hull. Amber has under a day of slack; red breaks its mission.', AMBER),
        ('Slack before it breaks',
         'The right panel lists packages at risk, smallest slack first, and marks the ones on the critical chain.', RED),
        ('Fast enough to explore',
         'The engine re-times every package in a fraction of a second on a laptop, so a what-if answers instantly.', GREEN),
    ], 'Fleet picture at rest, synthetic data. Drag to spin; click a mission or hull to drill in.')
    s.notes(
        "This is the fleet picture, a labs prototype on synthetic data. 38 hulls across six numbered fleets, 12 "
        "missions and 150 inbound packages, all timed by the same engine as the single-ship screens.\n\n"
        "Each mission ring takes its readiness color and the list on the left is worst first. Every arc is a "
        "package moving toward a hull: amber has under a day of slack, red breaks its mission. The right panel "
        "lists the packages at risk, smallest slack first.\n\n"
        "The whole fleet re-times in a fraction of a second on a laptop, which is what makes the what-if on the "
        "next slide feel instant.")


def slide_fleet_whatif():
    s = Slide()
    s.header('APPENDIX · FLEET WHAT-IF', 'What if three things go wrong at once?', [
        ('Toggle a disruption and see which missions break, and which ones redundancy saves.', 14, SOFT, False)])
    h = s.shot('fleet_whatif', 0.6, 1.85, 7.4, color=CYAN_DIM)
    s.label(0.6, 1.85 + h + 0.08, 7.4, 0.3, [[('AMC stand-down, Suez closed and a typhoon at Guam, all at once', 10.5, MUTE, False)]])
    h2 = s.shot('fleet_whatif', 8.25, 1.85, 4.5, color=VIOLET, crop=(3040, 180, 3825, 840))
    s.label(8.25, 1.85 + h2 + 0.08, 4.5, 0.3, [[('The what-if panel, zoomed in', 10.5, MUTE, False)]])
    s.card(0.6, 6.35, 12.15, 0.75, VIOLET)
    s.label(0.85, 6.5, 11.65, 0.55, [
        [('Six missions drop to N.  ', 12.5, RED, True),
         ('PROSPERITY GUARD holds: it has more hulls than it needs, so DDG-181 running late is absorbed. '
          'Sandbox only; no record changes, and the what-if is logged.', 12, INK, False)]], anchor=MSO_ANCHOR.TOP)
    s.notes(
        "The fleet what-if. Here we turn on three disruptions at once: an AMC airlift stand-down, the Suez Canal "
        "closed, and a typhoon closing Guam.\n\n"
        "Every affected package is re-timed through the same engine. Six missions drop to N, and the panel names "
        "the hull that now controls each one. PROSPERITY GUARD holds, because it needs fewer destroyers than it "
        "has, so DDG-181 running late is absorbed by redundancy.\n\n"
        "This is a sandbox: no authoritative record changes, and turning a what-if on or off is written to the "
        "decision log.")


def slide_fleet_mission():
    s = Slide()
    s.header('APPENDIX · FLEET DRILL-DOWN', 'One mission, hull by hull', [
        ('CSG-14 on station in the Arabian Sea: what it needs, who supplies it, and what controls it.', 14, SOFT, False)])
    h = s.shot('fleet_mission', 0.6, 1.85, 5.3, color=CYAN_DIM, crop=(900, 150, 3000, 2100))
    s.shot('fleet_mission', 6.15, 1.85, h * 785 / 1500, color=AMBER, crop=(3040, 500, 3825, 2000))
    beats(s, 9.0, 1.9, 3.8, [
        ('Need 2 of 3, not 3 of 3',
         'Air defense needs 2 of 3 ships. CG-183 is N, but the other two cover, so it is absorbed.', GREEN),
        ('One controlling constraint',
         'DDG-172 waiting on a SPY-1D amplifier by VERTREP from the oiler sets this mission at +12 h.', CYAN),
        ('Slack on every package',
         'Each inbound part and person shows how far it can slip before it breaks the mission.', AMBER),
        ('Down to the hull',
         'Click a hull for its capabilities and packages. Two hulls open their full watch floor.', VIOLET),
    ], step=1.22, title_size=13, body_size=10.5)
    s.notes(
        "Clicking a mission flies the globe to it. CSG-14 is a carrier strike group on station in the Arabian Sea.\n\n"
        "Requirements are counted the way the fleet counts them: air and missile defense needs two of three ships. "
        "CG-183 is not ready, but the other two cover, so it is absorbed and doesn't drive the mission. What does "
        "control it is DDG-172 waiting on a SPY-1D amplifier coming by VERTREP from the oiler, which puts the "
        "mission at plus 12 hours, qualified.\n\n"
        "Every inbound package shows its slack, and clicking a hull drills into its capabilities. Two of the hulls "
        "open straight into their full single-ship watch floor.")


def slide_mc_ddg():
    s = app_slide('APPENDIX · MONTE CARLO', '2,000 seeded futures, not one guess',
                  'USS Grace Hopper, 14 days out. Every uncertain input is drawn from a range and the whole graph re-runs.', 'sim_ddg', [
        ('Readiness S-curves',
         'The chance each capability is ready by any time. Five are solid; air and missile defense is the one at risk.', CYAN),
        ('Controls across futures',
         'FC1 Martinez controls air defense in most futures; the CFA part in about one in five.', AMBER),
        ('Seeded and reproducible',
         'Same seed, same answer, so the watch and a reviewer see identical results. Thousands of futures a second, in the browser.', GREEN),
        ('Honest about its inputs',
         'Ranges are planning assumptions widened for stale and missing data, not calibrated failure rates. The screen says so.', VIOLET),
    ], 'Simulation screen, DDG readiness thread, synthetic data')
    s.notes(
        "The Monte Carlo screen. The deterministic engine gives one answer; this runs the same graph 2,000 times "
        "with every uncertain input drawn from a range.\n\n"
        "The S-curves show the chance each capability is ready by any given time. On Grace Hopper five capabilities "
        "are solid and air and missile defense is the one at risk. Across futures FC1 Martinez controls it most "
        "of the time and the CFA part about one time in five, so the fix isn't just chasing the part.\n\n"
        "It is seeded, so the same seed always gives the same answer, and it runs in the browser at thousands of "
        "futures a second. The ranges are planning assumptions, not calibrated failure rates, and the screen "
        "says that in plain words.")


def slide_mc_radar():
    s = app_slide('APPENDIX · MONTE CARLO', 'The radar repair, run 2,000 times',
                  "The same case as 'slack is not margin'. Across every future, the team controls and the part never does.", 'sim_radar', [
        ('Margin is a spread',
         'Most futures make 1800 with time to spare, and a real tail misses. The histogram shows how much and how often.', AMBER),
        ('The team always controls',
         'The qualified repair team sets readiness in all 2,000 runs. The replacement part sets it in none.', GREEN),
        ('What moves the answer',
         'The tornado pushes each input to the ends of its range. Only the team and the repair time move the margin.', CYAN),
        ('One hour, tested',
         'The deterministic answer is an hour of margin. The simulation shows how often that hour actually holds.', VIOLET),
    ], 'Simulation screen, radar repair thread, synthetic data')
    s.notes(
        "The same simulation on the radar repair from the 'slack is not margin' slide.\n\n"
        "Margin is a spread, not a number: most futures make 1800 with time to spare, and there is a real tail "
        "that misses. Across all 2,000 runs the qualified repair team controls readiness every time and the "
        "replacement part never does, which is the slack-versus-margin point shown statistically.\n\n"
        "The tornado pushes each input to the ends of its range; only the team and the repair time move the "
        "answer. The deterministic engine says an hour of margin, and this shows how often that hour holds.")


def slide_horizon():
    s = app_slide('APPENDIX · READINESS HORIZON', 'Deadlines before they hit',
                  'Every capability against the voyage phases, with the next decisions in the order they come due.', 'horizon_ddg', [
        ('Readiness vs phases',
         'Each capability gets a projected-ready mark, its earlier predictions and a P10–P90 band over the voyage.', CYAN),
        ('Act-by list',
         'Soonest first: when a fly-on window closes, when an off-ship request has to go out.', AMBER),
        ('Margin burn-down',
         'How margin has moved as reports landed, against the line where Y drops to Q.', RED),
        ('Data health',
         'The age of the newest record from each feed, and every stale, assumed, conflicting or missing value.', GREEN),
    ], 'Readiness horizon, DDG readiness thread, synthetic data')
    s.notes(
        "The readiness horizon is the look-ahead. Every capability is plotted against the voyage phases with a "
        "projected-ready mark, its earlier predictions so you can see drift, and a P10 to P90 band from the "
        "simulation.\n\n"
        "The act-by list on the right is soonest first: when a fly-on window closes, when an off-ship request has "
        "to go out to make a difference. Underneath are the margin burn-down and the data health panel, which shows "
        "how old each feed is and counts every stale, assumed, conflicting or missing value the engine is using.")


def slide_theater():
    s = app_slide('APPENDIX · THEATER', 'Where the parts and people are',
                  'Grace Hopper in Norfolk, 14 days before a BMD patrol in the eastern Med.', 'theater_ddg', [
        ('Movements that matter',
         'Every part, person and data file en route, with its ETA. FC1 Martinez rejoining from Dam Neck is the critical chain.', AMBER),
        ('Phases need capabilities',
         'Each voyage phase lists what it needs at its start, so a late part shows up as a phase at risk.', CYAN),
        ('Radar coverage',
         'SPY-1D Array B is down until D-5, and the map shows the blind sector it leaves. Notional.', RED),
        ('Works in EMCON',
         'An offline vector basemap with no tile server, so the picture holds with the link down.', GREEN),
    ], 'Theater map, DDG readiness thread, synthetic data')
    s.notes(
        "The theater map puts the same graph on a chart. Grace Hopper is in Norfolk, 14 days before a BMD patrol "
        "in the eastern Med.\n\n"
        "Every movement feeding readiness is drawn with its ETA, and the critical chain stands out: FC1 Martinez "
        "rejoining from Dam Neck. Each voyage phase lists the capabilities it needs at its start. The SPY-1D panel "
        "is notional and shows the blind sector while Array B is down.\n\n"
        "The basemap ships with the app. There is no tile server, so the map works in EMCON.")


def slide_workflows():
    s = Slide()
    s.header('APPENDIX · OTHER WORKFLOWS', 'Four mission threads, one engine', [
        ('The same engine and the same screens, from hours to weeks and from parts to people.', 14, SOFT, False)])
    TW, G = (12.15 - 2 * 0.25) / 3, 0.25
    threads = [
        ('thread_ddg', AMBER, 'DDG READINESS · 21 DAYS', 'Grace Hopper before deployment',
         'Air defense is Q at +4 d 10 h. FC1 Martinez, not the late part, controls it.'),
        ('thread_vls', RED, 'VLS RELOAD · 72 HOURS', 'Mary G. Ross at Souda Bay',
         'Air defense is N at −2 h. GMC Horvat on light duty controls the reload, not the delayed C-17.'),
        ('thread_radar', GREEN, 'RADAR REPAIR · 10 HOURS', 'Grace Hopper surge tasking',
         'Y at +1 h. The qualified team controls; the part has two hours of slack.'),
    ]
    for i, (still, color, name, ship, body) in enumerate(threads):
        x = 0.6 + i * (TW + G)
        h = s.shot(still, x, 1.95, TW, color=color)
        s.label(x, 1.95 + h + 0.15, TW, 0.25, [[(name, 11, color, True)]])
        s.label(x, 1.95 + h + 0.45, TW, 0.3, [[(ship, 13.5, INK, True)]])
        s.label(x, 1.95 + h + 0.8, TW, 0.7, [[(body, 11, SOFT, False)]], anchor=MSO_ANCHOR.TOP)
    s.card(0.6, 5.65, 12.15, 0.95, CYAN)
    s.label(0.85, 5.82, 11.65, 0.7, [
        [('The fourth is in the main deck: ', 12.5, CYAN, True),
         ('mine countermeasures on Cape Charles, 12 hours. In every one, the thing that controls the mission '
          'is not the thing everyone is chasing.', 12.5, INK, False)]], anchor=MSO_ANCHOR.TOP)
    s.notes(
        "The same engine and screens run four mission threads. DDG readiness is three weeks out: air defense is "
        "qualified, and FC1 Martinez controls it rather than the late CFA part. The VLS reload is 72 hours at "
        "Souda Bay: air defense is not ready by two hours, and GMC Horvat on light duty controls it, not the "
        "delayed C-17. The radar repair is ten hours: ready with an hour of margin, the team controls and the part "
        "has two hours of slack.\n\n"
        "The fourth is the mine countermeasures thread from the main deck. In every one of them, the thing that "
        "controls the mission is not the thing everyone is chasing.")


APPENDIX = (slide_appendix, slide_fleet_globe, slide_fleet_whatif, slide_fleet_mission, slide_mc_ddg, slide_mc_radar,
            slide_horizon, slide_theater, slide_workflows)


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
    slides = (
        # who we are and the problem
        slide_title, slide_team, slide_question, slide_terms, slide_digital_thread, slide_mission_eng,
        # what it does for the watch
        slide_thread, slide_impact, slide_data, slide_watch, slide_decides,
        # how it works and how it holds up
        slide_slack, slide_break, slide_missions, slide_domains,
        # getting it to the fleet
        slide_platform_built, slide_platform_arch, slide_ship_arch,
        slide_where,
    ) + APPENDIX
    for build in slides:
        build()
    pptx = OUT / f'{NAME}.pptx'
    prs.save(pptx)
    print(pptx)
    export_previews(pptx)


if __name__ == '__main__':
    main()
