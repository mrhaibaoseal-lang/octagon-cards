"""TRELLIS.2 (official code + visualbruno's prebuilt Windows wheels), 512 pipeline in low-VRAM mode, one textured GLB
per input with time and VRAM recorded.

  set HF_HOME=D:/img2_3d/hf
  D:/img2_3d/venv/Scripts/python.exe pipeline/img2_3d/run_trellis2.py --src D:/img2_3d/src/TRELLIS.2

Inputs are already cut out (alpha), so the gated BiRefNet / RMBG-2.0 background remover is replaced by a stub and never
downloaded. Needs the gated facebook/dinov3-vitl16-pretrain-lvd1689m (user accepts Meta's terms and logs in).
"""
import argparse
import os
import sys

os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
os.environ.setdefault("ATTN_BACKEND", "xformers")  # served by fake_xformers (torch sdpa)

sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent))
from common import OUT, Recorder, prepared  # noqa: E402
import fake_xformers  # noqa: E402

fake_xformers.install()


class NoRembg:
    def __init__(self, *a, **k):
        pass

    def to(self, *a, **k):
        return self

    cpu = cuda = to

    def __call__(self, img):
        raise RuntimeError("inputs must already have alpha")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="TRELLIS.2 source checkout")
    ap.add_argument("--inputs", default="photo,gemini_real,gemini_cartoon")
    ap.add_argument("--pipeline", default="512")
    args = ap.parse_args()
    sys.path.insert(0, args.src)
    import torch
    from PIL import Image
    from trellis2.pipelines import rembg

    rembg.BiRefNet = NoRembg
    import o_voxel
    from trellis2.pipelines import Trellis2ImageTo3DPipeline

    # Only the 512 weights were downloaded: do not load the 1024 flow models.
    Trellis2ImageTo3DPipeline.model_names_to_load = [
        n for n in Trellis2ImageTo3DPipeline.model_names_to_load if not n.endswith("_1024") or args.pipeline != "512"]

    dst = OUT / "trellis2"
    dst.mkdir(parents=True, exist_ok=True)
    pipe = None
    for name in args.inputs.split(","):
        torch.cuda.empty_cache()
        torch.cuda.reset_peak_memory_stats()
        with Recorder("TRELLIS.2", name) as rec:
            try:
                if pipe is None:
                    pipe = Trellis2ImageTo3DPipeline.from_pretrained("microsoft/TRELLIS.2-4B")
                    pipe.low_vram = True
                    dino = pipe.image_cond_model.model
                    if not hasattr(dino, "layer"):  # transformers 5 moved the blocks to model.model.layer
                        dino.layer = dino.model.layer
                    pipe.cuda()
                mesh = pipe.run(Image.open(prepared(name)), pipeline_type=args.pipeline)[0]
                mesh.simplify(16777216)
                glb = o_voxel.postprocess.to_glb(
                    vertices=mesh.vertices, faces=mesh.faces, attr_volume=mesh.attrs, coords=mesh.coords,
                    attr_layout=mesh.layout, voxel_size=mesh.voxel_size, aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]],
                    decimation_target=200000, texture_size=2048, remesh=True, remesh_band=1, remesh_project=0)
                glb.export(dst / f"{name}.glb")
                rec.done(True, f"{len(glb.vertices)} verts, PBR texture, pipeline {args.pipeline}",
                         torch_peak_mb=torch.cuda.max_memory_reserved() // 2**20)
            except Exception as e:
                rec.done(False, repr(e)[:400], torch_peak_mb=torch.cuda.max_memory_reserved() // 2**20)
                import traceback
                traceback.print_exc()


if __name__ == "__main__":
    main()
