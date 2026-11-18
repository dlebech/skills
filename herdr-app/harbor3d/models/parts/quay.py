"""Quay: one 22 m segment. Origin at the centre of its edge at water level, the land is behind (+Y)."""
from lib import Builder, root


def build():
    rt = root("quay")
    b = Builder("Body")
    b.box((22, 14, 3.6), "concrete_dark", (0, 7, -1.2))
    b.box((22, 14, 0.5), "concrete", (0, 7, 0.85))
    b.box((22, 0.45, 0.1), "concrete_dark", (0, 0.225, 1.15))
    b.box((22, 0.2, 0.02), "line_yellow", (0, 0.8, 1.11))
    for x in (-7.5, 0, 7.5):
        b.cyl(0.22, 0.18, 0.35, "steel", (x, 1.4, 1.275), segs=6)
        b.cyl(0.35, 0.35, 0.3, "rubber", (x, -0.15, 0.1), rot=(90, 0, 0), segs=6)
    b.finish(rt)
    return rt
