"""Read local image text with installed Windows OCR languages, without UI."""

from __future__ import annotations

import json
import math
import os
from pathlib import Path
import subprocess
import sys


class WindowsOcrError(RuntimeError):
    def __init__(self, message: str, *, code: str = "ocr_failed"):
        super().__init__(message)
        self.code = code


def _validate_result(result) -> dict:
    if not isinstance(result, dict):
        raise WindowsOcrError("Windows OCR returned a non-object result.", code="invalid_ocr_output")
    if result.get("error"):
        error = result["error"]
        raise WindowsOcrError(str(error.get("message", "Windows OCR failed.")), code=str(error.get("code", "ocr_failed")))
    if not isinstance(result.get("text"), str) or not isinstance(result.get("language"), str) or not isinstance(result.get("lines"), list):
        raise WindowsOcrError("Windows OCR returned incomplete text or line metadata.", code="invalid_ocr_output")
    for line in result["lines"]:
        if not isinstance(line, dict) or not isinstance(line.get("text"), str) or not isinstance(line.get("words"), list):
            raise WindowsOcrError("Windows OCR returned invalid line metadata.", code="invalid_ocr_output")
        for word in line["words"]:
            if not isinstance(word, dict) or not isinstance(word.get("text"), str):
                raise WindowsOcrError("Windows OCR returned invalid word metadata.", code="invalid_ocr_output")
            for key in ("x", "y", "width", "height"):
                value = word.get(key)
                if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                    raise WindowsOcrError("Windows OCR returned an invalid word rectangle.", code="invalid_ocr_output")
            if word["width"] < 0 or word["height"] < 0:
                raise WindowsOcrError("Windows OCR returned a negative rectangle size.", code="invalid_ocr_output")
    return result


def ocr_image(path) -> dict:
    """Return OCR text, language, and per-word source-image pixel rectangles.

    Uses Windows PowerShell 5 and Windows.Media.Ocr. It does not install language
    packs, download a model, open a window, control an app, or upload the image.
    """
    if sys.platform != "win32":
        raise WindowsOcrError("Built-in Windows OCR requires Windows.", code="windows_required")
    source = Path(path).expanduser().resolve()
    if not source.is_file():
        raise WindowsOcrError("OCR input must be an existing local image file.", code="image_missing")
    if source.stat().st_size > 64 * 1024 * 1024:
        raise WindowsOcrError("OCR image exceeds the 64 MiB input limit.", code="image_too_large")
    script = Path(__file__).with_name("windows_ocr.ps1")
    if not script.is_file():
        raise WindowsOcrError("The bundled Windows OCR PowerShell script is missing.", code="ocr_script_missing")
    powershell = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
    startup = subprocess.STARTUPINFO()
    startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startup.wShowWindow = subprocess.SW_HIDE
    try:
        completed = subprocess.run(
            [str(powershell), "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(script), "-ImagePath", str(source)],
            capture_output=True, text=True, encoding="utf-8-sig", errors="strict",
            timeout=40, check=False, creationflags=subprocess.CREATE_NO_WINDOW, startupinfo=startup,
        )
    except subprocess.TimeoutExpired as exc:
        raise WindowsOcrError("Windows OCR timed out after 40 seconds.", code="ocr_timeout") from exc
    except (OSError, UnicodeError) as exc:
        raise WindowsOcrError(f"Could not run built-in Windows OCR: {exc}", code="ocr_unavailable") from exc
    try:
        result = json.loads(completed.stdout)
    except (TypeError, json.JSONDecodeError) as exc:
        detail = completed.stderr.strip()[:1000]
        raise WindowsOcrError("Windows OCR returned invalid JSON." + (f" {detail}" if detail else ""), code="invalid_ocr_output") from exc
    validated = _validate_result(result)
    if completed.returncode:
        raise WindowsOcrError("Windows OCR exited unsuccessfully.")
    return validated
