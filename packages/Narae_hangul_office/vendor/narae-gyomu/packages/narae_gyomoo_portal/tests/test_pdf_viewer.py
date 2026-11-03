import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'skills/wxs-cli/scripts'))
from wxs_pdf_viewer import wait_for_viewer


class ViewerTest(unittest.TestCase):
    def test_windowless_process_is_not_success_or_proof_of_corruption(self):
        state = {'matching_windows': [], 'windowless_pdf_processes': [{'pid': 123}],
                 'memory': {'available_mb': 50}}
        result = wait_for_viewer('synthetic.pdf', observer=lambda name: state, timeout=0)
        self.assertFalse(result['viewer_window_detected'])
        self.assertFalse(result['viewer_open_verified'])
        self.assertEqual(result['viewer_diagnostics']['memory']['available_mb'], 50)

    def test_delayed_window_is_detected_but_contents_still_need_review(self):
        states = iter([{'matching_windows': []}, {'matching_windows': [{'pid': 123}]}])
        result = wait_for_viewer('synthetic.pdf', observer=lambda name: next(states), sleep=lambda _: None)
        self.assertTrue(result['viewer_window_detected'])
        self.assertFalse(result['viewer_open_verified'])
