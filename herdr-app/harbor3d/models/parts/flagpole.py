"""Flagpole: thin pole with a brass finial."""
from lib import Builder, root


def build():
    rt = root("flagpole")
    b = Builder("Body")
    b.cyl(0.05, 0.035, 3.4, "white", (0, 0, 1.7), segs=6)
    b.ball(0.05, "brass", (0, 0, 3.45), 6, 3)
    b.finish(rt)
    return rt
