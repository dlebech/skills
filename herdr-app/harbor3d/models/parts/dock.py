"""Dock: short pier on posts, two lantern posts at the far end (lantern glass is its own object)."""
from lib import Builder, root


def build():
    rt = root("dock")
    b = Builder("Body")
    for i in range(8):
        b.box((1.2, 0.42, 0.1), "wood", (0, -1.75 + i * 0.5 + 0.0, 0.45))
    for s in (-1, 1):
        b.box((0.1, 4.0, 0.12), "wood_dark", (s * 0.4, 0, 0.34))
        for y in (-1.8, 0, 1.8):
            b.cyl(0.09, 0.09, 1.5, "wood_dark", (s * 0.52, y, -0.2), segs=6)
        b.cyl(0.04, 0.04, 0.8, "wood_dark", (s * 0.5, -1.8, 0.9), segs=4)
        b.box((0.26, 0.26, 0.05), "metal", (s * 0.5, -1.8, 1.32))
    b.finish(rt)
    for s, n in ((1, "L"), (-1, "R")):
        Builder(f"Lantern.{n}").box((0.2, 0.2, 0.26), "lamp", (s * 0.5, -1.8, 1.18)).finish(rt)
    return rt
