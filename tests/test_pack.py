import io
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from sync import file_hashes, read_json, unpack
from routing import load_overrides, render_skill, skill_entries


class PackTests(unittest.TestCase):
    def test_install_update_backup_and_local_settings(self):
        with tempfile.TemporaryDirectory(prefix="mansung-test-") as directory:
            sandbox = Path(directory)
            skills = sandbox / "skills"
            command = [sys.executable, str(ROOT / "scripts/install.py"),
                       "--skills-directory", str(skills)]
            subprocess.run(command, check=True, capture_output=True)
            expected_names = {
                name for name, _, _ in skill_entries(read_json(ROOT / "pack.json"))
            }
            self.assertEqual({p.parent.name for p in skills.glob("*/SKILL.md")}, expected_names)
            self.assertTrue((skills / "narae-gyomu-ezedu/scripts/easyedu_schedule.py").is_file())
            self.assertTrue((skills / "narae-gyomu-hiclass/references/ui-workflows.md").is_file())
            self.assertTrue((skills / "narae-gyomu-classtime/scripts/timetable.py").is_file())
            self.assertTrue((skills / "narae-hangul/scripts/engine/hangeul/automation.py").is_file())
            self.assertTrue((skills / "narae-hangul-office/scripts/narae.py").is_file())
            runtime_files = [skills / name / "runtime.json" for name in
                             ("narae-hangul", "narae-hangul-office")]
            for runtime in runtime_files:
                runtime.write_bytes(b'{"runtime":"local-independent-setting"}\n')
            timetable_files = [skills / "narae-gyomu-classtime" / name for name in
                               ("sources.local.json", "mapping.local.json", "data/current.json")]
            for local in timetable_files:
                local.parent.mkdir(parents=True, exist_ok=True)
                local.write_bytes(b'{"local":"preserve"}\n')
            cli = skills / "cbe-messenger/scripts/cli.mjs"
            expected = cli.read_bytes()
            cli.write_bytes(b"local customized CLI\n")
            settings = skills / "narae-gyomu-work-portal/references/portal.json"
            settings.write_bytes(b'{"region":"local-test"}\n')
            extra = skills / "cbe-messenger/local-note.txt"
            extra.write_text("keep", encoding="utf-8")
            subprocess.run(command, check=True, capture_output=True)
            self.assertEqual(cli.read_bytes(), expected)
            backups = list((sandbox / "skill-backups").glob("*/cbe-messenger/scripts/cli.mjs"))
            self.assertEqual(len(backups), 1)
            self.assertEqual(backups[0].read_bytes(), b"local customized CLI\n")
            self.assertEqual(settings.read_bytes(), b'{"region":"local-test"}\n')
            self.assertEqual(extra.read_text(), "keep")
            for local in timetable_files:
                self.assertEqual(local.read_bytes(), b'{"local":"preserve"}\n')
            for runtime in runtime_files:
                self.assertEqual(runtime.read_bytes(), b'{"runtime":"local-independent-setting"}\n')
            subprocess.run(command, check=True, capture_output=True)
            self.assertEqual(len(list((sandbox / "skill-backups").iterdir())), 1)

    def test_routing_survives_reinstall_without_mutating_snapshots(self):
        before = file_hashes(ROOT / "packages")
        with tempfile.TemporaryDirectory(prefix="mansung-routing-") as directory:
            skills = Path(directory) / "skills"
            command = [sys.executable, str(ROOT / "scripts/install.py"),
                       "--skills-directory", str(skills)]
            subprocess.run(command, check=True, capture_output=True)
            root_skill = skills / "mansung-gyomu-pack/SKILL.md"
            self.assertEqual(root_skill.read_bytes(), (ROOT / "SKILL.md").read_bytes())
            self.assertTrue((root_skill.parent / "references/routing.md").is_file())
            self.assertTrue((root_skill.parent / "agents/openai.yaml").is_file())
            overrides = load_overrides()
            for name, folder, _ in skill_entries(read_json(ROOT / "pack.json")):
                if name not in overrides:
                    continue
                installed = skills / name / "SKILL.md"
                rendered = render_skill(name, (folder / "SKILL.md").read_bytes(), overrides)
                self.assertEqual(installed.read_bytes(), rendered)
                # The pack adds discovery guidance while retaining the entire
                # original workflow body and its support/approval constraints.
                original_body = (folder / "SKILL.md").read_text(encoding="utf-8-sig").split("---", 2)[2].lstrip("\n")
                self.assertTrue(installed.read_text(encoding="utf-8").endswith(original_body))
                self.assertTrue((installed.parent / "../mansung-gyomu-pack/SKILL.md").resolve().is_file())
            initial = file_hashes(skills)
            subprocess.run(command, check=True, capture_output=True)
            self.assertEqual(initial, file_hashes(skills))
            self.assertFalse((skills.parent / "skill-backups").exists())
        self.assertEqual(before, file_hashes(ROOT / "packages"))

    def test_overlay_rejects_unrecognized_frontmatter_without_overwriting(self):
        source = b'---\nname: narae-hangul\ndescription: >\n  Multiline description\n---\nOriginal workflow\n'
        with self.assertRaises(ValueError):
            render_skill("narae-hangul", source, load_overrides())

    def test_archive_cannot_write_outside_package(self):
        archive = io.BytesIO()
        with ZipFile(archive, "w") as zipped:
            zipped.writestr("repo-main/../outside.txt", "bad")
        with tempfile.TemporaryDirectory(prefix="mansung-test-") as directory:
            with self.assertRaises(ValueError):
                unpack(archive.getvalue(), Path(directory))


if __name__ == "__main__":
    unittest.main()
