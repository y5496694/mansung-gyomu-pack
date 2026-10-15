import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("timetable", ROOT / "scripts/timetable.py")
t = importlib.util.module_from_spec(spec)
spec.loader.exec_module(t)


def fixture():
    # A different school: 7th grade only, two named classes, weekdays across columns, eight periods down rows.
    sheet = {"name": "2026 2학기", "hidden": False, "merges": ["B1:F1"], "formulas": {},
             "cells": {"B1": "7학년", "A2": "가반", "G2": "나반"}}
    days = ["월", "화", "수", "목", "금"]
    classes = []
    for name, offset, anchor in [("가", 2, "A2"), ("나", 8, "G2")]:
        refs = {day: [t.address(p + 2, col + offset) for p in range(1, 9)] for col, day in enumerate(days)}
        for values in refs.values():
            for a1 in values:
                sheet["cells"][a1] = "국어"
        classes.append({"grade": "7", "class": name, "sheet": sheet["name"], "anchors": [
            {"cell": "D1", "value": "7학년"}, {"cell": anchor, "value": name + "반"}], "days": refs})
    sheet["cells"]["B10"] = "영어(어학실)"
    snapshot = {"title": "2026 시간표", "source_key": "test", "source_hash": "test-hash",
                "fetched_at": "2026-10-15T12:00:00+09:00", "sheets": [sheet]}
    plan = {"academic_year": 2026, "semester": 2, "selection_reason": "원본 표제와 탭 확인",
            "term_evidence": [{"sheet": "@workbook", "cell": "@title", "value": snapshot["title"]},
                              {"sheet": sheet["name"], "cell": "@name", "value": sheet["name"]}],
            "weekdays": days, "periods": list(range(1, 9)), "classes": classes,
            "coverage": {"reviewed_all_sheets": True, "class_keys": [["7", "가"], ["7", "나"]],
                         "notes": "전체 헤더에서 7학년 가·나 두 반 확인"}}
    return snapshot, plan


