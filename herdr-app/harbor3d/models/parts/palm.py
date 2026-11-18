"""Palm: bent trunk, six drooping leaves, three coconuts."""
import math
from lib import Builder, root


def build():
    rt = root("palm")
    b = Builder("Body")
    path = [(0, 0, 0), (0.1, 0, 0.65), (0.3, 0, 1.3), (0.45, 0, 2.0), (0.4, 0, 2.75)]
    b.tube(path, [0.2, 0.15, 0.12, 0.1, 0.09], "wood", sides=6)
    cx, cz = 0.4, 2.75
    for i in range(6):
        a = i * 60 + 15
        pts = []
        for x, y, z in [(0.05, 0.04, 0.0), (0.05, -0.04, 0.0), (0.5, 0.18, 0.2), (0.5, -0.18, 0.2), (1.0, 0.0, -0.1)]:
            for t in (0.025, -0.025):
                pts.append((x, y, z + t))
        ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a))
        b.hull([(cx + x * ca - y * sa, x * sa + y * ca, cz + z) for x, y, z in pts], "leaf" if i % 2 else "leaf_dark")
    for k in range(3):
        a = math.radians(k * 120 + 40)
        b.ball(0.07, "wood_dark", (cx + 0.1 * math.cos(a), 0.1 * math.sin(a), cz - 0.1), 5, 3)
    b.finish(rt)
    return rt
