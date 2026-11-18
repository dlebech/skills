"""Tug: stubby harbour tug, bow towards -Y, origin at the waterline centre. Open wheelhouse so the captain shows."""
from lib import Builder, root


def build():
    rt = root("tug")
    b = Builder("Body")
    w = lambda pts: [p for x, y, z in pts for p in ((x, y, z), (-x, y, z))]
    b.hull(w([(1.2, 3.5, 1.1), (1.5, 2.8, 1.1), (1.5, -1.2, 1.1), (0.9, -2.8, 1.1), (0.35, -3.5, 1.1),
              (0.9, 3.0, -0.9), (1.1, -1.2, -0.9), (0.3, -3.0, -0.9)]), "tug_dark")
    b.box((2.2, 2.0, 0.5), "white", (0, -0.4, 1.35))
    for x in (-1.0, 1.0):
        for y in (-1.3, 0.5):
            b.box((0.14, 0.14, 1.1), "white", (x, y, 2.15))
    b.box((2.5, 2.3, 0.14), "white", (0, -0.4, 2.77))
    b.cyl(0.04, 0.04, 0.7, "white", (0, -0.4, 3.15), segs=5)
    b.cyl(0.42, 0.42, 1.9, "white", (0, 1.5, 2.05), segs=8)
    b.cyl(0.44, 0.44, 0.35, "tug_dark", (0, 1.5, 3.0), segs=8)
    b.cyl(0.35, 0.35, 1.3, "rubber", (0, -3.35, 0.65), rot=(0, 90, 0), segs=6)
    for s in (-1, 1):
        b.box((0.12, 0.12, 0.8), "rubber", (s * 1.1, 2.7, 1.5))
        for y in (-0.5, 1.0):
            b.cyl(0.3, 0.3, 0.25, "rubber", (s * 1.55, y, 0.6), rot=(0, 90, 0), segs=6)
    b.box((2.3, 0.12, 0.12), "rubber", (0, 2.7, 1.9))
    b.finish(rt)
    c = Builder("Captain")
    c.box((0.5, 0.35, 0.55), "tug_dark", (0, -0.2, 1.85))
    c.ball(0.2, "skin", (0, -0.2, 2.32), 8, 5)
    c.cyl(0.22, 0.22, 0.12, "white", (0, -0.2, 2.5), segs=8)
    c.finish(rt)
    Builder("Light").ball(0.15, "lamp", (0, -0.4, 3.45), 6, 4).finish(rt)
    return rt
