import {localDateKey} from '../domain/workOverview.js';
export function certificationState(certifications, today=localDateKey()) {
 if(!certifications?.length)return 'none';
 const horizon=new Date(`${today}T12:00:00`);horizon.setDate(horizon.getDate()+30);
 const soon=localDateKey(horizon);
 const dates=certifications.map(c=>c.expiry_date?.slice(0,10)).filter(Boolean);
 if(dates.some(d=>d<today))return 'expired';
 if(dates.some(d=>d<=soon))return 'soon';
 return 'valid';
}
export function matchesCertification(certifications,filter,today){
 const state=certificationState(certifications,today);
 return filter==='all'||(filter==='valid'?['valid','soon'].includes(state):state===filter);
}

export function directoryFilters(search){
 const p=new URLSearchParams(search);
 return {view:p.get('view')==='table'?'table':'grid',q:(p.get('q')||'').slice(0,250),role:(p.get('role')||'all').slice(0,200),cert:['valid','expired','soon','none'].includes(p.get('cert'))?p.get('cert'):'all'};
}
