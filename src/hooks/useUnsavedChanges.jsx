import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { draftSignature, forgetUnsavedDraft, internalFormDestination, readUnsavedDraft, rememberUnsavedDraft } from '@/lib/unsavedDrafts';

export function useUnsavedChanges({ draftKey, snapshot, readSnapshot, ready, busy = false, onRestore }) {
  const navigate = useNavigate();
  const signature = draftSignature(snapshot);
  const [baseline, setBaseline] = useState(null);
  const [destination, setDestination] = useState(null);
  const [recovery, setRecovery] = useState(null);
  const offeredKeys = useRef(new Set());
  const latestByKey = useRef(new Map());
  const current = useRef(null);
  const dirty = Boolean(ready && baseline?.key === draftKey && baseline.signature !== signature);
  current.current = { draftKey, snapshot, signature, dirty, busy, onRestore, readSnapshot };
  latestByKey.current.set(draftKey, { snapshot, dirty });

  useEffect(() => {
    if (!ready || baseline?.key === draftKey) return;
    // Controllers register their defaults after the parent render. Read the
    // committed form values rather than the earlier watch() render snapshot.
    const timer = setTimeout(() => {
      const latest = current.current;
      if (latest.draftKey !== draftKey) return;
      const committed = latest.readSnapshot?.() ?? latest.snapshot;
      setBaseline({ key: draftKey, signature: draftSignature(committed) });
    }, 0);
    return () => clearTimeout(timer);
  }, [baseline?.key, draftKey, ready, signature]);

  useEffect(() => {
    if (!ready || baseline?.key !== draftKey || offeredKeys.current.has(draftKey)) return;
    offeredKeys.current.add(draftKey);
    const saved = readUnsavedDraft(draftKey);
    if (saved && draftSignature(saved.snapshot) !== signature) setRecovery(saved);
    else if (saved) forgetUnsavedDraft(draftKey);
  }, [baseline?.key, draftKey, ready, signature]);

  useEffect(() => () => {
    const latest = latestByKey.current.get(draftKey);
    if (latest?.dirty) rememberUnsavedDraft(draftKey, latest.snapshot);
  }, [draftKey]);

  const requestLeave = useCallback(path => {
    if (current.current.busy) return;
    if (current.current.dirty) setDestination(path);
    else navigate(path);
  }, [navigate]);

  const markSaved = useCallback(() => {
    const latest = current.current;
    current.current.dirty = false;
    latestByKey.current.set(latest.draftKey, { snapshot: latest.snapshot, dirty: false });
    forgetUnsavedDraft(latest.draftKey);
    setBaseline({ key: latest.draftKey, signature: latest.signature });
  }, []);

  useEffect(() => {
    const handleUnload = event => {
      if (!current.current.dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const handleClick = event => {
      if (event.defaultPrevented || event.button !== 0 || !current.current.dirty) return;
      const anchor = event.target?.closest?.('a[href]');
      if (!anchor) return;
      const next = internalFormDestination(anchor.getAttribute('href'), window.location.href, {
        target: anchor.getAttribute('target'), download: anchor.hasAttribute('download'),
        modified: event.metaKey || event.ctrlKey || event.shiftKey || event.altKey,
      });
      if (!next) return;
      event.preventDefault();
      event.stopPropagation();
      requestLeave(next);
    };
    window.addEventListener('beforeunload', handleUnload);
    document.addEventListener('click', handleClick, true);
    return () => { window.removeEventListener('beforeunload', handleUnload); document.removeEventListener('click', handleClick, true); };
  }, [requestLeave]);

  const dialogs = <>
    <AlertDialog open={Boolean(destination)} onOpenChange={open => { if (!open) setDestination(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Opustit neuložené změny?</AlertDialogTitle><AlertDialogDescription>Ve formuláři máte rozpracované změny. Pokračujte v úpravách, nebo je zahoďte a přejděte na vybranou stránku.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>Pokračovat v úpravách</AlertDialogCancel><AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={() => { const next = destination; markSaved(); setDestination(null); navigate(next); }}>Zahodit změny a odejít</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog open={Boolean(recovery)} onOpenChange={open => { if (!open) { forgetUnsavedDraft(draftKey); setRecovery(null); } }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Obnovit rozpracovaný formulář?</AlertDialogTitle><AlertDialogDescription>Při předchozím odchodu zůstaly neuložené změny. Můžete je vrátit do formuláře a zkontrolovat před uložením. Rozpracované hodnoty jsou dočasně pouze v paměti této otevřené aplikace.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel onClick={() => { forgetUnsavedDraft(draftKey); setRecovery(null); }}>Ponechat načtená data</AlertDialogCancel><AlertDialogAction onClick={() => { current.current.onRestore(recovery.snapshot); forgetUnsavedDraft(draftKey); setRecovery(null); }}>Obnovit změny</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
  return { dirty, requestLeave, markSaved, dialogs };
}
