from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from pathlib import Path
from typing import Any

from . import __version__
from .backend import (
    KakaoError,
    WIN32_ERRORS,
    doctor,
    inspect_tree,
    list_rooms,
    list_windows,
    open_room,
    preview_send,
    read_visible,
    send_message,
    start_kakaotalk,
)
from .transcript import loaded_messages


def emit(data: Any, *, as_json: bool) -> None:
    if as_json:
        print(json.dumps(data, ensure_ascii=False, indent=2))
    elif isinstance(data, str):
        print(data)
    elif isinstance(data, list):
        for item in data:
            print(item if isinstance(item, str) else json.dumps(item, ensure_ascii=False))
    else:
        for key, value in data.items():
            print(f"{key}: {value}")


def confirm_send(room: str, message: str, *, skip: bool) -> bool:
    if skip:
        return True
    if not sys.stdin.isatty():
        raise KakaoError("비대화형 전송에는 --yes가 필요합니다. --dry-run으로 먼저 확인하세요.")
    print(f"전송 대상: {room}\n메시지: {message}", file=sys.stderr)
    try:
        return input("이대로 전송할까요? [y/N] ").strip().casefold() in {"y", "yes"}
    except EOFError:
        return False


def _message_arguments(parser: argparse.ArgumentParser) -> None:
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("message", nargs="?", help="전송할 메시지")
    source.add_argument("--message-file", help="UTF-8 텍스트 파일에서 메시지 읽기")
    source.add_argument("--stdin", action="store_true", help="표준 입력의 UTF-8 메시지 읽기")


def _read_message(args: argparse.Namespace) -> str:
    try:
        if args.message_file:
            message = Path(args.message_file).read_text(encoding="utf-8-sig")
        elif args.stdin:
            stream = getattr(sys.stdin, "buffer", None)
            message = stream.read().decode("utf-8-sig") if stream else sys.stdin.read()
        else:
            message = args.message
    except (OSError, UnicodeError) as exc:
        raise KakaoError(f"UTF-8 메시지를 읽지 못했습니다: {exc}") from exc
    if not message or not message.strip():
        raise KakaoError("빈 메시지는 전송할 수 없습니다.")
    if "\x00" in message:
        raise KakaoError("메시지에 NUL 문자를 포함할 수 없습니다.")
    return message


def _positive_int(value: str) -> int:
    result = int(value)
    if result < 1:
        raise argparse.ArgumentTypeError("1 이상의 값을 입력하세요.")
    return result


def _positive_float(value: str) -> float:
    result = float(value)
    if not math.isfinite(result) or result <= 0:
        raise argparse.ArgumentTypeError("0보다 큰 유한한 값을 입력하세요.")
    return result


def _max_chars(value: str) -> int:
    result = _positive_int(value)
    if result > 1000000:
        raise argparse.ArgumentTypeError("최대 1000000자까지 추출할 수 있습니다.")
    return result


