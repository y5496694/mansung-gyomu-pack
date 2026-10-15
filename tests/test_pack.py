import io
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from sync import read_json, unpack


class PackTests(unittest.TestCase):
    def test_install_update_backup_and_local_settings(self):
        with tempfile.TemporaryDirectory(prefix="mansung-test-") as directory:
            sandbox = Path(directory)
            skills = sandbox / "skills"
            command = [sys.executable, str(ROOT / "scripts/install.py"),
                       "--skills-directory", str(skills)]
            subprocess.run(command, check=True, capture_output=True)
            expected_names = {
                entry["name"] for source in read_json(ROOT / "pack.json")["sources"]
                for entry in source["skills"]
            }
            self.assertEqual({p.parent.name for p in skills.glob("*/SKILL.md")}, expected_names)
            self.assertTrue((skills / "narae-gyomu-ezedu/scripts/easyedu_schedule.py").is_file())
            self.assertTrue((skills / "narae-gyomu-hiclass/references/ui-workflows.md").is_file())
            self.assertTrue((skills / "narae-gyomu-classtime/scripts/timetable.py").is_file())
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
            subprocess.run(command, check=True, capture_output=True)
            self.assertEqual(len(list((sandbox / "skill-backups").iterdir())), 1)

    def test_archive_cannot_write_outside_package(self):
        archive = io.BytesIO()
        with ZipFile(archive, "w") as zipped:
            zipped.writestr("repo-main/../outside.txt", "bad")
        with tempfile.TemporaryDirectory(prefix="mansung-test-") as directory:
            with self.assertRaises(ValueError):
                unpack(archive.getvalue(), Path(directory))


if __name__ == "__main__":
    unittest.main()
