#!/usr/bin/env python3
"""
Render the Adobe PDF inspired continuous trefoil ribbon vector SVG (`pdf-preview-sidenav.svg`,
`pdf-preview.svg`) to crisp multi-resolution transparent PNG assets (16px, 20px, 32px, 64px)
using 1024x1024 supersampling + LANCZOS downsampling.
"""

import io
import os
from PIL import Image, ImageDraw

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def render_svg_via_playwright(svg_content: str, size: int = 1024) -> Image.Image | None:
    try:
        from playwright.sync_api import sync_playwright

        html = (
            '<!doctype html><html><body style="margin:0;padding:0;background:transparent;'
            'width:100vw;height:100vh;overflow:hidden;">'
            f"{svg_content}"
            "</body></html>"
        )
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": size, "height": size}, device_scale_factor=1)
            page.set_content(html)
            page.eval_on_selector(
                "svg",
                f"(el) => {{ el.setAttribute('width', '{size}'); el.setAttribute('height', '{size}'); }}",
            )
            png_bytes = page.locator("svg").screenshot(omit_background=True)
            browser.close()
            return Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    except Exception:
        return None


def cubic_bezier(
    p0: tuple[float, float],
    p1: tuple[float, float],
    p2: tuple[float, float],
    p3: tuple[float, float],
    steps: int = 64,
) -> list[tuple[float, float]]:
    pts: list[tuple[float, float]] = []
    for i in range(steps + 1):
        t = i / steps
        mt = 1.0 - t
        x = (mt**3) * p0[0] + 3 * (mt**2) * t * p1[0] + 3 * mt * (t**2) * p2[0] + (t**3) * p3[0]
        y = (mt**3) * p0[1] + 3 * (mt**2) * t * p1[1] + 3 * mt * (t**2) * p2[1] + (t**3) * p3[1]
        pts.append((x, y))
    return pts


def lerp_color(c1: tuple[int, int, int, int], c2: tuple[int, int, int, int], t: float) -> tuple[int, int, int, int]:
    t = max(0.0, min(1.0, t))
    return (
        int(round(c1[0] + (c2[0] - c1[0]) * t)),
        int(round(c1[1] + (c2[1] - c1[1]) * t)),
        int(round(c1[2] + (c2[2] - c1[2]) * t)),
        int(round(c1[3] + (c2[3] - c1[3]) * t)),
    )


def render_adobe_trefoil_fallback(size: int = 1024) -> Image.Image:
    s = size / 128.0
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    segments = [
        ((61, 15), (54, 15), (51, 24), (54, 37)),
        ((54, 37), (57, 50), (66, 67), (79, 79)),
        ((79, 79), (91, 90), (104, 94), (110, 89)),
        ((110, 89), (116, 84), (113, 75), (101, 73)),
        ((101, 73), (87, 71), (66, 75), (46, 84)),
        ((46, 84), (27, 92), (14, 103), (17, 110)),
        ((17, 110), (20, 116), (31, 113), (43, 99)),
        ((43, 99), (56, 84), (66, 61), (69, 40)),
        ((69, 40), (72, 23), (68, 15), (61, 15)),
    ]

    all_pts: list[tuple[float, float]] = []
    for p0, p1, p2, p3 in segments:
        pts = cubic_bezier(
            (p0[0] * s, p0[1] * s),
            (p1[0] * s, p1[1] * s),
            (p2[0] * s, p2[1] * s),
            (p3[0] * s, p3[1] * s),
            steps=80,
        )
        all_pts.extend(pts)

    c_top = (255, 75, 75, 255)
    c_mid = (225, 29, 46, 255)
    c_bot = (185, 28, 28, 255)
    r = (11.5 * s) / 2.0

    for x, y in all_pts:
        t = max(0.0, min(1.0, ((x / s - 18.0) + (y / s - 14.0)) / 190.0))
        if t < 0.5:
            col = lerp_color(c_top, c_mid, t * 2.0)
        else:
            col = lerp_color(c_mid, c_bot, (t - 0.5) * 2.0)
        draw.ellipse([x - r, y - r, x + r, y + r], fill=col)

    return img


def generate() -> None:
    sidenav_svg_path = os.path.join(ROOT_DIR, "pdf-preview-sidenav.svg")
    with open(sidenav_svg_path, "r", encoding="utf-8") as f:
        svg_content = f.read()

    master = render_svg_via_playwright(svg_content, 1024)
    if master is None:
        master = render_adobe_trefoil_fallback(1024)

    targets = {
        "pdf-preview-16.png": 16,
        "pdf-preview-20.png": 20,
        "pdf-preview-32.png": 32,
        "pdf-preview-64.png": 64,
    }
    for filename, sz in targets.items():
        out_path = os.path.join(ROOT_DIR, filename)
        resized = master.resize((sz, sz), Image.Resampling.LANCZOS)
        resized.save(out_path, format="PNG", optimize=True)
        print(f"Generated {filename} ({sz}x{sz})")


if __name__ == "__main__":
    generate()