def _submitted_result(window, message: str) -> dict:
    return {
        "submitted": True,
        "delivery_confirmed": False,
        "status": "submitted_unconfirmed",
        "room": window.title,
        "message": message,
        "note": "입력과 Enter 처리를 확인했습니다. 서버 전달 및 수신 여부는 확인하지 못했습니다.",
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="kakaocli", description="비공식 Windows 카카오톡 CLI")
    parser.add_argument("--json", action="store_true", help="JSON으로 출력")
    parser.add_argument("--version", action="version", version=__version__)
    sub = parser.add_subparsers(dest="command", required=True)

    output_options = argparse.ArgumentParser(add_help=False)
    output_options.add_argument("--json", action="store_true", default=argparse.SUPPRESS, help="JSON으로 출력")

    def command(name: str, **kwargs) -> argparse.ArgumentParser:
        return sub.add_parser(name, parents=[output_options], **kwargs)

    command("doctor", help="설치 및 실행 상태 점검")
    command("start", help="PC 카카오톡 실행")
    command("windows", help="감지된 카카오톡 창 출력")
    command("rooms", help="현재 독립 창으로 열린 채팅방 출력")

    open_parser = command("open", help="채팅방 검색 및 백그라운드 열기")
    open_parser.add_argument("room")
    open_parser.add_argument("--exact", action="store_true")
    open_parser.add_argument("--interactive", action="store_true", help="화면 활성화를 허용(기본값은 백그라운드)")

    read_parser = command("read", help="열린 화면에 보이는 대화 복사")
    read_parser.add_argument("room")
    read_parser.add_argument("--exact", action="store_true")
    read_parser.add_argument("--interactive", action="store_true", help="화면 활성화를 허용(기본값은 백그라운드)")

    for name, help_text in (("messages", "로드된 UI 대화를 구조화해 조회"), ("search", "로드된 UI 대화 내용 검색")):
        messages_parser = command(name, help=help_text)
        messages_parser.add_argument("room")
        messages_parser.add_argument("--exact", action="store_true")
        messages_parser.add_argument("--interactive", action="store_true", help="화면 활성화를 허용(기본값은 백그라운드)")
        messages_parser.add_argument("--limit", type=_positive_int, default=50)
        if name == "search":
            messages_parser.add_argument("query", help="메시지 내용에 포함된 문자열")
        else:
            messages_parser.add_argument("--contains", help="메시지 내용에 포함된 문자열")

    attachments_parser = command("attachments", help="로드된 대화의 첨부 항목 조회")
    attachments_parser.add_argument("room", help="채팅방의 정확한 제목")
    attachments_parser.add_argument("--limit", type=_positive_int, default=50)
    attachments_parser.add_argument("--interactive", action="store_true", help="화면 활성화를 허용(기본값은 백그라운드)")

    capture_parser = command("capture", help="지정 채팅방 화면을 이미지로 저장")
    capture_parser.add_argument("room", help="채팅방의 정확한 제목")
    capture_parser.add_argument("--output", required=True, help="저장할 이미지 경로")
    capture_parser.add_argument("--scroll", choices=("up", "down", "top", "bottom"), help="캡처 전 대화 목록 스크롤")
    main_capture = command("capture-main", help="현재 카카오톡 메인 창만 백그라운드 캡처")
    main_capture.add_argument("--output", required=True)

    download_parser = command("download", help="지정 채팅방의 사진 또는 파일 다운로드")
    download_parser.add_argument("room", help="채팅방의 정확한 제목")
    download_mode = download_parser.add_mutually_exclusive_group()
    download_mode.add_argument("--at", nargs=2, type=int, metavar=("X", "Y"), help="첨부 항목의 좌표")
    download_mode.add_argument("--viewer", dest="mode", action="store_const", const="viewer", help="열린 사진 뷰어에서 저장(기본값)")
    download_mode.add_argument("--dialog", dest="mode", action="store_const", const="dialog", help="열린 저장 대화상자에서 저장")
    download_parser.set_defaults(mode="viewer")
    download_parser.add_argument("--kind", choices=("image", "file"), default="image")
    download_parser.add_argument("--output-dir", help="다운로드할 폴더")
    download_parser.add_argument("--filename", help="저장할 파일 이름")
    download_parser.add_argument("--timeout", type=_positive_float, default=20.0, help="저장 대기 시간(초)")
    download_parser.add_argument("--interactive", action="store_true", help="화면 활성화를 허용(기본값은 백그라운드)")

    analyze_parser = command("analyze", help="다운로드한 로컬 사진 또는 파일 분석")
    analyze_parser.add_argument("path", help="분석할 로컬 파일 경로")
    analyze_parser.add_argument("--output-dir", help="분석 결과를 저장할 폴더")
    analyze_parser.add_argument("--max-chars", type=_max_chars, default=20000, help="추출할 최대 문자 수")

    send_parser = command("send", help="채팅방에 메시지 전송")
    send_parser.add_argument("room")
    _message_arguments(send_parser)
    send_parser.add_argument("--exact", action="store_true", default=True, help="방 제목 완전 일치(기본값)")
    send_parser.add_argument("--yes", action="store_true", help="확인 질문 생략")
    send_parser.add_argument("--interactive", action="store_true", help="화면 활성화를 허용(기본값은 백그라운드)")
    send_parser.add_argument("--dry-run", action="store_true", help="대상과 내용을 출력하고 전송하지 않음")

    for name, help_text in (("send-image", "로컬 사진 한 장 전송"), ("send-file", "로컬 파일 한 개 전송")):
        outgoing_parser = command(name, help=help_text)
        outgoing_parser.add_argument("room", help="확인된 채팅방의 정확한 제목")
        outgoing_parser.add_argument("path", help="전송할 로컬 파일 경로")
        outgoing_parser.add_argument("--yes", action="store_true", help="확인 질문 생략")
        outgoing_parser.add_argument("--dry-run", action="store_true", help="파일과 대상만 검사하고 전송하지 않음")

    command('self-room', help='기존 보안 키로 나와의 채팅 종류를 확인 (키 복구는 하지 않음)')
    send_self_parser = command(
        "send-self", help="DB에서 나와의 채팅을 찾아 메시지 전송"
    )
    _message_arguments(send_self_parser)
    send_self_parser.add_argument("--yes", action="store_true", help="확인 질문 생략")
    send_self_parser.add_argument('--expected-self', help='직전 self-room의 본인 계정·방 지문')
    send_self_parser.add_argument("--interactive", action="store_true", help="화면 활성화를 허용(기본값은 백그라운드)")
    send_self_parser.add_argument(
        "--dry-run", action="store_true", help="대상과 내용을 출력하고 전송하지 않음"
    )

    inspect_parser = command("inspect", help="호환성 진단용 자식 컨트롤 출력")
    inspect_parser.add_argument("--room", help="채팅방 창 검사; 생략 시 메인 창 검사")

    recover_parser = command("recover-key", help="실행 중인 카카오톡 메모리에서 DB 키 복구")
    recover_parser.add_argument("--db", help="대상 .edb 경로; 생략 시 최신 TalkUserDB.edb")
    recover_parser.add_argument("--pid", type=int, help="KakaoTalk.exe PID")
    recover_parser.add_argument("--stride", type=int, default=4, choices=[1, 2, 4, 8, 16])
    recover_parser.add_argument("--timeout", type=float, default=120.0, help="검색 제한 시간(초)")
    recover_parser.add_argument("--no-store", action="store_true", help="검증만 하고 DPAPI 저장하지 않음")
    command("key-status", help="DPAPI 키 저장소 상태 확인")

    friends_parser = command("friends", help="로컬 DB에서 친구 목록 조회")
    friends_parser.add_argument("--contains", help="표시 이름에 포함된 문자열")
    friends_parser.add_argument("--include-hidden", action="store_true", help="숨김 친구 포함")

    chat_rooms_parser = command(
        "chat-rooms", help="로컬 DB에서 채팅방 목록 조회(메시지 본문 제외)"
    )
    chat_rooms_parser.add_argument("--contains", help="방 제목에 포함된 문자열")
    chat_rooms_parser.add_argument("--type", dest="room_type", help="방 종류(예: MultiChat)")
    chat_rooms_parser.add_argument("--limit", type=int, help="최대 출력 개수")
    chat_rooms_parser.add_argument(
        "--include-ids", action="store_true", help="JSON 출력에 로컬 chatId 포함"
    )

    contacts_parser = command(
        "export-room-contacts",
        help="DB에 캐시된 채팅방 참여자 이름과 연락처를 CSV로 저장",
    )
    contacts_parser.add_argument("room", help="채팅방 제목")
    contacts_parser.add_argument("--output", required=True, help="저장할 CSV 경로")
    contacts_parser.add_argument("--exact", action="store_true", help="방 제목 완전 일치")
    contacts_parser.add_argument(
        "--allow-partial",
        action="store_true",
        help="참여자 캐시가 불완전해도 부분 목록 저장",
    )

    schema_parser = command("db-schema", help="복호화된 DB의 테이블 구조만 조회")
    schema_parser.add_argument("--db", help="대상 .edb 경로; 생략 시 TalkUserDB.edb")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command in {"attachments", "capture", "download"} and not args.room.strip():
            raise KakaoError("채팅방 이름은 비어 있을 수 없습니다.")
        if args.command == "doctor":
            result = doctor()
        elif args.command == "start":
            result = {"started": True, "executable": str(start_kakaotalk())}
        elif args.command == "windows":
            result = [window.to_dict() for window in list_windows()]
        elif args.command == "rooms":
            result = [window.to_dict() for window in list_rooms()]
        elif args.command == "open":
            result = {"opened": open_room(args.room, exact=args.exact, interactive=args.interactive).to_dict()}
        elif args.command == "read":
            window, text = read_visible(args.room, exact=args.exact, interactive=args.interactive)
            result = {"room": window.title, "text": text, "coverage": "loaded_ui_only", "complete_history": False}
        elif args.command in {"messages", "search"}:
            contains = args.query if args.command == "search" else args.contains
            if contains is not None and not contains.strip():
                raise KakaoError("검색 문자열은 비어 있을 수 없습니다.")
            window, text = read_visible(args.room, exact=args.exact, interactive=args.interactive)
            result = {"room": window.title, **loaded_messages(text, contains=contains, limit=args.limit)}
        elif args.command == "attachments":
            from .attachments import list_attachments

            result = list_attachments(args.room, limit=args.limit, interactive=args.interactive)
        elif args.command == "capture-main":
            from .backend import find_main_window
            from .attachments import _capture
            main = find_main_window()
            if not main:
                raise KakaoError("로그인된 카카오톡 메인 창을 찾지 못했습니다.")
            destination = Path(args.output).expanduser().resolve()
            if destination.exists():
                raise KakaoError("기존 캡처 파일을 덮어쓰지 않습니다.")
            from . import backend as backend
            was_visible = backend.win32gui.IsWindowVisible(main.hwnd)
            old_rect = backend.win32gui.GetWindowRect(main.hwnd)
            foreground = backend.win32gui.GetForegroundWindow()
            try:
                if not was_visible:
                    backend.win32gui.SetWindowPos(main.hwnd, 1, -32000, -32000, 0, 0, 0x11)
                    backend.win32gui.ShowWindow(main.hwnd, 4)
                    import time
                    time.sleep(.2)
                _capture(main.hwnd, destination)
            finally:
                if not was_visible:
                    backend.win32gui.ShowWindow(main.hwnd, 0)
                    backend.win32gui.SetWindowPos(main.hwnd, 1, old_rect[0], old_rect[1], 0, 0, 0x11)
            if backend.win32gui.GetForegroundWindow() != foreground:
                raise KakaoError("캡처 중 전경 창이 바뀌었습니다. 추가 입력은 하지 않았습니다.")
            result = {"path": str(destination), "kind": "main_window", "background": True}
        elif args.command == "capture":
            from .attachments import capture_room

            result = capture_room(args.room, output=args.output, scroll=args.scroll)
        elif args.command == "download":
            from .attachments import download_attachment

            result = download_attachment(
                args.room,
                point=tuple(args.at) if args.at is not None else None,
                mode="point" if args.at is not None else args.mode,
                kind=args.kind,
                output_directory=args.output_dir,
                filename=args.filename,
                timeout=args.timeout,
                interactive=args.interactive,
            )
        elif args.command == "analyze":
            from .attachment_analysis import analyze_attachment

            result = analyze_attachment(
                args.path, output_directory=args.output_dir, max_chars=args.max_chars,
            )
        elif args.command == "inspect":
            result = inspect_tree(args.room)
        elif args.command == "recover-key":
            from .key_recovery import (
                default_database,
                recover_key_from_process,
                store_recovered_key,
            )

            database = Path(args.db) if args.db else default_database()
            recovered = recover_key_from_process(
                database,
                pid=args.pid,
                stride=args.stride,
                timeout=args.timeout,
            )
            if args.no_store:
                result = {
                    "stored": False,
                    "database": str(recovered.database),
                    "fingerprint": recovered.fingerprint,
                    "stats": recovered.stats.__dict__,
                }
            else:
                result = store_recovered_key(recovered)
        elif args.command == "key-status":
            from .key_recovery import key_store_status

            result = key_store_status()
        elif args.command == "friends":
            from .db_reader import read_friends
            from .key_recovery import default_database, load_stored_key

            database = default_database()
            friends = read_friends(
                database,
                load_stored_key(database),
                contains=args.contains,
                include_hidden=args.include_hidden,
            )
            result = friends if args.json else [friend["name"] for friend in friends]
        elif args.command == "chat-rooms":
            from .db_reader import read_chat_rooms
            from .key_recovery import (
                default_chat_list_database,
                load_stored_key,
            )

            database = default_chat_list_database()
            rooms = read_chat_rooms(
                database,
                load_stored_key(database),
                contains=args.contains,
                room_type=args.room_type,
                limit=args.limit,
                include_ids=args.include_ids,
            )
            result = rooms if args.json else [room["title"] for room in rooms]
        elif args.command == "export-room-contacts":
            from .db_reader import read_room_contacts
            from .key_recovery import (
                default_chat_list_database,
                default_database,
                load_stored_key,
            )

            chat_database = default_chat_list_database()
            user_database = default_database()
            export = read_room_contacts(
                chat_database,
                load_stored_key(chat_database),
                user_database,
                load_stored_key(user_database),
                args.room,
                exact=args.exact,
            )
            if not export["complete"] and not args.allow_partial:
                raise KakaoError(
                    "참여자 캐시가 불완전합니다: "
                    f"방 표시 {export['expectedMembers']}명, 캐시 {export['cachedMembers']}명. "
                    "부분 저장을 원하면 --allow-partial을 사용하세요."
                )
            destination = Path(args.output).expanduser().resolve()
            destination.parent.mkdir(parents=True, exist_ok=True)
            temporary = destination.with_suffix(destination.suffix + ".tmp")
            try:
                with temporary.open("w", encoding="utf-8-sig", newline="") as handle:
                    writer = csv.writer(handle)
                    writer.writerow(["이름", "전화번호"])
                    writer.writerows(
                        (contact["name"], contact["phone"])
                        for contact in export["contacts"]
                    )
                temporary.replace(destination)
            finally:
                temporary.unlink(missing_ok=True)
            result = {
                "saved": True,
                "output": str(destination),
                "room": export["room"],
                "expectedMembers": export["expectedMembers"],
                "exportedMembers": export["cachedMembers"],
                "phoneNumbers": sum(
                    bool(contact["phone"]) for contact in export["contacts"]
                ),
                "complete": export["complete"],
            }
        elif args.command == "db-schema":
            from .db_reader import read_schema
            from .key_recovery import default_database, load_stored_key

            database = Path(args.db).resolve() if args.db else default_database()
            result = read_schema(database, load_stored_key(database))
        elif args.command in {"self-room", "send-self"}:
            message = _read_message(args) if args.command == 'send-self' else None
            from .db_reader import read_chat_rooms
            from .key_recovery import load_stored_key
            from .active_database import current_account
            import hashlib
            active = current_account()
            database = active['database']
            rooms = read_chat_rooms(database, load_stored_key(database), include_ids=True)
            memo_rooms = [item for item in rooms if item['type'].casefold() == 'memochat']
            if len(memo_rooms) != 1 or not memo_rooms[0]["title"]:
                raise KakaoError("나와의 채팅방을 하나로 식별하지 못했습니다.")
            room = memo_rooms[0]["title"]
            if len([item for item in rooms if item['title'].strip().casefold() == room.strip().casefold()]) != 1:
                raise KakaoError('본인 프로필과 제목이 같은 다른 대화방이 있어 이름으로 전송하지 않았습니다.')
            identity = hashlib.sha256((active['binding'] + '\0' + str(memo_rooms[0]['chatId']) + '\0' + room).encode()).hexdigest()
            if args.command == 'send-self' and args.expected_self and args.expected_self != identity:
                raise KakaoError('나와의 채팅 확인 후 활성 계정 또는 본인 방이 바뀌었습니다. 전송하지 않았습니다.')
            preview = {"room": room, "message": message, "exact": True, "self": True, "account_confirmed": True, "account_binding": identity, "evidence": "MemoChat+active_process_file"}
            if args.command == 'self-room':
                emit({'room': room, 'self': True, 'account_confirmed': True, 'account_binding': identity, 'evidence': 'MemoChat+active_process_file'}, as_json=args.json)
                return 0
            if args.dry_run:
                result = {"sent": False, "dry_run": True, **preview, **preview_send(room, exact=True)}
            else:
                if args.stdin and not args.yes:
                    raise KakaoError("--stdin 전송에는 --yes가 필요합니다.")
                if not confirm_send(room, message, skip=args.yes):
                    emit({"sent": False, "cancelled": True}, as_json=args.json)
                    return 2
                window = send_message(room, message, exact=True, interactive=args.interactive)
                result = _submitted_result(window, message)
        elif args.command in {"send-image", "send-file"}:
            from .outgoing import preview_attachment, send_attachment
            kind = "image" if args.command == "send-image" else "file"
            result = preview_attachment(args.room, args.path, kind=kind)
            if not args.dry_run:
                if not confirm_send(result['room'], result['attachment']['filename'], skip=args.yes):
                    emit({"submitted": False, "cancelled": True}, as_json=args.json)
                    return 2
                result = send_attachment(result['room'], result['attachment']['path'], kind=kind)
        elif args.command == "send":
            if not args.room.strip():
                raise KakaoError("채팅방 이름은 비어 있을 수 없습니다.")
            message = _read_message(args)
            preview = {"room": args.room, "message": message, "exact": True}
            if args.dry_run:
                result = {"sent": False, "dry_run": True, **preview, **preview_send(args.room, exact=True)}
            else:
                if args.stdin and not args.yes:
                    raise KakaoError("--stdin 전송에는 --yes가 필요합니다.")
                if not confirm_send(args.room, message, skip=args.yes):
                    emit({"sent": False, "cancelled": True}, as_json=args.json)
                    return 2
                window = send_message(args.room, message, exact=True, interactive=args.interactive)
                result = _submitted_result(window, message)
        else:
            parser.error("알 수 없는 명령")
            return 2
        emit(result, as_json=args.json)
        return 0
    except (KakaoError, *WIN32_ERRORS) as exc:
        error = {"ok": False, "error": str(exc)}
        if args.json:
            print(json.dumps(error, ensure_ascii=False), file=sys.stderr)
        else:
            print(f"오류: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("취소했습니다.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
