"""나래교무 이지에듀: 투게더 일정 조회·입력 CLI. Python 3.10+, Windows, 외부 패키지 없음."""

import argparse
from datetime import date, datetime, timedelta, timezone
import json
import sys
import urllib.error
import urllib.request
import winreg

REG_PATH = r"Software\EasyeduInfo\EasyeduTogether"
KINDS = {"personal": "4", "school": "5", "group": "6", "other": "7"}
LABELS = {"1": "공휴일", "2": "국가절기", "4": "개인",
          "5": "학교", "6": "그룹", "7": "복무기타"}
FIELDS = "ID, Year, Month, Day, UserID, UserName, Data, Type, Data2, Data3, Data5, Data6"


def load_config():
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, REG_PATH, 0,
                        winreg.KEY_READ | winreg.KEY_WOW64_32KEY) as key:
        def read(name):
            return str(winreg.QueryValueEx(key, name)[0]).strip()
        if read("SchedGatewayMode") != "1":
            raise ValueError("이지에듀의 일정 게이트웨이 설정이 활성화되어 있지 않습니다.")
        config = {"url": read("SchedGatewayUrl").rstrip("/"),
                  "key": read("SchedGatewayKey"), "sido": read("시도명"),
                  "school": read("학교명"), "uid": read("LoginID"),
                  "name": read("LoginName"), "part": read("LoginPart")}
    if not all(config.values()):
        raise ValueError("이지에듀의 저장된 로그인·학교·게이트웨이 설정을 확인하세요.")
    return config


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("게이트웨이 주소가 변경되었습니다. 이지에듀 설정을 확인하세요.")


