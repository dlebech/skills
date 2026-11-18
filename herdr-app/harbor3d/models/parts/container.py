"""Container: 2.4 long (Y) x 1.1 wide x 1.1 high, origin at the centre of the base, doors at the front end (-Y)."""
from lib import Builder, root


def build():
    rt = root("container")
    b = Builder("Body")
    w, L, a = 0.55, 1.2, 0.06
    # outline counter-clockwise: front edge, right side with two ribs, back edge, left side
    pts = [(-w, -L), (w, -L), (w - a, -0.6), (w, 0), (w - a, 0.6), (w, L), (-w, L), (-w + a, 0.6), (-w, 0), (-w + a, -0.6)]
    b.prism(pts, 0, 1.1, "ContainerColor")
    for x in (-0.18, 0.18):
        b.box((0.06, 0.05, 1.0), "ContainerColor", (x, -L - 0.02, 0.55))
    b.finish(rt)
    return rt
