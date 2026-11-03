"""Resume only the same draft's already observed empty recipient selector."""
from urllib.parse import urlsplit

from wxs_config import string
from wxs_runtime import process_windows


def resume_selector(session, args, native):
    if bool(args.name) != bool(args.apply):
        raise ValueError('Exact --name and --apply must be supplied together')
    status = session.status()
    if (status['title'] != args.expected_title or status['app_type'] != 'sancgian'
            or status['processed'] is not False or status['edit_mode'] != 2
            or session.frame_errors or status['recipient'] not in ('', '내부결재')):
        raise ValueError('Expected the same editable draft with no external recipient')
    windows = [w for w in process_windows(session.window['pid'])
               if w['hwnd'] == args.dialog_hwnd and '수신자지정' in w['title']]
    if len(windows) != 1:
        raise ValueError('Expected the observed recipient dialog in the same process')
    docs, errors = native.documents(windows[0])
    if errors or not docs:
        raise ValueError('Recipient dialog frames could not be verified')
    root = docs[0][1]
    parsed = urlsplit(str(root.url))
    if (parsed.scheme != 'https' or parsed.netloc != session.origin_path.netloc
            or not parsed.path.endswith('/retrieveRcverSetup.do')
            or not session.action('ready', {'kind': 'open_recipient'}, root)):
        raise ValueError('Recipient dialog origin, path or controls changed')
    if args.query:
        string(args.query, 'recipient query')
        session.action('recipient_search', {'search': args.query}, root)
        return {'window': windows[0], 'search_requested': args.query, 'selected': False,
                'next': 'Inspect the same recipient dialog again for refreshed candidates'}
    candidates = session.action('recipient_candidates', root=root)
    if not args.apply:
        return {'window': windows[0], 'candidates': candidates, 'selected': False}
    string(args.name, 'recipient name')
    if candidates.count(args.name) != 1:
        raise ValueError('Expected one exact current recipient candidate')
    # The bounded native action rechecks RecptList.all.length == 0 before adding.
    session.action('recipient_select', {'name': args.name}, root)
    session.wait_closed(windows[0])
    after = session.status()
    if after['title'] != args.expected_title or not after['recipient'] or after['recipient'] == '내부결재':
        raise ValueError('Recipient readback did not confirm an external recipient')
    return {'applied': True, 'selected_candidate': args.name, 'status': after}
