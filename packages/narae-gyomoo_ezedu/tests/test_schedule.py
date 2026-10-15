"""서버 연결 없이 입력의 중요한 동작을 검증한다."""

import argparse
from datetime import date
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "easyedu_schedule.py"
SPEC = importlib.util.spec_from_file_location("schedule", SCRIPT)
schedule = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(schedule)


class ScheduleTests(unittest.TestCase):
    def setUp(self):
        self.config = {"url": "http://example.invalid", "key": "offline-test-key",
                       "sido": "테스트", "school": "테스트학교", "uid": "test-user",
                       "name": "테스트", "part": "테스트부서"}
        self.args = argparse.Namespace(date=date(2026, 10, 16), title="한글 '따옴표'; 제목",
                                       detail="첫 줄\n둘째 줄", assignee="담당",
                                       kind="personal", dry_run=False)
        self.row = {"ID": "123", "Year": "2026", "Month": "10", "Day": "16",
                    "UserID": "test-user", "UserName": "테스트", "Type": "4",
                    "Data": self.args.title + "\x02굴림\x029\x020\x02-14774017",
                    "Data2": "테스트부서", "Data3": self.args.detail,
                    "Data5": "담당", "Data6": ""}

    def test_preview_makes_no_network_request(self):
        self.args.dry_run = True
        with patch.object(schedule, "query") as query, patch.object(schedule, "request") as request:
            result = schedule.create_event(self.config, self.args)
        self.assertEqual(result["status"], "preview")
        self.assertFalse(result["saved"])
        query.assert_not_called()
        request.assert_not_called()

    def test_duplicate_is_not_inserted(self):
        with patch.object(schedule, "query", return_value=[self.row]), \
                patch.object(schedule, "request") as request:
            result = schedule.create_event(self.config, self.args)
        self.assertEqual(result["status"], "exists")
        request.assert_not_called()

    def test_insert_uses_parameters_and_confirms_returned_id(self):
        with patch.object(schedule, "query", side_effect=[[], [self.row]]) as query, \
                patch.object(schedule, "request", return_value={"ok": True, "insertId": 123}) as request:
            result = schedule.create_event(self.config, self.args)
        self.assertEqual(result["status"], "created")
        self.assertEqual(result["event"]["title"], self.args.title)
        request.assert_called_once()
        _, endpoint, sql, params = request.call_args.args
        self.assertEqual(endpoint, "/insertid")
        self.assertNotIn(self.args.title, sql)
        self.assertTrue(params["data"].startswith(self.args.title))
        self.assertEqual(params["uid"], "test-user")
        self.assertEqual(params["school"], "테스트학교")
        self.assertEqual(query.call_args.args[2]["id"], "123")

    def test_invalid_title_is_rejected_before_network(self):
        self.args.title = "제목\n두 번째 줄"
        with patch.object(schedule, "query") as query, patch.object(schedule, "request") as request:
            with self.assertRaises(ValueError):
                schedule.create_event(self.config, self.args)
        query.assert_not_called()
        request.assert_not_called()

    def test_unknown_write_response_is_not_retried(self):
        opener = Mock()
        opener.open.side_effect = TimeoutError("offline timeout")
        with patch.object(schedule.urllib.request, "build_opener", return_value=opener):
            with self.assertRaisesRegex(ValueError, "자동 재전송하지 않았습니다"):
                schedule.request(self.config, "/insertid", "INSERT offline-test", {})
        opener.open.assert_called_once()

    def test_readback_failure_retains_saved_id_without_second_insert(self):
        with patch.object(schedule, "query", side_effect=[[], ValueError("offline readback failure")]), \
                patch.object(schedule, "request", return_value={"ok": True, "insertId": 123}) as request:
            with self.assertRaisesRegex(ValueError, "저장 ID 123"):
                schedule.create_event(self.config, self.args)
        request.assert_called_once()


if __name__ == "__main__":
    unittest.main()
