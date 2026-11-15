"""(seal_head.py last step) Original head faces above ymax - overlap (eyes untouched), sealed faces below ymax.

  python merge_heads.py orig.glb sealed_lower.glb out.glb -0.04 0.004
"""
import sys, numpy as np, trimesh
orig, sealed, dst, ymax, ov = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4]), float(sys.argv[5])
o = next(iter(trimesh.load(orig, process=False).geometry.values()))
s = trimesh.load(sealed, process=False, force="scene").to_geometry()
ko = o.vertices[o.faces].mean(1)[:, 1] > ymax - ov
ks = s.vertices[s.faces].mean(1)[:, 1] < ymax
a = trimesh.Trimesh(o.vertices, o.faces[ko], process=False); a.remove_unreferenced_vertices()
b = trimesh.Trimesh(s.vertices, s.faces[ks], process=False); b.remove_unreferenced_vertices()
m = trimesh.util.concatenate([a, b])
print("orig faces", len(a.faces), "sealed faces", len(b.faces))
m.export(dst); print("saved", dst)
