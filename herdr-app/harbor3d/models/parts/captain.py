"""Captain: the tug's skipper, about 1.1 m tall, origin at the feet, facing -Y. The waving arm is its own object `arm`, origin at the shoulder, so the page can swing it."""
from lib import Builder, root


def build():
    rt = root("captain")
    b = Builder("Body")
    b.box((0.4, 0.26, 0.34), "navy", (0, 0, 0.17))            # legs and coat skirt
    b.box((0.5, 0.3, 0.46), "navy", (0, 0, 0.55))             # coat
    b.box((0.12, 0.12, 0.12), "navy", (0.31, 0, 0.62))        # the resting arm, a stub on the left
    b.ball(0.07, "skin", (0.31, 0, 0.53), 6, 4)
    b.ball(0.18, "skin", (0, 0, 0.9), 7, 4)                   # head
    b.box((0.22, 0.1, 0.12), "metal", (0, -0.13, 0.82))       # short beard
    b.cyl(0.2, 0.2, 0.1, "white", (0, 0, 1.06), segs=7)       # cap
    b.box((0.24, 0.14, 0.03), "ink", (0, -0.17, 1.02))        # dark peak
    b.finish(rt)
    a = Builder("arm")
    sh = (-0.31, 0, 0.74)
    a.box((0.11, 0.11, 0.38), "navy", (sh[0], 0, sh[2] + 0.17))
    a.ball(0.07, "skin", (sh[0], 0, sh[2] + 0.4), 6, 4)
    a.finish(rt, origin=sh)
    return rt
