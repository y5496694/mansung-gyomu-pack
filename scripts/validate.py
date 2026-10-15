"""Check bundled files and installable skill paths against the lock file."""
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
        for path in source["skills"]:
            skill = folder / path
            assert skill.is_relative_to(folder), "Skill path escapes package"
            assert (skill / "SKILL.md").is_file(), f"Missing skill: {path}"
            assert skill.name not in names, f"Duplicate skill: {skill.name}"
            names.add(skill.name)
    print(f"Validated {len(lock)} packages and {len(names)} skills.")


if __name__ == "__main__":
    main()
