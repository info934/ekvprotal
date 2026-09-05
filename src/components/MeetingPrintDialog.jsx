import React,{useMemo,useRef,useState} from 'react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {meetingPrintHtml} from '@/lib/meetingPrint';
export default function MeetingPrintDialog({note,entityTitle,entityType,onClose}){
 const frame=useRef(null);const [ready,setReady]=useState(false);const [error,setError]=useState('');
 const html=useMemo(()=>meetingPrintHtml(note,{entityTitle,entityType}),[note,entityTitle,entityType]);
 const print=()=>{try{setError('');if(!frame.current?.contentWindow)throw new Error();frame.current.contentWindow.focus();frame.current.contentWindow.print();}catch{setError('Tisk se nepodařilo otevřít. Zkuste náhled zavřít a otevřít znovu.');}};
 return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent className="flex h-[90vh] max-w-4xl flex-col gap-3"><DialogHeader><DialogTitle>Tisk zápisu · verze {note.version}</DialogTitle><DialogDescription>V tiskovém dialogu můžete vybrat tiskárnu nebo uložení do PDF. Tiskne se uložená pracovní verze.</DialogDescription></DialogHeader><div className="flex flex-wrap items-center gap-2"><Button onClick={print} disabled={!ready}>Tisk / uložit do PDF</Button><Button variant="outline" onClick={onClose}>Zavřít náhled</Button>{error&&<p role="alert" className="text-sm text-red-700">{error}</p>}</div><iframe ref={frame} title={`Tiskový náhled zápisu ${note.title}, verze ${note.version}`} sandbox="allow-same-origin allow-modals" srcDoc={html} onLoad={()=>setReady(true)} className="min-h-0 w-full flex-1 rounded-lg border bg-slate-100"/></DialogContent></Dialog>;
}