def request(config, endpoint, sql, params):
    payload = json.dumps({"db": "scheduling", "sql": sql, "params": params},
                         ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(config["url"] + endpoint, data=payload,
                                 headers={"Content-Type": "application/json; charset=utf-8",
                                          "X-Tuk-Key": config["key"]}, method="POST")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(req, timeout=15) as response:
            result = json.load(response)
    except urllib.error.HTTPError as exc:
        raise ValueError(f"게이트웨이 요청 거절: HTTP {exc.code}") from None
    except (OSError, ValueError) as exc:
        if endpoint == "/insertid":
            raise ValueError("저장 응답을 확인하지 못했습니다. 같은 날짜를 조회해 저장 여부를 확인하세요. "
                             "자동 재전송하지 않았습니다.") from None
        raise ValueError("게이트웨이 응답을 확인하지 못했습니다. 네트워크와 이지에듀 설정을 확인하세요.") from exc
    if result.get("ok") is not True:
        error = str(result.get("error") or result.get("message") or "게이트웨이 처리 실패")
        raise ValueError(error.replace(config["key"], "[인증키 숨김]"))
    return result


def query(config, sql, params):
    result = request(config, "/query", sql, params)
    return [dict(zip(result["columns"], row)) for row in result["rows"]]


def event(row):
    return {"id": str(row["ID"]),
            "date": f"{int(row['Year']):04d}-{int(row['Month']):02d}-{int(row['Day']):02d}",
            "kind": next((k for k, v in KINDS.items() if v == row["Type"]), str(row["Type"])),
            "category": LABELS.get(row["Type"], str(row["Type"])),
            "title": (row["Data"] or "").split("\x02", 1)[0],
            "detail": row["Data3"] or "", "author": row["UserName"] or "",
            "assignee": row["Data5"] or "", "department": row["Data2"] or "",
            "repeat": row["Data6"] or ""}


def list_events(config, start, end, kind):
    params = {k: config[k] for k in ("sido", "school", "uid", "part")}
    params.update(start=start.strftime("%Y%m%d"), end=end.strftime("%Y%m%d"))
    # Form_Main.SearchInfoJ와 같은 개인·그룹 일정 표시 조건.
    visibility = """(Type IN ('1','2','3','5','7') OR (Type='4' AND UserID=@uid)
        OR (Type='6' AND ((COALESCE(Data7,'')<>'' AND LOCATE(@uid,Data7)>0)
        OR (COALESCE(Data7,'')='' AND Data2=@part))))"""
    sql = f"""SELECT {FIELDS} FROM TB_PLAN WHERE Sido=@sido AND School=@school
        AND CONCAT(Year,LPAD(Month,2,'0'),LPAD(Day,2,'0')) BETWEEN @start AND @end
        AND {visibility}"""
    if kind != "all":
        sql += " AND Type=@kind"
        params["kind"] = KINDS[kind]
    sql += " ORDER BY Year,Month,Day,Type,(Data LIKE '[완료] %'),ID"
    return [event(row) for row in query(config, sql, params)]


def create_event(config, args):
    title = args.title.strip()
    if not title or any(ord(ch) < 32 for ch in title):
        raise ValueError("제목은 비어 있지 않은 한 줄 텍스트여야 합니다.")
    detail = args.detail
    if any(ord(ch) < 32 and ch not in "\n\r\t" for ch in detail + args.assignee):
        raise ValueError("내용에 지원하지 않는 제어문자가 있습니다.")
    preview = {"date": args.date.isoformat(), "kind": args.kind, "title": title,
               "detail": detail, "assignee": args.assignee, "author": config["name"],
               "school": config["school"], "department": config["part"]}
    if args.dry_run:
        return {"status": "preview", "saved": False, "event": preview}
    # 앱의 기본 글꼴 구분자. 일정 제목과 세부 내용은 별도 필드이다.
    params = {k: config[k] for k in ("sido", "school", "uid", "part", "name")}
    params.update(year=args.date.strftime("%Y"), month=args.date.strftime("%m"),
                  day=args.date.strftime("%d"), kind=KINDS[args.kind],
                  data=title + "\x02굴림\x029\x020\x02-14774017",
                  detail=detail, assignee=args.assignee)
    match = """Sido=@sido AND School=@school AND UserID=@uid AND Year=@year
        AND Month=@month AND Day=@day AND Type=@kind AND Data=@data
        AND COALESCE(Data3,'')=@detail AND COALESCE(Data5,'')=@assignee
        AND Data2=@part AND COALESCE(Data7,'')=''"""
    existing = query(config, f"SELECT {FIELDS} FROM TB_PLAN WHERE {match} ORDER BY ID DESC LIMIT 1", params)
    if existing:
        return {"status": "exists", "saved": False, "event": event(existing[0])}
    sql = f"""INSERT INTO TB_PLAN
        (Year,Month,Day,Type,UserID,Data2,UserName,Data,Data3,Data4,Data5,Sido,School,Data7)
        SELECT @year,@month,@day,@kind,@uid,@part,@name,@data,@detail,'',@assignee,@sido,@school,''
        FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM TB_PLAN WHERE {match})"""
    result = request(config, "/insertid", sql, params)
    inserted_id = str(result.get("insertId") or "0")
    if inserted_id == "0":
        existing = query(config, f"SELECT {FIELDS} FROM TB_PLAN WHERE {match} ORDER BY ID DESC LIMIT 1", params)
        if existing:
            return {"status": "exists", "saved": False, "event": event(existing[0])}
        raise ValueError("저장된 일정 ID를 확인하지 못했습니다. 해당 날짜를 조회하세요.")
    try:
        rows = query(config, f"SELECT {FIELDS} FROM TB_PLAN WHERE Sido=@sido AND School=@school "
                     "AND UserID=@uid AND ID=@id", {**params, "id": inserted_id})
    except ValueError:
        raise ValueError(f"서버가 저장 ID {inserted_id}를 반환했지만 재조회에 실패했습니다. "
                         "해당 날짜를 조회해 확인하세요.") from None
    if len(rows) != 1:
        raise ValueError(f"서버가 일정 ID {inserted_id}를 반환했지만 재조회를 확인하지 못했습니다.")
    return {"status": "created", "saved": True, "event": event(rows[0])}


def parse_date(value):
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise argparse.ArgumentTypeError("날짜 형식: YYYY-MM-DD") from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    ls = sub.add_parser("list", help="날짜 또는 기간의 일정 조회")
    ls.add_argument("--date", type=parse_date)
    ls.add_argument("--from", dest="start", type=parse_date)
    ls.add_argument("--to", dest="end", type=parse_date)
    ls.add_argument("--kind", choices=["all", *KINDS], default="all")
    add = sub.add_parser("add", help="일정 입력")
    add.add_argument("--date", required=True, type=parse_date)
    add.add_argument("--title", required=True)
    add.add_argument("--detail", default="")
    add.add_argument("--assignee", default="")
    add.add_argument("--kind", choices=KINDS, default="personal")
    add.add_argument("--dry-run", action="store_true", help="저장 없이 입력 내용 미리보기")
    for child in (ls, add):
        child.add_argument("--json", action="store_true", help="자동화용 JSON 출력")
    args = parser.parse_args()
    try:
        if args.command == "list":
            if args.date and (args.start or args.end):
                parser.error("--date와 --from/--to는 함께 사용할 수 없습니다.")
            if bool(args.start) != bool(args.end):
                parser.error("기간 조회에는 --from과 --to를 함께 지정하세요.")
            today = datetime.now(timezone(timedelta(hours=9))).date()
            start, end = (args.start, args.end) if args.start else (args.date or today,) * 2
            if end < start:
                parser.error("종료일은 시작일 이후여야 합니다.")
            config = load_config()
            events = list_events(config, start, end, args.kind)
            result = {"school": config["school"], "from": start.isoformat(),
                      "to": end.isoformat(), "count": len(events), "events": events}
        else:
            config = load_config()
            result = create_event(config, args)
        if args.json:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        elif args.command == "list":
            print(f"{result['school']} | {result['from']} ~ {result['to']} | {result['count']}건")
            for item in result["events"]:
                print(f"{item['date']} [{item['category']}] {item['title']} (ID: {item['id']})")
                if item["detail"]:
                    print("  " + item["detail"].replace("\n", "\n  "))
        else:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (OSError, ValueError, KeyError, TypeError) as exc:
        error = {"ok": False, "error": str(exc)}
        print(json.dumps(error, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8")
    sys.exit(main())
