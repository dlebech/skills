"""Renders a contact sheet of every committed out/*.glb to one PNG (proof only, not committed).

    blender -b --factory-startup -P herdr-app/harbor3d/models/sheet.py -- /path/sheet.png [width]

Each model is scaled to fit its cell (so the buoy and the lighthouse are both readable) and shown
from the front and above, lit from the upper left on a mid-blue background, name below.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index("--") + 1:]
OUT = argv[0]
W = int(argv[1]) if len(argv) > 1 else 1600
COLS = 5
names = sorted(f[:-4] for f in os.listdir(os.path.join(HERE, "out")) if f.endswith(".glb"))
rows = math.ceil(len(names) / COLS)
CELL = 3.0
ROW = 5.4
ELEV = math.radians(40)

sc = bpy.context.scene
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
for i, n in enumerate(names):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(HERE, "out", n + ".glb"))
    new = [o for o in bpy.data.objects if o not in before]
    top = [o for o in new if o.parent is None][0]
    pts = [o.matrix_world @ Vector(c) for o in new if o.type == "MESH" for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    k = (CELL * 0.8) / max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z)
    cx, cy = i % COLS, i // COLS
    top.scale = (k, k, k)
    top.rotation_mode = 'XYZ'
    top.rotation_euler = (0, 0, math.radians(-30))
    for o in new:
        if o.name.startswith('EyeLid'):
            o.scale = (0, 0, 0)
    top.location = (cx * CELL, -cy * ROW, (-lo.z * k) if n not in ("gull",) else 0)
    if n == "gull":
        top.location.z = 0.6
    t = bpy.data.curves.new("t" + n, "FONT")
    t.body = n
    t.size = 0.22
    t.align_x = "CENTER"
    to = bpy.data.objects.new("t" + n, t)
    sc.collection.objects.link(to)
    to.location = (cx * CELL, -cy * ROW - 1.5, 0.0)
    to.rotation_euler = (math.pi / 2 - ELEV, 0, 0)
    mat = bpy.data.materials.new("txt")
    mat.diffuse_color = (1, 1, 1, 1)
    t.materials.append(mat)

# blue ground-less backdrop, lit from the upper left
w = bpy.data.worlds.new("w")
w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.12, 0.3, 0.5, 1)
w.node_tree.nodes["Background"].inputs[1].default_value = 1.0
sc.world = w
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-35))
sc.collection.objects.link(sun)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
cam.data.type = "ORTHO"
cam.data.ortho_scale = COLS * CELL
sc.collection.objects.link(cam)
mid = Vector(((COLS - 1) * CELL / 2, -(rows - 1) * ROW / 2, 1.0))
tilt = math.pi / 2 - ELEV
cam.rotation_euler = (tilt, 0, 0)
cam.location = mid + Vector((0, -30 * math.sin(tilt), 30 * math.cos(tilt)))
sc.camera = cam
sc.render.resolution_x, sc.render.resolution_y = W, int(W * ((rows - 1) * ROW * math.sin(ELEV) + 4.0) / (COLS * CELL))
sc.render.filepath = OUT
sc.render.image_settings.file_format = "PNG"
sc.view_settings.view_transform = "Standard"
try:
    sc.eevee.taa_render_samples = 16
except Exception:
    pass
bpy.ops.render.render(write_still=True)
print("SHEET", OUT, os.path.getsize(OUT))
os._exit(0)
