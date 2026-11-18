"""Driftwood: a raft of three logs tied with two cross planks."""
from lib import Builder, root


def build():
    rt = root("driftwood")
    b = Builder("Body")
    for x, y, l, m in ((-0.4, 0.05, 1.9, "wood"), (0, -0.05, 2.0, "wood_dark"), (0.4, 0.1, 1.8, "wood")):
        b.cyl(0.2, 0.2, l, m, (x, y, 0.06), rot=(90, 0, 0), segs=6)
    for y in (-0.5, 0.5):
        b.box((1.3, 0.16, 0.07), "wood_dark", (0, y, 0.3))
        b.box((1.3, 0.05, 0.1), "rope", (0, y + 0.03, 0.32))
    b.finish(rt)
    return rt
