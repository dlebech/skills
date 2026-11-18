"""Reef: low island, flat sand top (radius 2.5 stays flat), rocks, coral bumps, a skirt down to -1.5."""
import math
import bmesh
import bpy
from lib import Builder, root, ring_pts


def build():
    rt = root("reef")
    n = 14
    wob = [1.0, 0.92, 1.05, 0.95, 1.0, 0.9, 1.04, 0.97, 1.02, 0.93, 1.06, 0.96, 1.0, 0.94]
    levels = [(0.6, 3.5), (0.3, 3.95), (-0.3, 3.9), (-1.5, 2.8)]
    mats = ["sand", "sand", "rock_dark"]
    b = Builder("Body")
    rings = [[b.bm.verts.new(p) for p in ring_pts(0, 0, z, r, n)] for z, r in levels]
    for ring, (z, r) in zip(rings, levels):
        for v, w in zip(ring, wob):
            v.co.x *= w
            v.co.y *= w
    for li in range(3):
        for k in range(n):
            k2 = (k + 1) % n
            f = b.bm.faces.new([rings[li][k], rings[li][k2], rings[li + 1][k2], rings[li + 1][k]])
            f.material_index = b._mi(mats[li])
    top = b.bm.faces.new(rings[0][::-1])
    top.material_index = b._mi("sand")
    bot = b.bm.faces.new(rings[3])
    bot.material_index = b._mi("rock_dark")
    # rocks sit on the rim, outside the 2.5 m standing circle
    for i, (a, r, s, m) in enumerate([(20, 3.0, 0.55, "rock"), (110, 3.1, 0.4, "rock_dark"), (200, 2.95, 0.6, "rock"),
                                      (285, 3.15, 0.45, "rock_dark"), (330, 3.1, 0.3, "rock")]):
        ar = math.radians(a)
        b.ball(s, m, (r * math.cos(ar), r * math.sin(ar), 0.55), 6, 4, (1.15, 1, 0.6), rot=(0, 0, a * 3))
    for i, (a, m) in enumerate([(55, "crab"), (75, "octo"), (150, "octo"), (170, "crab"), (235, "crab"), (250, "octo"), (305, "octo"), (355, "crab")]):
        ar = math.radians(a)
        r = 3.85
        b.cyl(0.17, 0.05, 0.5 + 0.1 * (i % 3), m, (r * math.cos(ar), r * math.sin(ar), 0.15), segs=5)
    b.finish(rt)
    return rt
