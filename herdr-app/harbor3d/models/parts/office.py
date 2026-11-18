"""Harbor office: two-storey block, glazed control room on a tower, spinning radar bar (Radar, origin on its axis)."""
from lib import Builder, root


def build():
    rt = root("office")
    b = Builder("Body")
    b.box((8, 6, 5.4), "concrete", (0, 0, 2.7))
    b.box((8.4, 6.4, 0.3), "concrete_dark", (0, 0, 5.55))
    b.box((3, 3, 1.8), "concrete", (0, 0, 6.6))
    for x in (-1.7, 1.7):
        for y in (-1.7, 1.7):
            b.box((0.2, 0.2, 1.3), "concrete_dark", (x, y, 8.15))
    b.box((4.0, 4.0, 0.3), "concrete_dark", (0, 0, 8.95))
    b.box((1.6, 0.5, 2.0), "crane_yellow", (0, -3.2, 1.0))
    b.cyl(0.1, 0.1, 1.4, "steel", (0, 0, 9.8), segs=6)
    b.finish(rt)
    w = Builder("Windows")
    for x in (-2.8, -0.95, 0.95, 2.8):
        w.box((1.1, 0.1, 0.9), "OfficeLights", (x, -3.0, 4.0))
        if abs(x) > 2:
            w.box((1.1, 0.1, 0.9), "OfficeLights", (x, -3.0, 1.4))
    w.box((3.4, 3.4, 1.0), "OfficeLights", (0, 0, 8.15))
    w.finish(rt)
    r = Builder("Radar")
    r.box((3.2, 0.3, 0.5), "steel", (0, 0, 10.75))
    r.finish(rt, origin=(0, 0, 10.75))
    return rt
