"""Rock: one irregular breakwater boulder, about 4 x 3 x 2.5, base on z 0."""
from lib import Builder, root


def build():
    rt = root("rock")
    b = Builder("Body")
    b.hull([(-2, -0.4, 0), (-1.4, -1.5, 0.2), (0.8, -1.5, 0), (2, -0.6, 0.3), (1.7, 1.2, 0.1), (-0.5, 1.5, 0),
            (-1.8, 0.9, 0.2), (-1.1, -1.0, 1.6), (1.0, -0.9, 1.3), (1.3, 0.6, 1.5), (-0.2, 0.1, 2.5), (0.5, -0.3, 2.3)], "rock")
    b.hull([(-2.0, -0.2, 0), (-1.7, 0.9, 0.1), (-0.6, 0.7, 0.4), (-1.3, -0.9, 1.0), (-0.9, 0.2, 1.8), (-0.3, -0.5, 0.9)], "rock_dark")
    b.finish(rt)
    return rt
