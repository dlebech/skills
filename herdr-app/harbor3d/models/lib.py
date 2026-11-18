"""Shared helpers for the Harbor 3D models: palette, materials, a bmesh Builder, export.

Runs inside headless Blender (`blender -b --factory-startup -P build.py`). No bpy.ops is used for
geometry, so nothing depends on a UI context. Units are metres, up is Z, models face -Y.
"""
import math
import bmesh
import bpy
from mathutils import Matrix, Vector

PALETTE = dict(
    octo="e8708a", octo_dark="c4526e", crab="f07c48", crab_dark="c95a2a", sand="e9d3a1",
    rock="7f8a93", rock_dark="5d6770", wood="a9794a", wood_dark="7a5533", hull="c8553d",
    sail="fbf7ee", navy="264a6b", rope="e6cf98", brass="f2c94c", leaf="4f9d69",
    leaf_dark="37774d", white="ffffff", ink="1d2b3a", skin="f3c7a6", metal="9aa7b1",
    red="d4553e", lamp="fff3b0",
    concrete="a3a9ad", concrete_dark="787f84", asphalt="4b5257", steel="5f6b75", crane_yellow="f2b632",
    hull_red="b5412f", hull_blue="2f4f6f", deck="7f8a93", glass="9fd3e6", rubber="2a2d30",
    line_yellow="e8c547", tug_dark="2b3440", sig_red="6e2a24", sig_amber="6e5418", sig_green="24583a",
)
# Materials the scene recolours: their own name, a palette colour.
SPECIAL = dict(BuoyColor="brass", FlagColor="navy", ContainerColor="metal", MarkerColor="red", ShipLights="glass",
               OfficeLights="glass", SignalRed="sig_red", SignalAmber="sig_amber", SignalGreen="sig_green")


