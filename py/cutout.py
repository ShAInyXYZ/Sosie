#!/usr/bin/env python3
"""Cut a person out of a photo (BiRefNet-general, MIT) and, optionally, place them over a generated set.
The person's pixels are never regenerated: only the background changes.

    py/.venv/bin/python py/cutout.py <request.json>

request.json: {
  "image": "<photo>", "modelDir": "<store>/RMBG/BiRefNet", "weights": "BiRefNet-general.safetensors",
  "outCutout": "<rgba.png>",
  "set": "<set image, optional>", "outComposite": "<key frame png, optional>", "size": [1024, 1024],
  "headroom": 0.06, "personHeight": 0.92
}
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


def load_model(model_dir: str, weights: str):
    import torch
    from safetensors.torch import load_file
    sys.path.insert(0, model_dir)
    from BiRefNet_config import BiRefNetConfig  # noqa: E402  (the store's own model code)
    from birefnet import BiRefNet  # noqa: E402
    model = BiRefNet(config=BiRefNetConfig(bb_pretrained=False))
    model.load_state_dict(load_file(str(Path(model_dir) / weights)), strict=False)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    return model.eval().to(device).half() if device == "cuda" else model.eval(), device


def matte(image: Image.Image, model, device: str) -> Image.Image:
    import torch
    rgb = image.convert("RGB")
    x = np.asarray(rgb.resize((1024, 1024), Image.BILINEAR), dtype=np.float32) / 255.0
    x = (x - np.array([0.485, 0.456, 0.406])) / np.array([0.229, 0.224, 0.225])
    tensor = torch.from_numpy(x.transpose(2, 0, 1)).unsqueeze(0).to(device)
    tensor = tensor.half() if device == "cuda" else tensor.float()
    with torch.no_grad():
        pred = model(tensor)[-1].sigmoid().float().cpu().numpy()[0, 0]
    mask = Image.fromarray((pred * 255).clip(0, 255).astype(np.uint8)).resize(rgb.size, Image.BILINEAR)
    return mask


def composite(person: Image.Image, mask: Image.Image, background: Image.Image, size: tuple[int, int], person_height: float, headroom: float) -> Image.Image:
    """Bottom-aligned, centred, chest-up: the person's visible height fills `person_height` of the frame."""
    w, h = size
    bg = background.convert("RGB")
    scale = max(w / bg.width, h / bg.height)
    bg = bg.resize((round(bg.width * scale), round(bg.height * scale)), Image.LANCZOS)
    left, top = (bg.width - w) // 2, (bg.height - h) // 2
    bg = bg.crop((left, top, left + w, top + h))

    box = mask.getbbox() or (0, 0, person.width, person.height)
    crop = person.convert("RGB").crop(box)
    alpha = mask.crop(box)
    target_h = round(h * person_height)
    s = target_h / crop.height
    crop = crop.resize((max(1, round(crop.width * s)), target_h), Image.LANCZOS)
    alpha = alpha.resize(crop.size, Image.LANCZOS).filter(ImageFilter.GaussianBlur(1.2))  # soft edge
    x = (w - crop.width) // 2
    y = max(round(h * headroom), h - crop.height)
    out = bg.copy()
    out.paste(crop, (x, y), alpha)
    return out


def run(req: dict) -> dict:
    model, device = load_model(req["modelDir"], req.get("weights", "BiRefNet-general.safetensors"))
    image = Image.open(req["image"])
    mask = matte(image, model, device)
    rgba = image.convert("RGB").copy()
    rgba.putalpha(mask)
    rgba.save(req["outCutout"])
    result = {"cutout": req["outCutout"], "coverage": round(float(np.asarray(mask).mean() / 255), 3)}
    if req.get("set") and req.get("outComposite"):
        size = tuple(req.get("size", [1024, 1024]))
        out = composite(image, mask, Image.open(req["set"]), size, req.get("personHeight", 0.92), req.get("headroom", 0.06))
        out.save(req["outComposite"])
        result["composite"] = req["outComposite"]
    return result


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    print(json.dumps(run(json.loads(Path(sys.argv[1]).read_text()))))
