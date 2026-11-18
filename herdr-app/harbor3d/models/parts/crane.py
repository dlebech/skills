"""Gantry crane in yellow. Origin at the centre of the base, boom along +X at z 9 (x -3..8).
Trolley: origin on the boom axis at x 0. Hook: child of Trolley, spreader and slings, origin at the trolley."""
from lib import Builder, root


def build():
    rt = root("crane")
    b = Builder("Body")
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.box((0.3, 0.3, 8.4), "crane_yellow", (sx * 1.35, sy * 1.35, 4.2))
        b.box((0.4, 3.0, 0.4), "crane_yellow", (sx * 1.35, 0, 8.4))
        b.box((3.0, 0.4, 0.4), "crane_yellow", (0, sx * 1.35, 8.4))
        b.box((0.5, 2.9, 0.3), "steel", (sx * 1.35, 0, 0.15))
        for p0, p1 in (((sx * 1.35, -1.35, 0.8), (sx * 1.35, 1.35, 7.9)), ((sx * 1.35, 1.35, 0.8), (sx * 1.35, -1.35, 7.9)),
                       ((-1.35, sx * 1.35, 0.8), (1.35, sx * 1.35, 7.9))):
            b.tube([p0, p1], [0.07, 0.07], "steel", sides=4)
    b.box((11, 0.9, 0.8), "crane_yellow", (2.5, 0, 9.0))
    b.box((2.4, 1.8, 1.6), "crane_yellow", (-1.5, 0, 10.2))
    b.box((1.4, 0.05, 0.5), "glass", (-1.5, -0.92, 10.4))
    b.box((0.5, 0.5, 2.0), "crane_yellow", (0.3, 0, 10.4))
    for x in (8, -3):
        b.tube([(0.3, 0, 11.4), (x, 0, 9.4)], [0.06, 0.06], "steel", sides=4)
    b.finish(rt)
    t = Builder("Trolley")
    for y in (-0.55, 0.55):
        t.box((1.2, 0.15, 0.9), "steel", (0, y, 0))
    t.box((1.2, 1.25, 0.15), "steel", (0, 0, -0.55))
    t.box((0.9, 0.7, 0.3), "rubber", (0, 0, 0.65))
    to = t.finish(rt, origin=(0, 0, 9))
    h = Builder("Hook")
    h.box((1.1, 2.4, 0.18), "steel", (0, 0, -0.2))
    for sx in (-1, 1):
        for sy in (-1, 1):
            h.tube([(sx * 0.5, sy * 1.0, -0.1), (0, 0, 0.9)], [0.04, 0.04], "rubber", sides=4)
    h.ball(0.12, "steel", (0, 0, 0.9), 6, 3)
    h.finish(to, origin=(0, 0, 0))
    return rt
