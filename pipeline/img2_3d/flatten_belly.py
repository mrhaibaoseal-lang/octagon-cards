"""Blender: take base_body.py's old TORSO_FILL (stomach-pregnant 0.3, waist 0.35) back out of a body that was built with
it, in place, keeping its UVs and painted skin. For bodies made before --torso-fill became opt-in (2026-11-15); new bodies
need nothing. Keeps <blend>.pre_flat.blend.

  blender -b <private>/_model3d/<fighter>_painted/skinned.blend -P pipeline/img2_3d/flatten_belly.py
"""
import os
import shutil

import bpy
import bl_ext.blender_org.mpfb as mpfb
from bl_ext.blender_org.mpfb.services.targetservice import TargetService

TORSO_FILL = {"stomach/stomach-pregnant-incr": 0.3, "torso/measure-waist-circ-incr": 0.35}  # as in base_body.py

path = bpy.data.filepath
backup = os.path.splitext(path)[0] + ".pre_flat.blend"
if os.path.exists(backup):
    raise SystemExit(f"{backup} exists: this body is already flattened")
shutil.copy2(path, backup)
body = bpy.data.objects["Body"]
assert not body.data.shape_keys, "expected a body with its shape keys applied"
tdir = os.path.join(os.path.dirname(mpfb.__file__), "data", "targets")
for t, w in TORSO_FILL.items():
    body.shape_key_add(name="Basis")
    TargetService.load_target(body, os.path.join(tdir, t + ".target.gz"), weight=1.0)
    kb = body.data.shape_keys.key_blocks
    delta = [kb[-1].data[i].co - kb[0].data[i].co for i in range(len(kb[0].data))]
    body.shape_key_clear()
    for v, d in zip(body.data.vertices, delta):
        v.co -= d * w
    print(t, "max offset", round(max(d.length for d in delta) * w, 4))
body.data.update()
bpy.ops.wm.save_mainfile()
print("flattened", path, "backup", backup)
