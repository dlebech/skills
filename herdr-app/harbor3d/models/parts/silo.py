"""Silo pair: two cylinders with cone roofs joined by a walkway near the top."""
from lib import Builder, root


def build():
    rt = root("silo")
    b = Builder("Body")
    for x in (-2.1, 2.1):
        b.cyl(1.9, 1.9, 7.5, "concrete", (x, 0, 3.75), segs=10)
        b.cyl(1.9, 0.3, 1.5, "steel", (x, 0, 8.25), segs=10)
        for z in (2.5, 5.5):
            b.cyl(1.97, 1.97, 0.25, "concrete_dark", (x, 0, z), segs=10, caps=False)
    b.box((0.5, 0.6, 0.12), "steel", (0, 0, 6.5))
    b.box((0.5, 0.05, 0.3), "steel", (0, -0.3, 6.65))
    b.finish(rt)
    return rt
