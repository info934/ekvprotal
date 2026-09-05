import { useCallback, useEffect, useRef, useState } from 'react';
import { attendanceErrorMessage } from '@/lib/attendanceWorkspace';

export function useAttendanceResource(key, loader, enabled = true) {
  const [state, setState] = useState({ key: null, status: 'loading', data: null, error: '' });
  const [revision, setRevision] = useState(0);
  const sequence = useRef(0);
  useEffect(() => {
    const request = ++sequence.current;
    const controller = new AbortController();
    if (!enabled) { setState({ key, status: 'idle', data: null, error: '' }); return () => controller.abort(); }
    setState({ key, status: 'loading', data: null, error: '' });
    const timeout = setTimeout(() => {
      if (sequence.current !== request) return;
      controller.abort();
      setState({ key, status: 'error', data: null, error: 'Načítání trvá příliš dlouho. Zkontrolujte připojení a zkuste přehled obnovit.' });
    }, 30000);
    Promise.resolve().then(() => loader(controller.signal)).then(data => {
      if (!controller.signal.aborted && sequence.current === request) setState({ key, status: 'ready', data, error: '' });
    }).catch(error => {
      if (!controller.signal.aborted && sequence.current === request) setState({ key, status: 'error', data: null, error: attendanceErrorMessage(error) });
    }).finally(() => clearTimeout(timeout));
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [key, loader, revision, enabled]);
  const refresh = useCallback(() => {
    ++sequence.current;
    setState(current => ({ ...current, status: 'loading', data: null, error: '' }));
    setRevision(value => value + 1);
  }, []);
  const visible = state.key === key ? state : { status: 'loading', data: null, error: '' };
  return { ...visible, ready: visible.status === 'ready', loading: visible.status === 'loading', refresh };
}
