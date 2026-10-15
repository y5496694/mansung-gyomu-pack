import io
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from sync import unpack


class PackTests(unittest.TestCase):
    def test_install_update_backup_and_local_settings(self):
        with tempfile.TemporaryDirectory(prefix="mansung-test-") as directory:
            sandbox = Path(directory)
            skills = sandbox / "skills"
            command = [sys.executable, str(ROOT / "scripts/install.py"),
                       "--skills-directory", str(skills)]
            subprocess.run(command, check=True, capture_output=True)
            self.assertEqual(len(list(skills.glob("*/SKILL.md"))), 6)
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
