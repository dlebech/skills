"""Floodlight mast: 12 m steel mast with a rack of four lamps (Lamp) facing -Y."""
from lib import Builder, root


def build():
    rt = root("floodlight")
    b = Builder("Body")
    b.box((0.8, 0.8, 0.3), "concrete", (0, 0, 0.15))
    b.cyl(0.2, 0.12, 11.0, "steel", (0, 0, 5.8), segs=6)
    b.box((2.9, 0.1, 1.5), "steel", (0, 0.1, 11.25))
    for x in (-0.15, 0.15):
        b.box((0.04, 0.04, 5.0), "steel", (x, 0.25, 3.0))
    b.finish(rt)
    l = Builder("Lamp")
    for x in (-0.7, 0.7):
        for z in (10.95, 11.6):
            l.box((1.2, 0.25, 0.5), "lamp", (x, -0.08, z))
    l.finish(rt)
    return rt
