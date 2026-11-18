"""Builds every Harbor 3D model (or those named after `--`) into out/<name>.glb.

    blender -b --factory-startup -P herdr-app/harbor3d/models/build.py [-- octopus crab]

Prints triangles, object names and file size per model; exits 1 if a budget or a part is missing.
"""
import importlib
import os
import sys

from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "parts"))
import lib  # noqa: E402

# name: (max tris, required child names, max materials)
SPEC = {
    "octopus": (900, ["Body"] + [f"Tentacle.{i}" for i in range(8)] + ["EyeLid.L", "EyeLid.R"]),
    "crab": (500, ["Body", "Claw.L", "Claw.R", "Legs"]),
    "buoy": (150, ["Body", "Float"]),
    "flag": (40, ["Flag"]),
    "gull": (200, ["Body", "Wing.L", "Wing.R"]),
    "driftwood": (150, ["Body"]),
    "ship": (1000, ["Body", "Funnel", "Mast", "Lights"]),
    "container": (60, ["Body"]),
    "crane": (500, ["Body", "Trolley", "Hook"]),
    "pier": (500, ["Body"]),
    "quay": (300, ["Body"]),
    "signal": (200, ["Body", "Red", "Amber", "Green"]),
    "tug": (700, ["Body", "Captain", "Light"]),
    "captain": (400, ["Body", "arm"]),
    "office": (500, ["Body", "Radar", "Windows"]),
    "warehouse": (150, ["Body"]),
    "silo": (250, ["Body"]),
    "floodlight": (120, ["Body", "Lamp"]),
    "marker": (120, ["Body", "Daymark", "Lamp"]),
    "rock": (60, ["Body"]),
}
# `signal` would shadow the stdlib module, so its part file has another name.
MODULE = {"signal": "signal_mast"}
MAX_FILE, MAX_ALL, MAX_MATS = 100_000, 700_000, 5


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    names = argv or list(SPEC)
    os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
    rows, bad, total = [], [], 0
    for name in names:
        lib.clear()
        rt = importlib.import_module(MODULE.get(name, name)).build()
        rt.name = name
        kids = lib.family(rt)
        path = os.path.join(HERE, "out", name + ".glb")
        lib.export(rt, path)
        tris = lib.tri_count(kids)
        size = os.path.getsize(path)
        total += size
        mats = {s.material.name for o in kids if o.type == "MESH" for s in o.material_slots}
        have = {o.name for o in kids}
        max_t, need = SPEC[name]
        for n in need:
            if n not in have:
                bad.append(f"{name}: missing part {n}")
        if tris > max_t:
            bad.append(f"{name}: {tris} tris > {max_t}")
        if size > MAX_FILE:
            bad.append(f"{name}: {size} bytes > {MAX_FILE}")
        if len(mats) > MAX_MATS:
            bad.append(f"{name}: {len(mats)} materials > {MAX_MATS}")
        pts = [o.matrix_world @ Vector(c) for o in kids if o.type == "MESH" for c in o.bound_box]
        dim = "x".join(f"{max(p[i] for p in pts) - min(p[i] for p in pts):.2f}" for i in range(3))
        zr = f"{min(p.z for p in pts):.2f}..{max(p.z for p in pts):.2f}"
        rows.append((name, tris, max_t, size, len(mats), dim, zr, sorted(have - {name})))
    print("\n| model | tris | budget | bytes | mats | size m (x y z) | z range | objects |\n| --- | --- | --- | --- | --- | --- | --- | --- |")
    for n, t, m, s, k, d, z, o in rows:
        print(f"| {n} | {t} | {m} | {s} | {k} | {d} | {z} | {', '.join(o)} |")
    if not argv:
        print(f"\ntotal bytes: {total} (limit {MAX_ALL})")
        if total > MAX_ALL:
            bad.append(f"total {total} > {MAX_ALL}")
    for b in bad:
        print("FAIL", b)
    sys.stdout.flush()
    os._exit(1 if bad else 0)


main()
