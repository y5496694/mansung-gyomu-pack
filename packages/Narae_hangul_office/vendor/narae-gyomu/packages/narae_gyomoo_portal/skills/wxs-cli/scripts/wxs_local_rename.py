"""Byte-identical replacement of one unsent, unassigned local PDF attachment."""
import hashlib
from pathlib import Path

from wxs_final import fingerprint


def run(session, args):
    before = session.require_draft(args.expected_title)
    current = session.action('attachment_local_rename_info')
    source = Path(current['path']).resolve()
    target = args.new_path.resolve()
    if (current['name'] != args.old_name or source.name != args.old_name
            or source == target or target.suffix.lower() != '.pdf' or target.name == source.name):
        raise ValueError('Expected the exact old PDF and a distinct new PDF filename')
    original = source.read_bytes()
    renamed = target.read_bytes()
    if len(original) != current['size'] or original != renamed or not original.startswith(b'%PDF-'):
        raise ValueError('Rename sources must contain the same valid PDF bytes')
    binding = {'document': before, 'attachment': current, 'new_path': str(target),
               'new_name': target.name, 'sha256': hashlib.sha256(original).hexdigest()}
    preview = {'applied': False, 'fingerprint': fingerprint(binding), 'binding': binding}
    if not args.apply:
        return preview
    if not args.expected_fingerprint or args.expected_fingerprint != preview['fingerprint']:
        raise ValueError('Document, attachment or local source changed since preview')
    result = session.action('attachment_local_rename', {'expected': current, 'path': str(target), 'name': target.name})
    after = session.require_draft(args.expected_title)
    for field in ('title', 'task_card', 'disclosure', 'private_reasons', 'approval_rows', 'recipient', 'auto_send', 'body', 'document_text', 'page_count'):
        if before[field] != after[field]:
            raise ValueError('Unexpected draft change during rename; inspect before continuing')
    if result != {'name': target.name, 'path': str(target), 'size': current['size']}:
        raise ValueError('Renamed attachment readback differs; inspect before continuing')
    return {'applied': True, 'attachment': result, 'sha256': binding['sha256'],
            'document_preserved': True, 'server_saved': False, 'submission_attempted': False}
