"""TripoSR baseline: one mesh per input, with time and VRAM recorded.

  set HF_HOME=D:/img2_3d/hf
  D:/img2_3d/venv/Scripts/python.exe pipeline/img2_3d/run_triposr.py --src D:/img2_3d/src/TripoSR

torchmcubes needs a CUDA compiler this machine does not have, and rembg would download another model: both are
replaced by small stand-ins before TripoSR is imported (inputs are already cut out by common.prepared).
"""
import argparse
import sys
import types

import numpy as np
import torch

sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent))
from common import OUT, Recorder, prepared  # noqa: E402


def fake_modules():
    import mcubes

    def marching_cubes(vol, iso):
        v, f = mcubes.marching_cubes(vol.cpu().numpy(), iso)
        return torch.from_numpy(v[:, ::-1].copy()).float(), torch.from_numpy(f.astype(np.int64))

    sys.modules["torchmcubes"] = types.SimpleNamespace(marching_cubes=marching_cubes)
    sys.modules["rembg"] = types.SimpleNamespace(new_session=lambda *a, **k: None, remove=lambda img, **k: img)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="TripoSR source checkout")
    ap.add_argument("--old-transformers", default="D:/img2_3d/tf_old", help="pip --target dir with transformers==4.46.3")
    ap.add_argument("--inputs", default="photo,gemini_cartoon,gemini_real")
    ap.add_argument("--resolution", type=int, default=256)
    ap.add_argument("--smooth", type=int, default=0, help="Taubin smoothing iterations (0 = off)")
    ap.add_argument("--tag", default="", help="suffix for output names and the results log")
    args = ap.parse_args()
    fake_modules()
    # transformers 5 renamed the ViT weights TripoSR's checkpoint uses: load an old copy kept beside the venv.
    sys.path.insert(0, args.old_transformers)
    sys.path.insert(0, args.src)
    from PIL import Image
    from tsr.system import TSR

    dst = OUT / "triposr"
    dst.mkdir(parents=True, exist_ok=True)
    for name in args.inputs.split(","):
        img = Image.open(prepared(name)).resize((512, 512), Image.LANCZOS)
        a = np.asarray(img).astype(np.float32) / 255.0
        rgb = a[:, :, :3] * a[:, :, 3:4] + (1 - a[:, :, 3:4]) * 0.5
        torch.cuda.empty_cache()
        torch.cuda.reset_peak_memory_stats()
        with Recorder("TripoSR", name + args.tag) as rec:
            try:
                model = TSR.from_pretrained("stabilityai/TripoSR", config_name="config.yaml", weight_name="model.ckpt")
                model.renderer.set_chunk_size(8192)
                model.to("cuda")
                with torch.no_grad():
                    codes = model([Image.fromarray((rgb * 255).astype(np.uint8))], device="cuda")
                    mesh = model.extract_mesh(codes, True, resolution=args.resolution)[0]
                if args.smooth:
                    import trimesh
                    trimesh.smoothing.filter_taubin(mesh, iterations=args.smooth)
                mesh.export(dst / f"{name}{args.tag}.glb")
                rec.done(True, f"{len(mesh.vertices)} verts, vertex colours",
                         torch_peak_mb=torch.cuda.max_memory_reserved() // 2**20)
            except Exception as e:  # record the failure and go on with the next input
                rec.done(False, repr(e)[:300])
            finally:
                model = None


if __name__ == "__main__":
    main()
