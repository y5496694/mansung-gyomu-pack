"""Parse copied, loaded KakaoTalk UI text without claiming full chat history."""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass


_DATE = re.compile(
    r"^[\s\-─]*(?P<date>\d{4}년\s*\d{1,2}월\s*\d{1,2}일)"
    r"(?:\s+[월화수목금토일]요일)?[\s\-─]*$"
)
_MESSAGE = re.compile(
    r"^\[(?P<sender>.+?)\]\s*"
    r"\[(?P<time>(?:(?:오전|오후|AM|PM)\s*)?\d{1,2}:\d{2}"
    r"(?::\d{2})?(?:\s*(?:AM|PM))?)\][ \t]?(?P<text>.*)$",
    re.IGNORECASE,
)


@dataclass
class TranscriptRecord:
    index: int
    kind: str
    sender: str | None
    date: str | None
    time: str | None
    text: str
    raw: str

    def to_dict(self) -> dict:
        return asdict(self)


def parse_transcript(text: str) -> list[TranscriptRecord]:
    """Recognize clipboard message headers and preserve unrecognized text.

    Dates remain local display strings: a copied timestamp does not supply a
    timezone, and a missing date must not be guessed from the current day.
    """
    records: list[TranscriptRecord] = []
    date: str | None = None
    current: TranscriptRecord | None = None
    for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        heading = _DATE.fullmatch(line)
        if heading:
            date = heading["date"]
            current = None
            continue
        match = _MESSAGE.fullmatch(line)
        if match:
            current = TranscriptRecord(
                index=len(records), kind="message", sender=match["sender"],
                date=date, time=match["time"], text=match["text"], raw=line,
            )
            records.append(current)
        elif current is not None:
            current.text += "\n" + line
            current.raw += "\n" + line
        elif line.strip():
            current = TranscriptRecord(
                index=len(records), kind="unparsed", sender=None,
                date=date, time=None, text=line, raw=line,
            )
            records.append(current)
    return records


def loaded_messages(text: str, *, contains: str | None = None, limit: int = 50) -> dict:
    if limit < 1:
        raise ValueError("limit must be positive")
    records = parse_transcript(text)
    needle = contains.casefold() if contains is not None else None
    matches = [record for record in records if needle is None or needle in record.text.casefold()]
    selected = matches[-limit:]
    return {
        "coverage": "loaded_ui_only",
        "complete_history": False,
        "note": "현재 채팅방 UI에서 복사된 내용만 조회합니다. 전체 대화 기록 검색이 아닙니다.",
        "loaded_records": len(records),
        "matched_records": len(matches),
        "returned_records": len(selected),
        "records": [record.to_dict() for record in selected],
    }
