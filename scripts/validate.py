"""Check bundled files and installable skill paths against the lock file."""
import re
from sync import ROOT, file_hashes, read_json


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
            assert name not in names, f"Duplicate skill: {name}"
            names.add(name)
    print(f"Validated {len(lock)} packages and {len(names)} skills.")


if __name__ == "__main__":
    main()
