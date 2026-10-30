"""Precise live Hancom actions for verified document targets.

Use action-created sets, avoiding the mismatched installed HParameterSet getters.
PictureChange preserves the existing control's anchor and layout properties.
"""
import json
from pathlib import Path
import re
import sys
import time
import pythoncom
from win32com.client import dynamic


def application_for(file):
    target = str(Path(file).resolve()).lower()
    rot, context = pythoncom.GetRunningObjectTable(), pythoncom.CreateBindCtx(0)
    matches = []
    for moniker in rot:
        if not moniker.GetDisplayName(context, None).startswith("!HwpObject."):
            continue
        app = dynamic.Dispatch(rot.GetObject(moniker).QueryInterface(pythoncom.IID_IDispatch))
        for index in range(app.XHwpDocuments.Count):
            doc = app.XHwpDocuments.Item(index)
            if str(Path(str(doc.FullName)).resolve()).lower() == target:
                matches.append((app, doc))
    if len(matches) != 1:
        raise ValueError("한글 문서를 하나로 식별할 수 없습니다. 중복으로 열린 사본을 확인하세요.")
    app, doc = matches[0]
    doc.SetActive_XHwpDocument()
    if str(Path(str(app.XHwpDocuments.Active_XHwpDocument.FullName)).resolve()).lower() != target:
        raise ValueError("현재 한글 문서가 요청한 파일과 다릅니다.")
    return app, doc


def apply(app, name, values):
    action = app.CreateAction(name)
    params = action.CreateSet()
    for key, value in values.items():
        params.SetItem(key, value)
    if not action.Execute(params):
        raise ValueError("한글 동작 실패: " + name)


def selected_text(app):
    # GetTextFile exports to memory; tracked documents otherwise display a
    # conversion warning even for a selection. Restore the user's mode promptly.
    previous = app.GetMessageBoxMode()
    try:
        app.SetMessageBoxMode(0x00010000)
        return app.GetTextFile("TEXT", "saveblock").rstrip("\r\n")
    finally:
        app.SetMessageBoxMode(previous)


def select_paragraph(app, target):
    previous = app.GetMessageBoxMode()
    try:
        # RepeatFind can ask whether to wrap at the document end even with
        # IgnoreMessage. Refuse wrap prompts in this hidden native operation.
        app.SetMessageBoxMode(0x00020000)
        return _select_paragraph(app, target)
    finally:
        app.SetMessageBoxMode(previous)


def _select_paragraph(app, target):
    value = target["text"].strip()
    if not value or len(value) > 10000:
        raise ValueError("글자 서식을 적용할 문단 내용을 먼저 읽으세요.")
    app.HAction.Run("Cancel")
    cached=target.get('position')
    if cached and len(cached)==6:
        try:
            app.SetPos(cached[0],cached[1],0);app.HAction.Run('MoveSelParaEnd')
            whole=selected_text(app).strip()
            app.SetPos(cached[0],cached[1],cached[2]);app.SelectText(cached[1],cached[2],cached[4],cached[5])
            if whole==value and selected_text(app)==value:return (True,*cached)
        except (pythoncom.com_error,ValueError):
            pass
        app.HAction.Run('Cancel')
    app.MovePos(2, 0, 0)
    action = app.CreateAction("RepeatFind")
    params = action.CreateSet()
    action.GetDefault(params)
    for key, item in {"FindString": value, "Direction": 0, "IgnoreMessage": 1, "FindType": 1}.items():
        params.SetItem(key, item)
    positions, seen = [], set()
    while len(seen) < 10000 and action.Execute(params):
        selected = tuple(app.GetSelectedPos())
        if len(selected) != 7 or not selected[0] or selected[1] != selected[4] or selected[2] != selected[5]:
            raise ValueError("한글이 정확한 문단 범위를 선택하지 못했습니다.")
        if selected in seen:
            break
        seen.add(selected)
        # Find may also match part of a longer paragraph. Only whole paragraphs
        # from the CVD line are eligible; restore the search selection afterward.
        app.SetPos(selected[1], selected[2], 0)
        app.HAction.Run("MoveSelParaEnd")
        paragraph = selected_text(app)
        app.SetPos(selected[1], selected[2], selected[3])
        app.SelectText(selected[2], selected[3], selected[5], selected[6])
        if paragraph.strip() == value:
            positions.append(selected)
            if len(positions)>target['occurrences']:
                raise ValueError('같은 내용의 문단이 여러 개입니다. CVD scope 또는 ID 기반 파일 편집을 사용하세요.')
    if len(positions) != target["occurrences"] or len(positions) <= target["occurrence"]:
        raise ValueError("읽은 문단과 실제 한글의 후보 수가 다릅니다. 원본 CVD patch 또는 scope 서식을 사용하세요.")
    selected = positions[target["occurrence"]]
    app.SetPos(selected[1], selected[2], selected[3])
    if not app.SelectText(selected[2], selected[3], selected[5], selected[6]):
        raise ValueError("대상 문단 선택 실패")
    actual = selected_text(app)
    if actual != value:
        raise ValueError("선택된 문단의 내용이 읽은 내용과 다릅니다.")
    return selected


