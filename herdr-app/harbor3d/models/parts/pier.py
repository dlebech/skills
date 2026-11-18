"""Pier: concrete finger pier on round piles. Origin at the centre of the landward end at water level, runs to -Y."""
from lib import Builder, root


def build():
    rt = root("pier")
    b = Builder("Body")
    b.box((4, 26, 0.6), "concrete", (0, -13, 0.9))
    for s in (-1, 1):
        b.box((0.25, 26, 0.12), "concrete_dark", (s * 1.875, -13, 1.14))
        b.box((0.15, 26, 0.02), "line_yellow", (s * 1.6, -13, 1.19))
        for i in range(7):
            b.cyl(0.28, 0.28, 3.6, "concrete_dark", (s * 1.5, -2 - 3.7 * i, -1.2), segs=6, caps=False)
        for y in (-4, -10, -16, -22):
            b.cyl(0.2, 0.17, 0.4, "steel", (s * 1.55, y, 1.4), segs=6)
    for y in (-4, -10, -16, -22):
        b.cyl(0.32, 0.32, 0.3, "rubber", (2.1, y, 0.7), rot=(0, 90, 0), segs=6)
    b.finish(rt)
    return rt
