"""Export document pages, ignoring saved N-up print settings.

SaveAs(PDF) on this PC preserves PrintMethod=4 and turns a portrait 3-page
document into two landscape sheets. PrintToPDFEx with PrintMethod=0 renders
one actual document page per PDF page. Only the Hancom PDF target is used.
"""
from pathlib import Path
import hashlib
import time


def print_open_document(app,target):
    import pythoncom
    import win32print
    import pypdfium2
    target=Path(target).resolve()
    printers = [item[2] for item in win32print.EnumPrinters(win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS)]
    if "Hancom PDF" not in printers:
        raise ValueError("설치된 Hancom PDF 가상 프린터를 찾을 수 없습니다.")
    pages=int(app.PageCount)
    action=app.CreateAction('PrintToPDFEx');settings=action.CreateSet();action.GetDefault(settings)
    original_method=settings.Item('PrintMethod')
    for name,value in {"FileName":str(target),"PrinterName":"Hancom PDF","PrintMethod":0,
                       "Range":0,"Collate":1,"UserOrder":0,"PrintToFile":0,"NumCopy":1,
                       "UsingPagenum":0,"ReverseOrder":0,"Pause":0,"PrintImage":1,
                       "PrintDrawObj":1,"PrintMemo":0,"PrintMemoContents":0}.items():settings.SetItem(name,value)
    if settings.Item('PrinterName')!='Hancom PDF':raise ValueError('PDF 출력 대상이 Hancom PDF가 아닙니다.')
    if not action.Execute(settings):raise ValueError('한글의 문서 쪽 PDF 출력을 완료하지 못했습니다.')
    deadline=time.monotonic()+30;last_error='PDF 파일을 기다리고 있습니다.'
    while time.monotonic()<deadline:
        try:
            with target.open('rb') as output:
                output.seek(0,2);length=output.tell();output.seek(max(0,length-65536));complete=b'%%EOF' in output.read()
            if complete:
                with pypdfium2.PdfDocument(target) as pdf:
                    count=len(pdf)
                    if count==pages:
                        sizes=[]
                        for index in range(count):
                            page=pdf[index]
                            try:sizes.append(list(page.get_size()))
                            finally:page.close()
                        break
                    last_error=f'한글 문서 쪽 수({pages})와 PDF 쪽 수({count})가 다릅니다.'
        except Exception as error:last_error=str(error)
        pythoncom.PumpWaitingMessages();time.sleep(.1)
    else:raise ValueError('한글 PDF 출력 완료를 확인하지 못했습니다: '+last_error)
    return {'path':str(target),'engine':'hancom-single-page-native','pages':count,'page_sizes':sizes,
            'source_print_method':original_method,'preview_print_method':0}


def export_pages(source, target):
    import pythoncom
    source, target = Path(source).resolve(), Path(target).resolve()
    original_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    pythoncom.CoInitialize()
    app = None
    try:
        from hwp_app import open_owned_document,close_app
        app,owned_process,open_attempts = open_owned_document(source,'lock:false')
        result=print_open_document(app,target)
        if hashlib.sha256(source.read_bytes()).hexdigest() != original_hash:
            raise ValueError("PDF 변환 중 원본이 변경되었습니다.")
        import win32api
        executable=str(owned_process.args[0]);version=win32api.GetFileVersionInfo(executable,'\\')
        numbers=[version['FileVersionMS']>>16,version['FileVersionMS']&65535,version['FileVersionLS']>>16,version['FileVersionLS']&65535]
        return {**result,"source_hash":original_hash,"source_unchanged":True,"native_version":'.'.join(map(str,numbers)),"native_executable":executable,"owned_pid":owned_process.pid,"open_attempts":open_attempts}
    finally:
        if app is not None:
            close_app(app,owned_process)
        pythoncom.CoUninitialize()
