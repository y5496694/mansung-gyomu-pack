"""Check bundled files and installable skill paths against the lock file."""
import re
from sync import ROOT, file_hashes, read_json
from routing import load_overrides, render_skill, skill_entries, skill_files


def main():
    manifest = read_json(ROOT / "pack.json")
    lock = read_json(ROOT / "sources.lock.json")
    names = set()
    for source in manifest["sources"]:
        folder = ROOT / "packages" / source["id"]
        record = lock[source["id"]]
        assert record["repository"] == source["repository"], "Repository mismatch"
        assert record["branch"] == source["branch"], "Branch mismatch"
        assert file_hashes(folder) == record["files"], f"Changed snapshot: {folder.name}"
        for entry in source["skills"]:
            skill = folder / entry["path"]
            name = entry["name"]
            assert skill.resolve().is_relative_to(folder.resolve()), "Skill path escapes package"
            assert (skill / "SKILL.md").is_file(), f"Missing skill: {entry['path']}"
            assert re.fullmatch(r"[A-Za-z0-9_-]+", name), "Invalid install name"
    overrides = load_overrides()
    upstream_names = {entry["name"] for source in manifest["sources"] for entry in source["skills"]}
    assert set(overrides) == upstream_names, "Routing must cover every upstream skill"
    for name, folder, selected in skill_entries(manifest):
        assert re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name), "Invalid skill name"
        assert name not in names, f"Duplicate skill: {name}"
        names.add(name)
        assert folder.resolve().is_relative_to(ROOT), "Local skill path escapes repository"
        paths = list(skill_files(folder, selected))
        assert folder / "SKILL.md" in paths, f"Missing SKILL.md: {name}"
        for path in paths:
            assert path.resolve().is_relative_to(folder.resolve()), "File escapes skill folder"
            assert path.is_file(), f"Missing skill file: {path}"
        data = render_skill(name, (folder / "SKILL.md").read_bytes(), overrides)
        text = data.decode("utf-8-sig")
        assert re.search(r"^name: " + re.escape(name) + r"\r?$", text, re.M), "Skill name mismatch"
        assert len(data) <= 1024 * 1024, "Skill file too large"
    assert "mansung-gyomu-pack" in names, "Required pack entry skill is missing"
    print(f"Validated {len(lock)} packages and {len(names)} skills (including required pack routing).")


if __name__ == "__main__":
    main()
