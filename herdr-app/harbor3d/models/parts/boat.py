"""Boat: small wooden boat, mast, sail, a captain sitting in it, an anchor hanging at the bow."""
from lib import Builder, root


def build():
    rt = root("boat")
    b = Builder("Body")
    top = [(0.8, 1.9, 0.55), (0.85, 0.3, 0.55), (0.55, -1.3, 0.55), (0, -2.0, 0.75)]
    bot = [(0.45, 1.7, -0.15), (0.5, 0, -0.15), (0.2, -1.2, -0.15), (0, -1.6, -0.1)]
    pts = [p for p in top + bot] + [(-x, y, z) for x, y, z in top + bot if x]
    b.hull(pts, "hull")
    b.box((1.2, 3.0, 0.06), "wood", (0, 0.25, 0.57))
    b.box((1.4, 0.18, 0.1), "wood", (0, 0.2, 0.62))
    b.cyl(0.07, 0.06, 2.7, "wood", (0, -0.3, 1.85), segs=6)
    b.hull([(0, -0.3, 3.0), (0, 0.15, 3.1), (0, -0.3, 3.2), (0.03, -0.3, 3.1), (-0.03, -0.3, 3.1)], "hull")
    b.finish(rt)
    cap = Builder("Captain")
    cap.ball(0.28, "navy", (0, 0.9, 0.85), 8, 4, (1, 1, 1.1))
    cap.ball(0.22, "skin", (0, 0.9, 1.3), 8, 5)
    for s in (-1, 1):
        cap.ball(0.035, "navy", (s * 0.08, 0.7, 1.33), 4, 3)
    cap.cyl(0.24, 0.22, 0.12, "sail", (0, 0.9, 1.5), segs=8)
    cap.cyl(0.28, 0.28, 0.03, "sail", (0, 0.86, 1.43), segs=8)
    cap.finish(rt)
    sail = Builder("Sail")
    sail.hull([(x, y, z) for x in (-0.03, 0.03) for (y, z) in ((-0.35, 0.9), (-0.35, 3.0), (1.3, 0.9))], "sail")
    sail.finish(rt, origin=(0, -0.3, 0.9))
    an = Builder("Anchor")
    ring = (0, -2.12, 0.5)
    an.ball(0.07, "navy", ring, 6, 3, (1, 0.6, 1))
    an.box((0.07, 0.07, 0.6), "navy", (0, -2.12, 0.15))
    an.box((0.34, 0.07, 0.07), "navy", (0, -2.12, 0.33))
    for s in (-1, 1):
        an.box((0.22, 0.07, 0.07), "navy", (s * 0.1, -2.12, -0.12), rot=(0, s * -35, 0))
    an.finish(rt, origin=ring)
    return rt
