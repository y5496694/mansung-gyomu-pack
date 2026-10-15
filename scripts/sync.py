"""Import public upstream snapshots without executing upstream code."""
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import tempfile
from urllib.request import Request, urlopen
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def file_hashes(folder):
    def digest(path):
        data = path.read_bytes()
        # Git attributes can convert text line endings on Windows checkout.
        try:
            data.decode("utf-8")
            if b"\x00" not in data:
                data = data.replace(b"\r\n", b"\n")
        except UnicodeDecodeError:
            pass
        return hashlib.sha256(data).hexdigest()

    return {
        p.relative_to(folder).as_posix(): digest(p)
        for p in sorted(folder.rglob("*")) if p.is_file()
    }


def download(url):
    headers = {"User-Agent": "mansung-pack-sync"}
    if url.startswith("https://api.github.com/") and os.environ.get("GITHUB_TOKEN"):
        headers["Authorization"] = "Bearer " + os.environ["GITHUB_TOKEN"]
    request = Request(url, headers=headers)
    with urlopen(request, timeout=90) as response:
        return response.read()


def unpack(data, destination):
    with ZipFile(io.BytesIO(data)) as archive:
        for item in archive.infolist():
            parts = PurePosixPath(item.filename).parts[1:]
            if not parts:
                continue
            if any(p in ("..", ".") or "\\" in p or ":" in p for p in parts):
                raise ValueError("Unsafe archive path")
            output = destination.joinpath(*parts)
            if not output.resolve().is_relative_to(destination.resolve()):
                raise ValueError("Archive path escapes destination")
            if (item.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError("Symlinks are not supported in the bundle")
            if item.is_dir():
                output.mkdir(parents=True, exist_ok=True)
            else:
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_bytes(archive.read(item))


def main():
    manifest = read_json(ROOT / "pack.json")
    lock_path = ROOT / "sources.lock.json"
    previous = read_json(lock_path) if lock_path.exists() else {}
    updated = {}
    changed = []
    packages = ROOT / "packages"
    packages.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="mansung-sync-") as temporary:
        staging = Path(temporary)
        for source in manifest["sources"]:
            name, repo, branch = source["id"], source["repository"], source["branch"]
            if not re.fullmatch(r"[A-Za-z0-9_-]+", name):
                raise ValueError("Invalid package id")
            if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
                raise ValueError("Invalid repository")
            target = packages / name
            if target.is_symlink() or target.resolve().parent != packages.resolve():
                raise ValueError("Package target escapes packages directory")
            from urllib.parse import quote
            commit = json.loads(download(
                f"https://api.github.com/repos/{repo}/commits/{quote(branch, safe='')}"
            ))["sha"]
            if (previous.get(name, {}).get("commit") == commit
                    and target.is_dir()
                    and file_hashes(target) == previous[name]["files"]):
                updated[name] = previous[name]
                print(f"Current: {repo} {commit[:12]}")
                continue
            snapshot = staging / name
            snapshot.mkdir()
            unpack(download(f"https://codeload.github.com/{repo}/zip/{commit}"), snapshot)
            for skill in source["skills"]:
                if not (snapshot / skill["path"] / "SKILL.md").is_file():
                    raise ValueError(f"Missing skill: {name}/{skill}")
            updated[name] = {
                "repository": repo, "branch": branch, "commit": commit,
                "url": f"https://github.com/{repo}/commit/{commit}",
                "files": file_hashes(snapshot),
            }
            changed.append((snapshot, target))
            print(f"Import: {repo} {commit[:12]}")
        # All downloads and required paths must pass before replacing any package.
        for snapshot, target in changed:
            if target.is_symlink() or target.resolve().parent != packages.resolve():
                raise ValueError("Invalid package replacement target")
            if target.exists():
                shutil.rmtree(target)
            shutil.copytree(snapshot, target)
        write_json(lock_path, updated)
    print(f"Synchronized {len(changed)} package(s).")


if __name__ == "__main__":
    main()
