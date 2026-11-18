"""Harbor entrance beacon: slim steel post on a small concrete foot, a red cone daymark (Daymark, own colour
MarkerColor, apex up) near the top and a small lamp (Lamp) above it."""
from lib import Builder, root


def build():
    rt = root("marker")
    b = Builder("Body")
    b.cyl(0.5, 0.4, 0.4, "concrete", (0, 0, 0.2), segs=6)
    b.cyl(0.09, 0.07, 3.1, "steel", (0, 0, 1.85), segs=5)
    for s in (-1, 1):
        b.box((0.05, 0.05, 1.0), "steel", (s * 0.22, 0, 0.9), rot=(0, s * 12, 0))
    b.finish(rt)
    Builder("Daymark").cyl(0.45, 0, 0.9, "MarkerColor", (0, 0, 2.95), segs=6).finish(rt)
    Builder("Lamp").ball(0.3, "lamp", (0, 0, 3.7), 6, 3).finish(rt)
    return rt
