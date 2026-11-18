"""Ship: small coastal container ship. Bow towards -Y, bridge at the stern (+Y), deck at z 1.6."""
from lib import Builder, root


def build():
    rt = root("ship")
    b = Builder("Body")
    # hull: red below the waterline, blue above, a flat deck slab, raked bow
    w = lambda pts: [p for x, y, z in pts for p in ((x, y, z), (-x, y, z))]
    b.hull(w([(2.5, 9, 0), (2.5, 9, 1.5), (2.5, -3.5, 0), (2.5, -3.5, 1.5), (0.15, -9, 1.5), (0.1, -8, 0)]), "hull_blue")
    b.hull(w([(2.5, 9, 0), (2.5, -3.5, 0), (0.1, -8, 0), (1.6, 8.6, -1.2), (1.7, -3, -1.2), (0.05, -6.9, -1.2)]), "hull_red")
    b.hull(w([(2.35, 8.9, 1.5), (2.35, -3.5, 1.5), (0.12, -8.6, 1.5), (2.35, 8.9, 1.6), (2.35, -3.5, 1.6), (0.12, -8.6, 1.6)]), "deck")
    for s in (-1, 1):
        b.box((0.08, 9.0, 0.45), "white", (s * 2.42, 1.2, 1.85))
        b.cyl(0.05, 0.05, 0.8, "white", (s * 0.9, -6.5, 2.0), segs=5)
    # bridge house at the stern: two tiers and a roof
    b.box((4.0, 3.0, 2.6), "white", (0, 7.3, 2.9))
    b.box((3.2, 1.8, 1.2), "white", (0, 7.1, 4.8))
    b.box((3.6, 2.2, 0.12), "deck", (0, 7.1, 5.44))
    b.finish(rt)
    f = Builder("Funnel")
    f.cyl(0.52, 0.42, 2.0, "hull_red", (0, 8.3, 5.2), segs=8)
    f.finish(rt, origin=(0, 8.3, 6.2))
    m = Builder("Mast")
    m.cyl(0.05, 0.05, 2.5, "white", (0, 6.9, 6.75), segs=5)
    m.box((1.4, 0.05, 0.05), "white", (0, 6.9, 7.7))
    m.finish(rt, origin=(0, 6.9, 5.5))
    l = Builder("Lights")
    for x in (-1.35, -0.45, 0.45, 1.35):
        l.box((0.6, 0.05, 0.5), "ShipLights", (x, 5.78, 3.0))
    l.box((2.8, 0.05, 0.5), "ShipLights", (0, 6.18, 4.8))
    for s in (-1, 1):
        for y in (6.6, 7.8):
            l.box((0.05, 0.6, 0.5), "ShipLights", (s * 2.02, y, 3.0))
        l.ball(0.16, "ShipLights", (s * 0.9, -6.5, 2.5), 6, 4)
    l.finish(rt)
    return rt
