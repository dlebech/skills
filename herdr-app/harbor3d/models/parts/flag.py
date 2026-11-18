"""Flag: 1.0 x 0.6 slab in 4 segments along its length (so it can wave), origin at the middle of the hoist edge."""
from lib import Builder, root


def build():
    rt = root("flag")
    b = Builder("Flag")
    m = b._mi("FlagColor")
    V = [[[b.bm.verts.new((i * 0.25, s * 0.004, z)) for z in (-0.3, 0.3)] for i in range(5)] for s in (-1, 1)]

    def q(*vs, flip=False):
        f = b.bm.faces.new(vs[::-1] if flip else vs)
        f.material_index = m
    for i in range(4):
        q(V[0][i][0], V[0][i + 1][0], V[0][i + 1][1], V[0][i][1])
        q(V[1][i][0], V[1][i + 1][0], V[1][i + 1][1], V[1][i][1], flip=True)
        q(V[0][i][1], V[0][i + 1][1], V[1][i + 1][1], V[1][i][1])
        q(V[0][i][0], V[0][i + 1][0], V[1][i + 1][0], V[1][i][0], flip=True)
    q(V[0][0][0], V[0][0][1], V[1][0][1], V[1][0][0])
    q(V[0][4][0], V[0][4][1], V[1][4][1], V[1][4][0], flip=True)
    b.finish(rt)
    return rt
