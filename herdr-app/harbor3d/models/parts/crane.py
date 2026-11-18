"""Crane: base, post, and a rotating arm with a hook (Arm: origin on the post axis)."""
from lib import Builder, root


def build():
    rt = root("crane")
    b = Builder("Body")
    b.box((0.7, 0.7, 0.2), "wood_dark", (0, 0, 0.1))
    b.cyl(0.14, 0.12, 2.1, "red", (0, 0, 1.25), segs=6)
    b.box((0.22, 0.22, 0.2), "brass", (0, 0, 2.4))
    b.finish(rt)
    a = Builder("Arm")
    a.box((0.16, 1.5, 0.16), "metal", (0, -0.3, 2.1))
    a.box((0.34, 0.3, 0.3), "wood_dark", (0, 0.5, 2.1))
    a.box((0.07, 0.07, 0.65), "metal", (0, -0.95, 1.7))
    a.ball(0.08, "brass", (0, -0.95, 1.33), 6, 3)
    a.box((0.07, 0.8, 0.07), "metal", (0, -0.1, 1.95), rot=(-20, 0, 0))
    a.finish(rt, origin=(0, 0, 2.1))
    return rt
