"""Synthetic visual fixtures only; no school or personal data."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
font = ImageFont.truetype("C:/Windows/Fonts/malgun.ttf", 44)
cases = [
    {"file": "가상과학.png", "title": "가상 과학 체험 안내", "venue": "은하체험관", "cost": "286,000원", "start": "10:10", "end": "12:30"},
    {"file": "가상미술.png", "title": "가상 미술 체험 안내", "venue": "노을미술관", "cost": "93,000원", "start": "13:40", "end": "15:10"},
]
for case in cases:
    im = Image.new("RGB", (1100, 570), "white")
    draw = ImageDraw.Draw(im)
    lines = [case["title"], "장소: " + case["venue"], "비용: " + case["cost"], "시작: " + case["start"], "종료: " + case["end"], "훈련용 가상 자료입니다."]
    for i, line in enumerate(lines):
        draw.text((44, 30 + i * 86), line, font=font, fill="black")
    im.save(out / case["file"])
(out / "expected.json").write_text(json.dumps(cases, ensure_ascii=False, indent=2), encoding="utf-8")