def style(app, step, target):
    char, para = {}, {}
    allowed = {"name", "target_line_id", "font_size", "font_family", "bold", "italic", "underline", "text_color", "align"}
    if set(step) - allowed:
        raise ValueError("지원하지 않는 글자 서식 인자: " + ", ".join(sorted(set(step) - allowed)))
    if "font_size" in step:
        size = float(step["font_size"])
        if not 1 <= size <= 400:
            raise ValueError("글자 크기는 1~400pt로 지정하세요.")
        char["Height"] = round(size * 100)
    if "font_family" in step:
        family = str(step["font_family"]).strip()
        if not family or len(family) > 200:
            raise ValueError("글꼴 이름을 확인하세요.")
        for script in ("Hangul", "Latin", "Hanja", "Japanese", "Other", "Symbol", "User"):
            char["FaceName" + script] = family
            char["FontType" + script] = int(app.FontType("TTF"))
    for field, key in (("bold", "Bold"), ("italic", "Italic"), ("underline", "UnderlineType")):
        if field in step:
            if not isinstance(step[field], bool):
                raise ValueError(field + "는 true/false로 지정하세요.")
            char[key] = int(step[field])
    if "text_color" in step:
        value = str(step["text_color"])
        if not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
            raise ValueError("글자색은 #RRGGBB로 지정하세요.")
        char["TextColor"] = int(value[1:3], 16) | int(value[3:5], 16) << 8 | int(value[5:7], 16) << 16
    if "align" in step:
        align = {"justify": 0, "left": 1, "right": 2, "center": 3, "distribute": 4, "distribute_space": 5}.get(str(step["align"]).lower())
        if align is None:
            raise ValueError("문단 정렬을 확인하세요.")
        para["AlignType"] = align
    if not char and not para:
        raise ValueError("변경할 서식을 지정하세요.")
    selected = select_paragraph(app, target)
    if char:
        apply(app, "CharShape", char)
    if para:
        apply(app, "ParagraphShape", para)
    # Execute can return success even when a font from another font category
    # was ignored. Observe the applied values before claiming it was changed.
    for action_name, values in (("CharShape", char), ("ParagraphShape", para)):
        if not values:
            continue
        action = app.CreateAction(action_name)
        actual = action.CreateSet()
        action.GetDefault(actual)
        for key,value in values.items():
            if key.startswith("FontType") or key.startswith("FaceName") and key != "FaceNameHangul":
                continue
            if actual.Item(key) != value:
                raise ValueError("한글이 요청한 서식을 반영하지 않았습니다: " + key)
    return {"selection": selected[1:], "properties": {**char, **para}}


def image(app, step, target):
    from PIL import Image
    file = Path(step["image_path"]).resolve()
    if file.stat().st_size > 30 * 1024 * 1024:
        raise ValueError("그림은 30MB 이하로 지정하세요.")
    with Image.open(file) as source:
        source.verify()
    pictures, ctrl = [], app.HeadCtrl
    while ctrl is not None:
        if ctrl.CtrlID == "gso" and ctrl.UserDesc == "그림":
            pictures.append(ctrl)
        ctrl = ctrl.Next
    if len(pictures) != target["image_count"] or not 0 <= target["image_index"] < len(pictures):
        raise ValueError("읽은 그림 목록과 현재 문서의 그림이 다릅니다. 다시 읽으세요.")
    ctrl = pictures[target["image_index"]]
    anchor = ctrl.GetAnchorPos(0)
    anchor = tuple(anchor.Item(key) for key in ("List", "Para", "Pos"))
    dimensions = {}
    for field, key in (("width_mm", "Width"), ("height_mm", "Height")):
        if field in step:
            value = float(step[field])
            if not .1 <= value <= 2000:
                raise ValueError("그림 크기는 0.1~2000mm로 지정하세요.")
            dimensions[key] = round(value * 7200 / 25.4)
    if len(dimensions) == 1:
        old_width, old_height = ctrl.Properties.Item("Width"), ctrl.Properties.Item("Height")
        if "Width" in dimensions:
            dimensions["Height"] = round(dimensions["Width"] * old_height / old_width)
        else:
            dimensions["Width"] = round(dimensions["Height"] * old_width / old_height)
    app.HAction.Run("Cancel")
    app.SetPos(*anchor)
    if app.FindCtrl() != "gso" or app.CurSelectedCtrl.UserDesc != "그림":
        raise ValueError("대상 그림을 선택하지 못했습니다.")
    apply(app, "PictureChange", {"PicturePath": str(file), "PictureEmbed": 1})
    if dimensions:
        apply(app, "ShapeObjDialog", dimensions)
    changed = app.CurSelectedCtrl
    position = changed.GetAnchorPos(0)
    actual_anchor = tuple(position.Item(key) for key in ("List", "Para", "Pos"))
    actual_size = {key: changed.Properties.Item(key) for key in ("Width", "Height")}
    if actual_anchor != anchor or any(abs(actual_size[key]-value)>2 for key,value in dimensions.items()):
        raise ValueError("한글 그림의 위치 또는 크기 반영을 확인하지 못했습니다.")
    return {"anchor": anchor, "anchor_preserved": True, "size_hwpunit": actual_size}

