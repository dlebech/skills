"""Lighthouse: rock base, tapering tower with two red bands, gallery, glass lamp room (Lamp), red cap."""
from lib import Builder, root


def build():
    rt = root("lighthouse")
    b = Builder("Body")
    b.cyl(1.5, 1.3, 0.5, "rock", (0, 0, 0.25), segs=8)
    b.cyl(1.25, 1.1, 0.4, "rock", (0, 0, 0.7), segs=8)
    z0, z1, r0, r1 = 0.9, 6.0, 1.0, 0.62
    cuts = [0, 0.22, 0.4, 0.6, 0.78, 1]
    for i in range(5):
        a, c = cuts[i], cuts[i + 1]
        h = (c - a) * (z1 - z0)
        ra, rc = r0 + (r1 - r0) * a, r0 + (r1 - r0) * c
        b.cyl(ra, rc, h, "red" if i in (1, 3) else "white", (0, 0, z0 + (a + c) / 2 * (z1 - z0)), segs=8, caps=(i == 4))
    b.cyl(1.0, 1.0, 0.18, "navy", (0, 0, 6.09), segs=8)
    for k in range(8):
        import math
        a = math.radians(k * 45 + 22.5)
        b.box((0.09, 0.09, 0.3), "navy", (0.92 * math.cos(a), 0.92 * math.sin(a), 6.33), rot=(0, 0, k * 45 + 22.5))
    b.cyl(0.62, 0.62, 0.08, "navy", (0, 0, 7.44), segs=8)
    for s in (-1, 1):
        for t in (-1, 1):
            b.box((0.1, 0.1, 1.2), "navy", (s * 0.4, t * 0.4, 6.8))
    b.cyl(0.8, 0.0, 1.1, "red", (0, 0, 8.05), segs=8)
    b.ball(0.15, "navy", (0, 0, 8.85), 6, 3)
    b.box((0.3, 0.1, 0.55), "navy", (0, -0.9, 1.3))
    for z in (2.9, 4.3):
        b.box((0.18, 0.1, 0.3), "navy", (0, -0.78 + (z - 2.9) * 0.02, z))
    b.finish(rt)
    Builder("Lamp").cyl(0.42, 0.42, 1.0, "lamp", (0, 0, 6.8), segs=8, caps=False).finish(rt, origin=(0, 0, 6.8))
    return rt
