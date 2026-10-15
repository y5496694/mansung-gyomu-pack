"""Install code while preserving local source links, mappings and data."""
import argparse
from datetime import datetime
import os
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
FILES = ("SKILL.md", "README.md", ".gitignore", "sources.example.json", "시간표 열기.cmd", "install.ps1")
DIRECTORIES = ("scripts", "assets", "agents", "references")


def install(skills_directory):
    skills_directory = Path(skills_directory).resolve()
    target = skills_directory / "narae-gyomu-classtime"
    if target.is_symlink() or target.resolve().parent != skills_directory:
        raise ValueError("잘못된 스킬 설치 경로입니다.")
    if target.resolve() == ROOT:
        return target
    backup = skills_directory.parent / "skill-backups" / ("classtime-" + datetime.now().strftime("%Y%m%d-%H%M%S-%f"))
    sources = [ROOT / name for name in FILES]
    sources += [p for folder in DIRECTORIES for p in (ROOT / folder).rglob("*")
                if p.is_file() and "__pycache__" not in p.parts and p.suffix != ".pyc"]
    for source in sources:
        rel = source.relative_to(ROOT)
        dest = target / rel
        if not dest.resolve().is_relative_to(target.resolve()):
            raise ValueError("설치 경로가 스킬 폴더를 벗어납니다.")
        if dest.exists():
            if dest.read_bytes() == source.read_bytes():
                continue
            saved = backup / rel
            saved.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(dest, saved)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, dest)
    print(f"Installed: {target}")
    if backup.exists():
        print(f"Backup: {backup}")
    return target


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    codex_path = Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex")
    parser.add_argument("--skills-directory", type=Path, default=codex_path / "skills")
    args = parser.parse_args()
    install(args.skills_directory)
