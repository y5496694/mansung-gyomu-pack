"""Insert a confirmed transparent signature behind text in a saved HWP/HWPX copy."""
import math
from pathlib import Path
import tempfile


def placement(req, image_size):
    def number(key, default=None, minimum=-500, maximum=2000):
        value=req.get(key,default)
        if type(value) not in (int,float) or not math.isfinite(value) or not minimum<=value<=maximum:
            raise ValueError(key+'를 유효한 mm 숫자로 지정하세요.')
        return value
    width=number('width_mm',20,0.1,300)
    height=number('height_mm',width*image_size[1]/image_size[0],0.1,300)
    # Hancom ShapeObject: paper=0, left/top=0, BehindText=2.
    unit=lambda mm:round(mm*7200/25.4)
    return {'TreatAsChar':0,'TextWrap':2,'HorzRelTo':0,'VertRelTo':0,
            'HorzAlign':0,'VertAlign':0,'HorzOffset':unit(number('x_mm')),
            'VertOffset':unit(number('y_mm')),'Width':unit(width),'Height':unit(height),
            'AffectsLine':0,'AllowOverlap':1,'FlowWithText':0,
            'OutsideMarginLeft':0,'OutsideMarginRight':0,'OutsideMarginTop':0,'OutsideMarginBottom':0}


def picture_controls(app):
    result=[]
    ctrl=app.HeadCtrl
    while ctrl is not None:
        if ctrl.CtrlID=='gso' and ctrl.UserDesc=='그림':result.append(ctrl)
        ctrl=ctrl.Next
    return result


def apply_picture_properties(picture, values):
    properties=picture.Properties
    for key,value in values.items():properties.SetItem(key,value)
    picture.Properties=properties
    actual={key:picture.Properties.Item(key) for key in values}
    if any(abs(actual[key]-value)>1 for key,value in values.items()):
        raise ValueError('그림의 글 뒤로·위치·크기 적용을 확인하지 못했습니다: '+str(actual))
    return actual


def document_text(app):
    mode=app.GetMessageBoxMode()
    try:
        app.SetMessageBoxMode(0x00010000)
        return app.GetTextFile('TEXT','').replace('\ufffc','')
    finally:app.SetMessageBoxMode(mode)


def insert_signature(req):
    import pythoncom
    from PIL import Image
    from documents import check_source,sha,commit,CACHE
    from hwp_revision import revision_state
    from hwp_app import open_owned_document,close_app
    from live_hangul import select_text

    if not req.get('expectedHash'):raise ValueError('최신 inspect 해시가 필요합니다.')
    source=check_source(req)
    if not req.get('target'):raise ValueError('서명한 사본의 output 경로를 지정하세요.')
    target=Path(req['target']).resolve()
    if target==source or target.suffix.lower()!=source.suffix.lower():
        raise ValueError('원본과 다른 경로의 같은 한글 형식 사본으로 저장하세요.')
    if target.exists() and not req.get('overwrite'):raise ValueError('출력 파일이 이미 있습니다.')
    if revision_state(source):raise ValueError('변경 추적 문서의 서명은 지원하지 않습니다.')
    image=Path(req.get('image_path','')).resolve()
    if image.suffix.lower()!='.png' or not image.is_file() or image.stat().st_size>30*1024*1024:
        raise ValueError('30MB 이하의 투명 PNG를 지정하세요.')
    with Image.open(image) as png:
        png.load()
        if png.mode!='RGBA' or png.getchannel('A').getextrema()[0]!=0 or png.getchannel('A').getbbox() is None:
            raise ValueError('투명 배경과 실제 획이 있는 RGBA PNG가 필요합니다.')
        values=placement(req,png.size)
    text=req.get('anchor_text')
    expected=req.get('expected_count',1);occurrence=req.get('occurrence',0)
    if not isinstance(text,str) or not text:raise ValueError('서명 위치를 확인할 정확한 anchor_text가 필요합니다.')
    original=sha(source)
    image_hash=sha(image)
    pythoncom.CoInitialize()
    app=child=None
    try:
        app,child,_=open_owned_document(source)
        before=document_text(app);pages=int(app.PageCount)
        count=len(picture_controls(app))
        selected=select_text(app,text,expected,occurrence)
        app.HAction.Run('Cancel');app.SetPos(*selected[1:4])
        picture=app.InsertPicture(str(image),True,1,False,False,0,
                                  values['Width']*25.4/7200,values['Height']*25.4/7200)
        if picture is None:raise ValueError('서명 그림 삽입에 실패했습니다.')
        actual=apply_picture_properties(picture,values)
        anchor=picture.GetAnchorPos(0)
        anchor_pos=tuple(anchor.Item(key) for key in ('List','Para','Pos'))
        if document_text(app)!=before or int(app.PageCount)!=pages:
            raise ValueError('서명 삽입 중 본문 또는 쪽 수가 바뀌어 저장하지 않았습니다.')
        with tempfile.TemporaryDirectory(prefix='narae-signature-',dir=CACHE) as folder:
            generated=Path(folder)/source.name
            fmt='HWPX' if source.suffix.lower()=='.hwpx' else 'HWP'
            if not app.SaveAs(str(generated),fmt,''):raise ValueError('한글 서명 사본 저장에 실패했습니다.')
            close_app(app,child);app=child=None
            app,child,_=open_owned_document(generated)
            pictures=picture_controls(app)
            if len(pictures)!=count+1:raise ValueError('저장 후 그림 개수가 일치하지 않습니다.')
            candidates=[]
            for ctrl in pictures:
                pos=ctrl.GetAnchorPos(0)
                if tuple(pos.Item(k) for k in ('List','Para','Pos'))==anchor_pos:candidates.append(ctrl)
            if len(candidates)!=1:raise ValueError('저장 후 서명 그림을 하나로 식별하지 못했습니다.')
            readback={key:candidates[0].Properties.Item(key) for key in values}
            if any(abs(readback[key]-value)>1 for key,value in values.items()):
                raise ValueError('저장 후 서명의 글 뒤로·위치·크기 속성이 다릅니다.')
            if document_text(app)!=before or int(app.PageCount)!=pages:
                raise ValueError('저장 후 본문 또는 쪽 수가 일치하지 않습니다.')
            close_app(app,child);app=child=None
            if sha(image)!=image_hash:raise ValueError('서명 이미지가 처리 중 변경되었습니다.')
            saved=commit(source,target,generated,original,req.get('overwrite',False))
        return {**saved,'saved':True,'verified':True,'image_sha256':image_hash,
                'anchor_text':text,'placement':'BEHIND_TEXT','treat_as_char':False,
                'properties':readback,'pages':pages,'text_preserved':True}
    finally:
        if app is not None:close_app(app,child)
        pythoncom.CoUninitialize()
