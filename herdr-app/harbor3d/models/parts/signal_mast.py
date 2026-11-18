"""Signal mast: steel mast, a three-lamp head facing -Y (red, amber, green from the top), a small ladder behind."""
from lib import Builder, root


def build():
    rt = root("signal")
    b = Builder("Body")
    b.box((0.5, 0.5, 0.1), "steel", (0, 0, 0.05))
    b.cyl(0.09, 0.09, 4.8, "steel", (0, 0, 2.4), segs=6)
    b.box((0.5, 0.3, 1.5), "rubber", (0, 0, 3.95))
    b.box((0.4, 0.06, 0.04), "rubber", (0, -0.2, 4.78))
    for x in (-0.15, 0.15):
        b.box((0.04, 0.04, 3.0), "steel", (x, 0.12, 1.6))
    for z in (0.6, 1.5, 2.4):
        b.box((0.34, 0.04, 0.04), "steel", (0, 0.12, z))
    b.finish(rt)
    for name, z in (("Red", 4.4), ("Amber", 3.95), ("Green", 3.5)):
        Builder(name).cyl(0.14, 0.14, 0.1, "Signal" + name, (0, -0.17, z), rot=(90, 0, 0), segs=8).finish(rt)
    return rt
