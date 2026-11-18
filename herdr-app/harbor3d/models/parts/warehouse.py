"""Warehouse: long shed, shallow pitched roof (ridge along X), two big doors at the front (-Y)."""
from lib import Builder, root


def build():
    rt = root("warehouse")
    b = Builder("Body")
    b.box((16, 9, 4.2), "concrete", (0, 0, 2.1))
    b.hull([(-8.1, -4.55, 4.0), (8.1, -4.55, 4.0), (-8.1, 4.55, 4.0), (8.1, 4.55, 4.0), (-8.1, 0, 6.0), (8.1, 0, 6.0)], "hull_blue")
    for x in (-4.2, 4.2):
        b.box((4.2, 0.1, 3.3), "steel", (x, -4.52, 1.65))
        b.box((4.6, 0.06, 0.2), "line_yellow", (x, -4.55, 3.4))
    b.finish(rt)
    return rt
