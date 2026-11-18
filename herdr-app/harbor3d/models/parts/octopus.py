"""Octopus: round head, two big eyes, eight curled tentacles, two lids (scaled to 0 by the scene)."""
import math
from lib import Builder, root


def build():
    rt = root("octopus")
    b = Builder("Body")
    b.ball(0.6, "octo", (0, 0, 0.76), 12, 8, (1, 1, 1.08))
    for s in (-1, 1):
        b.ball(0.2, "white", (s * 0.27, -0.5, 0.86), 8, 4)
        b.ball(0.1, "ink", (s * 0.27, -0.63, 0.86), 6, 3)
    for x, y in ((-0.2, 0.1), (0.15, 0.25), (0.28, -0.05)):
        b.ball(0.08, "octo_dark", (x, y, 1.36), 6, 3, (1, 1, 0.5))
    b.finish(rt)
    for i in range(8):
        a = math.radians(i * 45 + 22.5)
        ca, sa = math.cos(a), math.sin(a)
        prof = [(0.34, 0.30, 0.15), (0.52, 0.17, 0.13), (0.68, 0.13, 0.11), (0.76, 0.22, 0.08), (0.70, 0.36, 0.05)]
        path = [(r * ca, r * sa, z) for r, z, _ in prof]
        t = Builder(f"Tentacle.{i}").tube(path, [p[2] for p in prof], "octo", sides=5, cap_start=False)
        t.finish(rt, origin=path[0])
    for s, n in ((1, "L"), (-1, "R")):
        c = (s * 0.27, -0.5, 0.86)
        l = Builder(f"EyeLid.{n}").ball(0.235, "octo_dark", c, 8, 4).cut(lambda p, c=c: p.y < c[1] - 0.01)
        l.finish(rt, origin=c)
    return rt
