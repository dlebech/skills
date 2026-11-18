"""Crab: wide flat shell, eyes on stalks, two claws (origin at the shoulder), six legs."""
from lib import Builder, root


def build():
    rt = root("crab")
    b = Builder("Body")
    b.ball(0.4, "crab", (0, 0, 0.15), 8, 5, (0.95, 0.8, 0.45))
    for s in (-1, 1):
        b.cyl(0.03, 0.03, 0.14, "crab_dark", (s * 0.12, -0.27, 0.3), segs=4, caps=False)
        b.ball(0.075, "white", (s * 0.12, -0.27, 0.38), 8, 3)
        b.ball(0.04, "ink", (s * 0.12, -0.33, 0.38), 6, 3)
    b.finish(rt)
    for s, n in ((1, "L"), (-1, "R")):
        sh = (s * 0.3, -0.18, 0.17)
        c = Builder(f"Claw.{n}")
        c.tube([sh, (s * 0.36, -0.3, 0.2)], [0.05, 0.05], "crab_dark", sides=4)
        c.ball(0.13, "crab_dark", (s * 0.36, -0.42, 0.2), 8, 3, (1, 1.15, 0.7))
        for dx in (-0.045, 0.045):
            c.cyl(0.05, 0.0, 0.17, "crab_dark", (s * 0.36 + dx, -0.57, 0.2), rot=(90, 0, 0), segs=4)
        c.finish(rt, origin=sh)
    lg = Builder("Legs")
    for s in (-1, 1):
        for y in (-0.15, 0.02, 0.19):
            lg.tube([(s * 0.25, y, 0.12), (s * 0.4, y + 0.03, 0.16), (s * 0.46, y + 0.05, 0.0)], [0.035, 0.035, 0.03], "crab_dark", sides=4)
    lg.finish(rt)
    return rt