def read_styles(app,targets):
    facts=[];deadline=time.monotonic()+8
    for target in targets:
        if time.monotonic()>deadline:break
        try:
            selected=select_paragraph(app,target)
            char=app.CreateAction('CharShape');c=char.CreateSet();char.GetDefault(c)
            para=app.CreateAction('ParagraphShape');p=para.CreateSet();para.GetDefault(p)
            fields={}
            height=c.Item('Height')
            if isinstance(height,(int,float)) and height>0:fields['font_size']=height/100
            family=c.Item('FaceNameHangul')
            if isinstance(family,str) and family:fields['font_family']=family
            for field,key in [('bold','Bold'),('italic','Italic'),('underline','UnderlineType')]:
                value=c.Item(key)
                if value in (0,1):fields[field]=bool(value)
            color=c.Item('TextColor')
            if isinstance(color,int) and 0<=color<=0xffffff:fields['text_color']='#%02X%02X%02X'%(color&255,(color>>8)&255,(color>>16)&255)
            align={0:'Justify',1:'Left',2:'Right',3:'Center',4:'Distribute',5:'DistributeSpace'}.get(p.Item('AlignType'))
            if align:fields['align']=align
            facts.append({'text':target['text'],'line_id':target['line_id'],'verified':True,'properties':fields,'position':selected[1:]})
        except Exception as error:facts.append({'text':target['text'],'line_id':target['line_id'],'verified':False,'error':str(error)})
    return {'facts':facts,'source':'live-hancom-selection','saved':False,'truncated':len(facts)<len(targets)}


def run(request):
    app, doc = application_for(request["path"])
    position, selected = tuple(app.GetPos()), tuple(app.GetSelectedPos())
    selected_control=None
    if request.get('action')=='read_styles':
        try:
            ctrl=app.CurSelectedCtrl
            if ctrl is not None:
                anchor=ctrl.GetAnchorPos(0);selected_control=tuple(anchor.Item(key) for key in ('List','Para','Pos'))
        except (pythoncom.com_error,AttributeError):pass
    try:
        if request.get('action')=='read_styles':return read_styles(app,request['targets'])
        step = request["step"]
        result = style(app, step, request["target"]) if step["name"] == "set_style" else image(app, step, request["target"])
        if request.get("save", True) and not doc.Save(True):
            raise ValueError("한글 편집 후 저장을 확인하지 못했습니다.")
        return {"status": "success", "name": step["name"], "saved": request.get("save", True), **result}
    finally:
        app.HAction.Run("Cancel")
        app.SetPos(*position)
        if len(selected) == 7 and selected[0] and selected[1] == selected[4]:
            app.SetPos(selected[1], selected[2], selected[3])
            app.SelectText(selected[2], selected[3], selected[5], selected[6])
        elif selected_control is not None:
            app.SetPos(*selected_control);app.FindCtrl()


if __name__ == "__main__":
    import os
    if os.environ.get("NARAE_HWP_DEBUG") == "1":
        import faulthandler
        faulthandler.dump_traceback_later(12)
    pythoncom.CoInitialize()
    try:
        print(json.dumps({"ok": True, "data": run(json.load(sys.stdin))}, ensure_ascii=False))
    except Exception as error:
        import traceback
        detail = traceback.format_exc() if os.environ.get("NARAE_HWP_DEBUG") == "1" else str(error)
        print(json.dumps({"ok": False, "error": detail}, ensure_ascii=False))
        sys.exit(1)
    finally:
        pythoncom.CoUninitialize()
