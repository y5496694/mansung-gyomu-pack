"""Local HWP/HWPX engine; PDF is an internal Hancom preview/output only."""
import base64,hashlib,json,os,shutil,subprocess,sys,tempfile,uuid
from pathlib import Path
from hwp_revision import revision_state
APP=Path(os.environ.get('NARAE_OFFICE_HOME',str(Path.home()/'AppData/Local/NaraeHangulOffice')))
CACHE=APP/'cache';CACHE.mkdir(parents=True,exist_ok=True)
PACKAGED_ENGINE=Path(__file__).resolve().parents[1]/'vendor'


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def hangul_job(job):
    ident = uuid.uuid4().hex
    job_path, result_path = CACHE / f"{ident}.job.json", CACHE / f"{ident}.result.json"
    job_path.write_text(json.dumps({"schema": 1, **job}, ensure_ascii=False), "utf-8")
    try:
        p = subprocess.run([sys.executable, str(Path(__file__).with_name('hwp_engine_job.py')), str(PACKAGED_ENGINE),str(job_path), str(result_path)],
                           capture_output=True, encoding="utf-8", errors="replace", timeout=120,
                           creationflags=0x08000000 if os.name == "nt" else 0,
                           env={**os.environ, "PYTHONUTF8": "1", "QT_QPA_PLATFORM": "offscreen"})
        result = json.loads(result_path.read_text("utf-8-sig")) if result_path.exists() else {}
        if p.returncode or not result.get("success"):
            raise ValueError(result.get("error", p.stderr[-1500:] or p.stdout[-1500:]))
        return result
    finally:
        job_path.unlink(missing_ok=True)
        result_path.unlink(missing_ok=True)

def open_pdf(p, req):
    import io,pypdfium2
    with pypdfium2.PdfDocument(p) as doc:
        number=min(max(0,int(req.get('page',0))),len(doc)-1)
        page=doc[number]
        try:
            bitmap=page.render(scale=1.4);image=bitmap.to_pil();buffer=io.BytesIO();image.save(buffer,format='PNG')
            textpage=page.get_textpage();text=textpage.get_text_range();textpage.close()
            width,height=page.get_size();image.close();bitmap.close()
        finally:page.close()
        return {'kind':'pdf','page':number,'pages':len(doc),'width':width,'height':height,'image':base64.b64encode(buffer.getvalue()).decode(),'text':text,'blocks':[]}

def check_source(req):
    source=Path(req['path']).resolve()
    if not source.is_file():raise ValueError('파일을 찾을 수 없습니다.')
    if source.suffix.lower() not in {'.hwp','.hwpx'}:
        if source.suffix.lower()!='.pdf' or not source.is_relative_to(CACHE.resolve()):
            raise ValueError('한글 HWP/HWPX 문서만 지원합니다.')
    if req.get('expectedHash') and sha(source)!=req['expectedHash']:raise ValueError('다른 프로그램에서 파일이 변경되었습니다. 다시 읽어 주세요.')
    return source

def inspect(req):
    source=check_source(req)
    if source.suffix.lower()=='.pdf':data=open_pdf(source,req)
    elif req.get('previewOnly'):data={'kind':'hangul','blocks':[],'tables':[],'view':'native','textDetailsLoaded':False}
    elif (revision:=revision_state(source)):
        data={'kind':'hangul','blocks':[],'tables':[],'images':[],'view':'native','textDetailsLoaded':False,'revisionState':revision,'limitations':[revision['guidance']]}
    else:
        result=hangul_job({'action':'inspect','input':str(source)})
        data={'kind':'hangul','blocks':[{'id':item['id'],'text':item.get('text',''),'editable':item.get('editable_text',False),
              'textStyle':next((run['text_style'] for run in item.get('runs',[]) if run.get('text')),item['text_style']),
              'defaultTextStyle':item['text_style'],'paragraphStyle':item['paragraph_style'],
              'runs':[{'text':run.get('text',''),'textStyle':run['text_style'],'image':run.get('image',False),'field':run.get('field',False)} for run in item.get('runs',[])]} for item in result['paragraphs']],
              'tables':result['tables'],'images':result.get('images',[]),'limitations':result['limitations'],'textDetailsLoaded':True}
    return {**data,'path':str(source),'name':source.name,'hash':sha(source),'bytes':source.stat().st_size}

def commit(source,target,generated,original,overwrite=False):
    if sha(source)!=original:raise ValueError('처리 중 원본이 변경되어 저장하지 않았습니다. 다시 읽어 주세요.')
    if target.exists() and target!=source and not overwrite:raise ValueError('대상 파일이 이미 있습니다.')
    details={};target.parent.mkdir(parents=True,exist_ok=True)
    if target.exists():
        backups=APP/'data'/'backups';backups.mkdir(parents=True,exist_ok=True)
        backup=backups/(uuid.uuid4().hex+'-'+target.name);shutil.copy2(target,backup);details['backup']=str(backup)
    handle,stage=tempfile.mkstemp(prefix='.narae-',suffix=target.suffix,dir=target.parent);os.close(handle)
    try:shutil.copy2(generated,stage);os.replace(stage,target)
    finally:Path(stage).unlink(missing_ok=True)
    return {'path':str(target),'hash':sha(target),**details}