class TimetableTests(unittest.TestCase):
    def test_term_boundaries(self):
        for date, expected in [("2026-01-01", (2025, 2)), ("2026-01-31", (2025, 2)),
                               ("2026-02-01", (2026, 1)), ("2026-03-01", (2026, 1)),
                               ("2026-07-31", (2026, 1)), ("2026-08-01", (2026, 2)),
                               ("2026-12-31", (2026, 2)), ("2027-01-31", (2026, 2)),
                               ("2027-02-01", (2027, 1))]:
            with self.subTest(date=date):
                term = t.term_for(date)
                self.assertEqual((term["academic_year"], term["semester"]), expected)

    def test_transposed_eight_periods_and_named_classes(self):
        snapshot, plan = fixture()
        data = t.build(snapshot, plan, "시험학교")
        self.assertEqual(len(data["classes"]), 2)
        eighth = data["classes"][0]["days"]["월"][7]
        self.assertEqual((eighth["period"], eighth["raw"], eighth["subject"], eighth["detail"]),
                         (8, "영어(어학실)", "영어", "어학실"))
        self.assertEqual(eighth["source"]["cell"], "B10")

    def test_raw_whitespace_preserved_but_display_trimmed(self):
        snapshot, plan = fixture()
        snapshot["sheets"][0]["cells"]["B3"] = "  사회  "
        slot = t.build(snapshot, plan, "시험학교")["classes"][0]["days"]["월"][0]
        self.assertEqual(slot["raw"], "  사회  ")
        self.assertEqual(slot["subject"], "사회")

    def test_blanks_are_not_inferred_as_no_class(self):
        snapshot, plan = fixture()
        del snapshot["sheets"][0]["cells"]["B3"]
        plan["classes"][0]["days"]["월"][1] = None
        values = t.build(snapshot, plan, "시험학교")["classes"][0]["days"]["월"]
        self.assertEqual(values[0]["status"], "blank")
        self.assertEqual(values[1]["status"], "unmapped")
        self.assertEqual(values[0]["raw"], "")

    def test_subject_updates_do_not_require_remapping_but_new_classes_do(self):
        snapshot, plan = fixture()
        original = t.skeleton(snapshot, plan)
        snapshot["sheets"][0]["cells"]["B3"] = "수학"
        self.assertEqual(t.skeleton(snapshot, plan), original)
        del snapshot["sheets"][0]["cells"]["B3"]
        self.assertEqual(t.skeleton(snapshot, plan), original)
        snapshot["sheets"][0]["cells"]["N2"] = "다반"
        self.assertNotEqual(t.skeleton(snapshot, plan), original)

    def test_incomplete_coverage_and_changed_headers_fail(self):
        snapshot, plan = fixture()
        plan["classes"].pop()
        with self.assertRaises(ValueError):
            t.validate_plan(snapshot, plan)
        snapshot, plan = fixture()
        snapshot["sheets"][0]["cells"]["A2"] = "다반"
        with self.assertRaises(t.NeedsReview):
            t.validate_plan(snapshot, plan)

    def test_formula_without_cached_value_fails(self):
        snapshot, plan = fixture()
        snapshot["sheets"][0]["formulas"]["B3"] = {"formula": "SUM(A1:A2)", "cached": False, "error": False}
        with self.assertRaises(t.NeedsReview):
            t.validate_plan(snapshot, plan)

    def test_refresh_updates_json_and_html_and_failure_preserves_last_success(self):
        snapshot, plan = fixture()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "assets").mkdir()
            (root / "assets/viewer.html").write_bytes((ROOT / "assets/viewer.html").read_bytes())
            t.write_json(root / "sources.local.json", {"school_name": "시험학교"})
            t.write_json(root / "data/source.snapshot.json", snapshot)
            t.write_json(root / "data/candidate.json", {"snapshot_hash": snapshot["source_hash"], "plans": [plan]})
            t.accept(root, root / "data/candidate.json")
            with patch.object(t, "download", return_value=snapshot):
                t.refresh(root, "2026-10-15")
                snapshot["sheets"][0]["cells"]["B3"] = "바뀐 과목"
                answer = t.query(root, "2026-10-15", "7", "가", "월", 1)
                self.assertEqual(answer["matches"][0]["raw"], "바뀐 과목")
                self.assertIn("바뀐 과목", (root / "data/timetable.html").read_text(encoding="utf-8"))
            previous = (root / "data/current.json").read_bytes()
            with patch.object(t, "download", side_effect=OSError("네트워크 오류")):
                with self.assertRaises(OSError):
                    t.refresh(root, "2026-10-15")
            self.assertEqual((root / "data/current.json").read_bytes(), previous)
            self.assertFalse(t.read_json(root / "data/status.json")["ok"])
            with patch.object(t, "download", return_value=snapshot):
                with self.assertRaises(t.NeedsReview):
                    t.refresh(root, "2027-02-01")
            self.assertEqual((root / "data/current.json").read_bytes(), previous)

    def test_html_does_not_execute_sheet_text(self):
        snapshot, plan = fixture()
        snapshot["sheets"][0]["cells"]["B3"] = '</script><script>alert("bad")</script>'
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "assets").mkdir()
            (root / "assets/viewer.html").write_bytes((ROOT / "assets/viewer.html").read_bytes())
            t.publish(root, t.build(snapshot, plan, "시험학교"))
            html = (root / "data/timetable.html").read_text(encoding="utf-8")
            self.assertNotIn('<script>alert("bad")', html)
            payload = html.split('id="initial-data">', 1)[1].split('</script>', 1)[0]
            self.assertEqual(json.loads(payload)["classes"][0]["days"]["월"][0]["raw"],
                             snapshot["sheets"][0]["cells"]["B3"])

    def test_xlsx_shared_inline_merged_and_cached_formulas(self):
        ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
        blob = io.BytesIO()
        with ZipFile(blob, "w") as z:
            z.writestr("xl/workbook.xml", f'<workbook {ns} xmlns:r="{t.REL}"><sheets><sheet name="표" sheetId="1" r:id="r1"/></sheets></workbook>')
            z.writestr("xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>')
            z.writestr("xl/sharedStrings.xml", f'<sst {ns}><si><r><t>국</t></r><r><t>어</t></r></si></sst>')
            z.writestr("xl/worksheets/sheet1.xml", f'<worksheet {ns}><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>수학</t></is></c><c r="D1"><f>1+1</f><v>2</v></c></row></sheetData><mergeCells><mergeCell ref="A1:B1"/></mergeCells></worksheet>')
        sheet = t.parse_xlsx(blob.getvalue())[0]
        self.assertEqual(t.cell_value(sheet, "B1"), "국어")
        self.assertEqual(sheet["cells"]["C1"], "수학")
        self.assertTrue(sheet["formulas"]["D1"]["cached"])

    def test_install_preserves_local_links_maps_and_json(self):
        spec = importlib.util.spec_from_file_location("installer", ROOT / "scripts/install.py")
        installer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(installer)
        with tempfile.TemporaryDirectory() as tmp:
            skills = Path(tmp) / "skills"
            target = installer.install(skills)
            for name in ("sources.local.json", "mapping.local.json", "data/current.json"):
                t.atomic_write(target / name, "user-local-value")
            installer.install(skills)
            for name in ("sources.local.json", "mapping.local.json", "data/current.json"):
                self.assertEqual((target / name).read_text(), "user-local-value")


if __name__ == "__main__":
    unittest.main()
