"""Stand-in for xformers.ops used by TRELLIS.2's (sparse) attention, built on torch's scaled_dot_product_attention.
There is no flash-attn / xformers wheel for torch 2.7 + sm_120 on Windows here, and TRELLIS.2's sparse attention only
knows those two. Variable-length segments (BlockDiagonalMask) are grouped by length and run as batches.
Install with `fake_xformers.install()` before importing trellis2, and set ATTN_BACKEND=xformers."""
import sys
import types
from collections import defaultdict

import torch
import torch.nn.functional as F


class BlockDiagonalMask:
    def __init__(self, q_seqlen, kv_seqlen):
        self.q_seqlen, self.kv_seqlen = list(q_seqlen), list(kv_seqlen)

    @classmethod
    def from_seqlens(cls, q_seqlen, kv_seqlen=None):
        return cls(q_seqlen, kv_seqlen if kv_seqlen is not None else q_seqlen)


def memory_efficient_attention(q, k, v, attn_bias=None, **_):
    """q/k/v: [B, L, H, C] -> [B, L, H, C]. With a BlockDiagonalMask, B == 1 and L is the packed length."""
    if attn_bias is None:
        return F.scaled_dot_product_attention(q.transpose(1, 2), k.transpose(1, 2), v.transpose(1, 2)).transpose(1, 2)
    q, k, v = q[0], k[0], v[0]  # [T, H, C]
    out = torch.empty(q.shape[0], q.shape[1], v.shape[2], dtype=q.dtype, device=q.device)
    qs = [0]
    ks = [0]
    for a, b in zip(attn_bias.q_seqlen, attn_bias.kv_seqlen):
        qs.append(qs[-1] + a)
        ks.append(ks[-1] + b)
    groups = defaultdict(list)
    for i, (a, b) in enumerate(zip(attn_bias.q_seqlen, attn_bias.kv_seqlen)):
        groups[(a, b)].append(i)
    for (a, b), idx in groups.items():
        for chunk in range(0, len(idx), 256):
            sel = idx[chunk:chunk + 256]
            qq = torch.stack([q[qs[i]:qs[i] + a] for i in sel]).transpose(1, 2)
            kk = torch.stack([k[ks[i]:ks[i] + b] for i in sel]).transpose(1, 2)
            vv = torch.stack([v[ks[i]:ks[i] + b] for i in sel]).transpose(1, 2)
            o = F.scaled_dot_product_attention(qq, kk, vv).transpose(1, 2)
            for j, i in enumerate(sel):
                out[qs[i]:qs[i] + a] = o[j]
    return out.unsqueeze(0)


def install():
    ops = types.ModuleType("xformers.ops")
    ops.memory_efficient_attention = memory_efficient_attention
    ops.fmha = types.SimpleNamespace(BlockDiagonalMask=BlockDiagonalMask)
    pkg = types.ModuleType("xformers")
    pkg.ops = ops
    sys.modules["xformers"] = pkg
    sys.modules["xformers.ops"] = ops