def save(req):
    if not req.get('expectedHash'):raise ValueError('최신 읽기의 expectedHash가 필요합니다.')
    source=check_source(req);original=sha(source);target=Path(req.get('target') or source).resolve()
    if source.suffix.lower() not in {'.hwp','.hwpx'} or target.suffix.lower()!=source.suffix.lower():raise ValueError('원본과 같은 HWP/HWPX 형식으로 저장하세요.')
    if (revision:=revision_state(source)):raise ValueError(revision['guidance'])
    if req.get('operations') and req.get('changes'):raise ValueError('changes와 operations 중 하나만 지정하세요.')
    operations=list(req.get('operations') or [])
    for change in req.get('changes',[]):
        operations.append({'op':'set_text','target':change['id'],'text':change['text']})
        style={key:change[name] for name,key in [('bold','bold'),('size','size')] if name in change}
        if style:operations.append({'op':'format','target':change['id'],'text_style':style})
    advanced=[op for op in operations if op.get('op') in {'merge_cells','set_cell_style','insert_row','delete_row'}]
    if advanced and source.suffix.lower()!='.hwpx':raise ValueError('파일 엔진의 표 구조 편집은 HWPX만 지원합니다. HWP는 열린 한글의 CVD patch를 사용하세요.')
    if advanced and len(advanced)!=len(operations):raise ValueError('표 구조와 텍스트/서식은 별도 요청하세요. 구조 변경 후 새 ID를 읽어야 합니다.')
    if advanced:
        import zipfile
        with zipfile.ZipFile(source) as archive:
            sections=[name for name in archive.namelist() if name.startswith('Contents/section') and name.endswith('.xml')]
        if len(sections)!=1:raise ValueError('여러 구역의 표 구조는 열린 한글의 CVD 도구로 편집하세요. 파일 엔진은 한 구역만 지원합니다.')
        if len(advanced)!=1:raise ValueError('표 구조 작업은 한 번에 하나씩 실행하고 변경 후 새 표를 읽으세요.')
        op=advanced[0];inventory=hangul_job({'action':'inspect','input':str(source)})
        index=op.get('table_index')
        if type(index) is not int or not 0<=index<len(inventory['tables']):raise ValueError('읽은 표의 table_index를 0부터 지정하세요.')
        table=inventory['tables'][index];kind=op['op']
        keys={'merge_cells':{'op','table_index','start_row','start_col','row_span','col_span','text','vertical_align'},
              'set_cell_style':{'op','table_index','row','col','vertical_align','padding_mm','width_mm','height_mm'},
              'insert_row':{'op','table_index','row_index','height_mm'},'delete_row':{'op','table_index','row_index'}}
        if set(op)-keys[kind]:raise ValueError('지원하지 않는 표 편집 인자입니다.')
        def integer(name,limit):
            value=op.get(name)
            if type(value) is not int or not 0<=value<limit:raise ValueError('표 범위 밖의 '+name+'입니다.')
            return value
        if kind in {'insert_row','delete_row'}:
            row=integer('row_index',table['rows']+(kind=='insert_row'))
            if kind=='delete_row' and table['rows']<2:raise ValueError('표의 마지막 행은 삭제할 수 없습니다.')
            if any(cell['row_span']>1 for cell in table['cells']):raise ValueError('세로 병합이 있는 표의 행 변경은 열린 한글의 CVD 도구를 사용하세요.')
        else:
            row=integer('start_row' if kind=='merge_cells' else 'row',table['rows']);col=integer('start_col' if kind=='merge_cells' else 'col',table['columns'])
            if not any(cell['row']==row and cell['column']==col for cell in table['cells']):raise ValueError('병합 셀의 시작 행/열을 지정하세요.')
            if kind=='merge_cells':
                rs,cs=op.get('row_span',1),op.get('col_span',1)
                if type(rs) is not int or type(cs) is not int or rs<1 or cs<1 or row+rs>table['rows'] or col+cs>table['columns']:raise ValueError('병합 범위가 표를 벗어납니다.')
                for cell in table['cells']:
                    r,c=cell['row'],cell['column'];rr,cc=r+cell['row_span'],c+cell['col_span']
                    if r<row+rs and rr>row and c<col+cs and cc>col and not (row<=r and rr<=row+rs and col<=c and cc<=col+cs):raise ValueError('기존 병합 셀의 일부만 다시 병합할 수 없습니다.')
        if 'vertical_align' in op and op['vertical_align'] not in {'TOP','CENTER','BOTTOM'}:raise ValueError('셀 세로 정렬을 확인하세요.')
        for key in ['width_mm','height_mm']:
            if key in op and (type(op[key]) not in (int,float) or not 0<op[key]<=2000):raise ValueError('셀 크기를 양수 mm로 지정하세요.')
        if 'padding_mm' in op and (not isinstance(op['padding_mm'],list) or len(op['padding_mm'])!=4 or any(type(v) not in (int,float) or not 0<=v<=100 for v in op['padding_mm'])):raise ValueError('셀 여백은 0~100mm 숫자 네 개로 지정하세요.')
    with tempfile.TemporaryDirectory(prefix='hwp-save-',dir=CACHE) as folder:
        generated=Path(folder)/source.name
        result=hangul_job({'action':'edit','input':str(source),'output':str(generated),'operations':operations,'expected_input_sha256':original})
        if advanced:
            actual=result['tables'][index]
            expected_rows=table['rows']+(1 if kind=='insert_row' else -1 if kind=='delete_row' else 0)
            if actual['rows']!=expected_rows or actual['columns']!=table['columns']:raise ValueError('표 편집 후 행/열 검증에 실패했습니다. 원본은 저장하지 않았습니다.')
            if kind=='merge_cells' and not any(c['row']==row and c['column']==col and c['row_span']==rs and c['col_span']==cs for c in actual['cells']):raise ValueError('병합 결과 검증에 실패했습니다. 원본은 저장하지 않았습니다.')
        saved=commit(source,target,generated,original,req.get('overwrite',False))
    return {**saved,'modeledContentVerified':result.get('modeled_content_verified'),'saved':True,'operations':len(operations),'guidance':'파일에 저장했습니다. read_document로 새 해시와 ID를 읽고 요청한 변경을 확인하세요.'}

