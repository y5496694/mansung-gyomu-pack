"""Run the installed Narae Hangul engine with a process-local HWPX style fix.

The upstream structural guard classifies paragraph insertion/ending character
styles as immutable, although format() changes them alongside visible runs.
Permit those character-style fields through the guard. Keep the native writer
and all text, run-style, table, image, page and source-hash readback checks.
No installed engine file is modified.
"""
import copy,json,sys
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from hangeul import hwpx_native
from hangeul.automation import run_job
from hangeul import hwpx_advanced
from hwp_hwpx_tables import apply_advanced_hwpx_operations
hwpx_advanced.apply_advanced_hwpx_operations=apply_advanced_hwpx_operations

original_signature=hwpx_native._editable_signature
def editable_signature(data):
    result=copy.deepcopy(data)
    def visit(value):
        if isinstance(value,dict):
            if value.get('type')=='paragraph':
                value.pop('default_style',None)
                value.pop('end_style',None)
            for child in value.values():visit(child)
        elif isinstance(value,list):
            for child in value:visit(child)
    visit(result)
    return original_signature(result)
hwpx_native._editable_signature=editable_signature
try:
    job_path=Path(sys.argv[2]);result=run_job(json.loads(job_path.read_text('utf-8-sig')),base_dir=job_path.parent)
    result={'success':True,**result}
except Exception as error:
    result={'success':False,'error':str(error)}
Path(sys.argv[3]).write_text(json.dumps(result,ensure_ascii=False,default=str),'utf-8')
sys.exit(0 if result['success'] else 1)
