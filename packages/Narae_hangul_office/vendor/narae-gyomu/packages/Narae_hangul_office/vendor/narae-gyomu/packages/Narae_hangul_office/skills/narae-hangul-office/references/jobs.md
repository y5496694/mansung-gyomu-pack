# CLI 작업 JSON

`narae-office.cmd run job.json --result result.json` 또는 `node <app>/src/cli.cjs run -`에 UTF-8 JSON을 전달한다. `schema:1`. `input/path`, `output/target`, 그림 경로는 JSON 파일 폴더 기준. stdout과 결과 파일은 같은 JSON이다. 결과 경로에 문서·작업 JSON·그림 경로를 지정하면 거절한다.

## 읽기

```json
{"schema":1,"action":"inspect","input":"안내.hwpx"}
```

`paragraphs:[{id,text,editable_text,...}]`, `tables`, `images`, `input_sha256`, `input_unchanged`, `warnings`를 반환한다. `blocks`와 `hash`도 앱과 같은 형태로 제공한다. 표 셀의 문단 ID도 실제 반환값을 사용한다.

## 생성

```json
{"schema":1,"action":"create","output":"새안내.hwpx","blocks":[{"type":"paragraph","text":"연수 안내","text_style":{"size":18,"bold":true},"paragraph_style":{"align":"CENTER"}},{"type":"paragraph","text":"10월 30일에 연수를 진행합니다."},{"type":"table","columns_mm":[40,100],"rows":[[{"text":"시간"},{"text":"내용"}],[{"text":"14:00"},{"text":"실습"}]]}]}
```

출력 확장자는 `.hwp` 또는 `.hwpx`. 이미지 블록은 `{"type":"image","path":"사진.png","width_mm":40,"height_mm":30}`. `page`의 `width_mm,height_mm,margins_mm` 지원. blocks 생략 시 `title`,`content`로 문단을 생성한다.

## 파일 편집

```json
{"schema":1,"action":"edit","input":"안내.hwpx","expected_input_sha256":"직전 inspect의 input_sha256","operations":[{"op":"set_text","target":"실제 문단 ID","text":"수정한 내용"},{"op":"format","target":"실제 문단 ID","text_style":{"size":14,"bold":true},"paragraph_style":{"align":"CENTER"}}]}
```

`output` 생략 시 원본을 백업하고 저장한다. 다른 출력 경로가 있으면 사본을 만들며 기존 출력은 기본 거절한다. 허용하려면 `overwrite_output:true`. 해시가 달라지면 원본을 바꾸지 않고 거절한다. `backup` 경로·`hash`·`saved`를 확인한다. 표 작업 `merge_cells,set_cell_style,insert_row,delete_row`의 인자는 `schema` 출력 참고. 텍스트·서식과 표 구조 작업을 한 요청에 섞지 않는다.

## 열린 한글 편집

```json
{"schema":1,"action":"live-read","input":"안내.hwp"}
```

```json
{"schema":1,"action":"live-edit","input":"안내.hwp","liveRevision":"직전 live-read 결과","operations":[{"op":"replace_text","text":"원래 한 문단","replacement":"수정한 한 문단","expected_count":1,"occurrence":0},{"op":"set_style","text":"수정한 한 문단","font_size":17,"bold":true}],"save":true}
```

`live-read`는 파일이 닫혀 있으면 한글에서 연다. `liveRevision`이 다르면 편집을 거절한다. 문단 내 원문을 정확히 선택하며 기본 후보 수 1, occurrence는 0부터다. `set_style`은 문단 전체 원문, font_size/font_family/bold/italic/underline/text_color/align 지원. 기본 저장, `save:false`면 한글에 미저장 상태로 남긴다. 원본 파일 백업을 반환한다. 명령 후에도 사용자가 볼 문서 창은 유지한다.

## PDF·진단

```json
{"schema":1,"action":"export","input":"안내.hwpx","output":"안내_검토.pdf"}
```

한컴의 실제 PDF 출력 기능을 사용한다. 원본은 전후 해시를 대조한다. `narae-office.cmd export 안내.hwpx --pdf 안내.pdf`도 가능. `doctor`는 런타임·한컴 경로, `list`는 열린 문서 목록, `open <file>`은 문서를 한글에서 연다. CLI가 중단되어 `cache/cli-locks` 잠금이 남으면 owner.json PID가 종료된 것을 확인한 뒤 해당 잠금 폴더만 삭제하고 재실행한다.

기본 CLI inspect는 중복 없는 compact 응답이다. 문단 id/text/서식과 표 인덱스를 반환하며 blocks 별칭은 --full에서만 제공한다. --offset N --limit N으로 범위를 선택하고 counts·hasMore를 확인한다. 작업 JSON에서는 full, offset, limit를 지정한다. narae-hangul 독립 CLI와는 별도로 설치되며, 오피스는 해당 스킬을 덮어쓰지 않는다.
