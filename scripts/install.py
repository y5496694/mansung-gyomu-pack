"""Install bundled skills, backing up replaced files and keeping local settings."""
import argparse
from datetime import datetime
import os
from pathlib import Path
import shutil
from sync import ROOT, read_json
from validate import main as validate


def install(skills_directory):
    validate()
    skills_directory = skills_directory.resolve()
    backup = skills_directory.parent / "skill-backups" / ("mansung-" + datetime.now().strftime("%Y%m%d-%H%M%S-%f"))
    copied = kept = 0
    for source in read_json(ROOT / "pack.json")["sources"]:
        for entry in source["skills"]:
            skill = ROOT / "packages" / source["id"] / entry["path"]
            name = entry["name"]
            target = skills_directory / name
            if target.is_symlink() or target.resolve().parent != skills_directory:
                raise ValueError(f"Invalid skill target: {target}")
            for original in skill.rglob("*"):
                if not original.is_file():
                    continue
                relative = original.relative_to(skill)
                output = target / relative
                if not output.resolve().is_relative_to(skills_directory):
                    raise ValueError("Install path escapes skills directory")
                if output.exists():
                    if relative.as_posix() == "references/portal.json":
                        kept += 1
                        continue
                    if output.read_bytes() == original.read_bytes():
                        continue
                    saved = backup / name / relative
                    saved.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(output, saved)
                output.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(original, output)
                copied += 1
            print(f"Installed: {name}")
    print(f"Copied {copied} files; preserved {kept} local portal setting(s).")
    if backup.exists():
        print(f"Backup: {backup}")
    print("Restart the chat to discover newly installed skills.")


def main():
    parser = argparse.ArgumentParser()
    default_home = Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex")
    parser.add_argument("--skills-directory", type=Path, default=default_home / "skills")
    args = parser.parse_args()
    install(args.skills_directory)


if __name__ == "__main__":
    main()
