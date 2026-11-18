"""Buoy: white base and ring, coloured float cone (material BuoyColor), small top light."""
from lib import Builder, root


def build():
    rt = root("buoy")
    b = Builder("Body")
    b.cyl(0.2, 0.25, 0.3, "white", (0, 0, -0.0), segs=6)
    b.cyl(0.27, 0.27, 0.08, "white", (0, 0, 0.19), segs=6)
    b.cyl(0.03, 0.03, 0.25, "white", (0, 0, 0.78), segs=4)
    b.ball(0.08, "lamp", (0, 0, 0.85), 6, 3)
    b.finish(rt)
    Builder("Float").cyl(0.24, 0.1, 0.4, "BuoyColor", (0, 0, 0.43), segs=6).finish(rt)
    return rt
