"""Apply pack-owned discovery rules without changing upstream snapshots."""
import json
import re

from sync import ROOT, read_json


def skill_entries(manifest):
    """Yield (name, source folder, selected relative files or None)."""
    for entry in manifest.get("local_skills", []):
        yield entry["name"], ROOT / entry["path"], entry["files"]
    for source in manifest["sources"]:
        for entry in source["skills"]:
            yield entry["name"], ROOT / "packages" / source["id"] / entry["path"], None


def skill_files(folder, selected):
    if selected is None:
        return (p for p in sorted(folder.rglob("*")) if p.is_file())
    return (folder / path for path in selected)


def render_skill(name, data, overrides):
    """Retain upstream body and optional metadata; replace only description."""
    if name not in overrides:
        return data
    source = data.decode("utf-8-sig").replace("\r\n", "\n")
    match = re.match(r"\A---\n(.*?)\n---\n", source, re.S)
    if not match:
        raise ValueError(f"Missing skill frontmatter: {name}")
    header = match.group(1)
    # The imported skills currently use one-line scalar descriptions. Reject a
    # future multiline format instead of silently damaging its YAML.
    description = re.search(r"^description: ([^\n]+)$", header, re.M)
    if not description or description.group(1).strip() in {"|", ">", "|-", ">-", "|+", ">+"}:
        raise ValueError(f"Unsupported description format: {name}")
    replacement = "description: " + json.dumps(overrides[name]["description"], ensure_ascii=False)
    header = header[:description.start()] + replacement + header[description.end():]
    preamble = (
        "\n## 만승 교무팩 필독·업무 분류\n\n"
        "작업 전에 같은 skills 폴더의 [만승 교무팩 필독](../mansung-gyomu-pack/SKILL.md)을 반드시 읽는다. "
        "현재 작업에서 이미 읽었다면 반복하지 않는다.\n\n"
        + overrides[name]["instruction"] + "\n\n"
    )
    return ("---\n" + header + "\n---\n" + preamble + source[match.end():]).encode("utf-8")


def load_overrides():
    return read_json(ROOT / "routing" / "skill-overrides.json")