def create(req):
    target=Path(req['path']).resolve()
    if target.suffix.lower() not in {'.hwp','.hwpx'}:raise ValueError('새 문서는 HWP/HWPX 형식으로 만드세요.')
    if target.exists():raise ValueError('같은 이름의 파일이 이미 있습니다.')
    target.parent.mkdir(parents=True,exist_ok=True)
    title=req.get('title') or target.stem;content=req.get('content','')
    blocks=req.get('blocks')
    if blocks is None:
        blocks=[{'type':'paragraph','text':title,'text_style':{'font':'맑은 고딕','size':20,'bold':True}}]
        blocks += [{'type':'paragraph','text':line} for line in (content.splitlines() or [''])]
    # Build in a disposable file; a failed writer must never leave a partial
    # document at the user's destination or overwrite a concurrently made file.
    with tempfile.TemporaryDirectory(prefix='hwp-create-',dir=CACHE) as folder:
        generated=Path(folder)/target.name
        verified=hangul_job({'action':'create','format':target.suffix[1:],'output':str(generated),'blocks':blocks,**({'page':req['page']} if 'page' in req else {})})
        with target.open('xb') as output:output.write(generated.read_bytes())
    return {'path':str(target),'hash':sha(target),'modeledContentVerified':verified.get('modeled_content_verified',False)}

def export(req):
    source=check_source(req);target=Path(req['target']).resolve();original=sha(source)
    if target.suffix.lower()!='.pdf':raise ValueError('한글 문서의 PDF 사본 경로를 지정하세요.')
    if target.exists() and not req.get('overwrite'):raise ValueError('같은 이름의 파일이 이미 있습니다.')
    existing=sha(target) if target.exists() else None
    with tempfile.TemporaryDirectory(prefix='hwp-export-',dir=CACHE) as folder:
        generated=Path(folder)/'output.pdf'
        if source.suffix.lower()=='.pdf':shutil.copy2(source,generated)
        else:
            from hangul_preview import export_pages
            export_pages(source,generated)
        import pypdfium2
        with pypdfium2.PdfDocument(generated) as pdf:
            pages=len(pdf)
            if not pages:raise ValueError('한글 출력에 쪽이 없습니다.')
        if (sha(target) if target.exists() else None)!=existing:raise ValueError('출력 대상이 다른 프로그램에서 변경되었습니다.')
        result=commit(source,target,generated,original,req.get('overwrite',False))
    return {**result,'bytes':target.stat().st_size,'pages':pages,'engine':'hancom-hwp'}

def dispatch(req):
    action=req.get('action')
    if action=='create':return create(req)
    if action=='inspect':return inspect(req)
    if action=='save':return save(req)
    if action=='export':return export(req)
    if action in {'previewNativeHangul','previewHangul'}:
        from hangul_preview import export_pages
        source=check_source(req)
        if source.suffix.lower() not in {'.hwp','.hwpx'}:raise ValueError('한글 HWP/HWPX 문서만 지원합니다.')
        if action=='previewNativeHangul':return export_pages(source,req['target'])
        target=CACHE/(sha(source)+'.pdf')
        if not target.exists():export_pages(source,target)
        return {'image':open_pdf(target,{'page':max(0,int(req.get('page',1))-1)})['image']}
    raise ValueError('한글 HWP/HWPX 기능만 이식합니다.')

if __name__=='__main__':
    try:print(json.dumps({'ok':True,'data':dispatch(json.load(sys.stdin))},ensure_ascii=False,default=str))
    except Exception as error:
        print(json.dumps({'ok':False,'error':str(error)},ensure_ascii=False));sys.exit(1)