def _lin(c):
    """sRGB channel 0..1 to linear, which is what glTF base colours hold."""
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rgba(hexstr):
    v = [int(hexstr[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return (_lin(v[0]), _lin(v[1]), _lin(v[2]), 1.0)


def material(name):
    """One Principled BSDF material per name, created once and shared by every model."""
    m = bpy.data.materials.get(name)
    if m:
        return m
    hexstr = PALETTE.get(SPECIAL.get(name, name))
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = rgba(hexstr)
    b.inputs["Roughness"].default_value = 0.9
    b.inputs["Metallic"].default_value = 0.0
    if name == "lamp":
        b.inputs["Emission Color"].default_value = rgba(hexstr)
        b.inputs["Emission Strength"].default_value = 2.0
    m.diffuse_color = rgba(hexstr)
    return m


def clear():
    """Empty the scene between models so names and meshes never collide."""
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for me in list(bpy.data.meshes):
        bpy.data.meshes.remove(me)


def rotm(rx=0, ry=0, rz=0):
    """Euler XYZ rotation in degrees as a matrix."""
    return (Matrix.Rotation(math.radians(rz), 4, "Z") @ Matrix.Rotation(math.radians(ry), 4, "Y")
            @ Matrix.Rotation(math.radians(rx), 4, "X"))


def xform(loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    s = Matrix.Diagonal((*scale, 1))
    return Matrix.Translation(loc) @ rotm(*rot) @ s


class Builder:
    """Accumulates flat-shaded geometry with named materials into one mesh object."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []

    def _mi(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def _tag(self, res, mat):
        i = self._mi(mat)
        for v in res["verts"]:
            for f in v.link_faces:
                f.material_index = i

    def box(self, size, mat, loc=(0, 0, 0), rot=(0, 0, 0)):
        """Box of the given (x, y, z) size, centred on loc."""
        sx, sy, sz = size
        self._tag(bmesh.ops.create_cube(self.bm, size=1.0, matrix=xform(loc, rot, (sx, sy, sz))), mat)
        return self

    def cyl(self, r1, r2, h, mat, loc=(0, 0, 0), rot=(0, 0, 0), segs=8, caps=True, scale=(1, 1, 1)):
        """Frustum (cone when r2 is 0), centred on loc, axis along local Z."""
        res = bmesh.ops.create_cone(self.bm, cap_ends=caps, cap_tris=False, segments=segs,
                                    radius1=r1, radius2=r2, depth=h, matrix=xform(loc, rot, scale))
        self._tag(res, mat)
        return self

    def ball(self, r, mat, loc=(0, 0, 0), segs=8, rings=5, scale=(1, 1, 1), rot=(0, 0, 0)):
        """UV sphere (an ellipsoid with scale)."""
        res = bmesh.ops.create_uvsphere(self.bm, u_segments=segs, v_segments=rings, radius=r,
                                        matrix=xform(loc, rot, scale))
        self._tag(res, mat)
        return self

    def prism(self, outline, z0, z1, mat):
        """Straight prism: an (x, y) outline, counter-clockwise from above, between heights z0 and z1."""
        lo = [self.bm.verts.new((x, y, z0)) for x, y in outline]
        hi = [self.bm.verts.new((x, y, z1)) for x, y in outline]
        n = len(outline)
        fs = [self.bm.faces.new(lo[::-1]), self.bm.faces.new(hi)]
        fs += [self.bm.faces.new([lo[k], lo[(k + 1) % n], hi[(k + 1) % n], hi[k]]) for k in range(n)]
        for f in fs:
            f.material_index = self._mi(mat)
        bmesh.ops.triangulate(self.bm, faces=fs[:2], quad_method="BEAUTY", ngon_method="EAR_CLIP")
        return self

    def poly(self, pts, mat):
        """One face from points (counter-clockwise seen from outside)."""
        f = self.bm.faces.new([self.bm.verts.new(p) for p in pts])
        f.material_index = self._mi(mat)
        return self

    def hull(self, pts, mat):
        """Convex hull of points as a closed solid."""
        vs = [self.bm.verts.new(p) for p in pts]
        res = bmesh.ops.convex_hull(self.bm, input=vs)
        for v in [v for v in vs if not v.link_faces]:
            self.bm.verts.remove(v)
        self._tag({"verts": list({v for f in res["geom"] if isinstance(f, bmesh.types.BMFace) for v in f.verts})}, mat)
        return self

    def tube(self, path, radii, mat, sides=5, cap_end=True, cap_start=True):
        """Tube along a polyline of points with a radius per point."""
        rings, prev_n = [], None
        for i, p in enumerate(path):
            p = Vector(p)
            t = (Vector(path[min(i + 1, len(path) - 1)]) - Vector(path[max(i - 1, 0)])).normalized()
            ref = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
            n = t.cross(ref).normalized()
            if prev_n is not None and n.dot(prev_n) < 0:
                n = -n
            prev_n = n
            b = t.cross(n)
            ring = []
            for k in range(sides):
                a = 2 * math.pi * k / sides
                ring.append(self.bm.verts.new(p + (n * math.cos(a) + b * math.sin(a)) * radii[i]))
            rings.append(ring)
        faces = []
        for r in range(len(rings) - 1):
            for k in range(sides):
                k2 = (k + 1) % sides
                faces.append(self.bm.faces.new([rings[r][k], rings[r][k2], rings[r + 1][k2], rings[r + 1][k]]))
        if cap_start:
            faces.append(self.bm.faces.new(rings[0][::-1]))
        if cap_end:
            faces.append(self.bm.faces.new(rings[-1]))
        i = self._mi(mat)
        for f in faces:
            f.material_index = i
        return self

    def cut(self, keep):
        """Remove faces whose centre fails keep(center) (used to make caps from spheres)."""
        gone = [f for f in self.bm.faces if not keep(f.calc_center_median())]
        bmesh.ops.delete(self.bm, geom=gone, context="FACES")
        return self

    def finish(self, parent=None, origin=(0, 0, 0)):
        """Turn into an object (flat shaded, normals outward), origin moved to `origin`."""
        bm = self.bm
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        o = Vector(origin)
        bmesh.ops.translate(bm, verts=bm.verts, vec=-o)
        for f in bm.faces:
            f.smooth = False
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        bm.free()
        for m in self.mats:
            me.materials.append(material(m))
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        ob.location = o
        if parent:
            ob.parent = parent
        return ob


def root(name):
    """The model's root empty at the origin (centre of the base)."""
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    return e


def tri_count(objs):
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs if o.type == "MESH")


def family(rt):
    return [rt] + list(rt.children_recursive)


def export(rt, path):
    """Write the root and its children as one binary glTF, Y-up, no extras."""
    for o in bpy.data.objects:
        o.select_set(False)
    for o in family(rt):
        o.select_set(True)
    bpy.context.view_layer.objects.active = rt
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
        export_cameras=False, export_lights=False, export_animations=False,
        export_draco_mesh_compression_enable=False, export_normals=True, export_materials="EXPORT",
        export_image_format="NONE", export_extras=False, export_vertex_color="NONE")


def ring_pts(cx, cy, z, r, n, a0=0):
    return [(cx + r * math.cos(a0 + 2 * math.pi * i / n), cy + r * math.sin(a0 + 2 * math.pi * i / n), z) for i in range(n)]
