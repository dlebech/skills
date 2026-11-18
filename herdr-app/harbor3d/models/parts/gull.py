"""Gull: wings spread, ~1.2 m wingspan, flying (origin at the body centre). .L is +X (the bird's own left)."""
from lib import Builder, root


def build():
    rt = root("gull")
    b = Builder("Body")
    b.ball(0.14, "white", (0, 0, 0), 8, 4, (0.8, 2.0, 0.75))
    b.ball(0.09, "white", (0, -0.3, 0.05), 6, 4)
    b.cyl(0.035, 0.0, 0.13, "brass", (0, -0.42, 0.04), rot=(90, 0, 0), segs=4)
    for s in (-1, 1):
        b.ball(0.025, "ink", (s * 0.06, -0.36, 0.08), 4, 3)
    b.hull([(-0.07, 0.25, -0.02), (0.07, 0.25, -0.02), (-0.1, 0.5, 0.0), (0.1, 0.5, 0.0), (0, 0.25, 0.04)], "white")
    b.finish(rt)
    for s, n in ((1, "L"), (-1, "R")):
        w = Builder(f"Wing.{n}")
        w.hull([(s * x, y, z) for (x, y, z) in [(0.06, -0.12, 0.03), (0.06, 0.16, 0.03), (0.06, -0.12, -0.01), (0.06, 0.16, -0.01),
                                               (0.4, -0.04, 0.1), (0.4, 0.14, 0.1), (0.4, -0.04, 0.07), (0.4, 0.14, 0.07)]], "white")
        w.hull([(s * x, y, z) for (x, y, z) in [(0.4, -0.04, 0.1), (0.4, 0.14, 0.1), (0.4, -0.04, 0.07), (0.4, 0.14, 0.07),
                                               (0.6, 0.12, 0.12), (0.6, 0.12, 0.1)]], "metal")
        w.finish(rt, origin=(s * 0.06, 0, 0.02))
    return rt
