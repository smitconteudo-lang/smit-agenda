import { createHash, timingSafeEqual } from 'node:crypto';
export function csrf(token){return createHash('sha256').update('smit-csrf:'+token).digest('hex');}
export function equal(a,b){const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&timingSafeEqual(x,y);}
export function cookieToken(header=''){const m=header.match(/(?:^|;\s*)__Host-smit_session=([^;]+)/);if(!m)return '';let t;try{t=decodeURIComponent(m[1]);}catch{return '';}return /^[A-Za-z0-9_.-]{50,3500}$/.test(t)?t:'';}
export function sameOrigin(request,base){return request.headers.get('origin')===new URL(base).origin;}
export function allowedEmail(email,list){return list.split(',').map(x=>x.trim().toLowerCase()).filter(Boolean).includes(String(email).toLowerCase());}
export function localDate(value){if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw Error('Data inválida.');const d=new Date(value+':00-03:00');if(!Number.isFinite(+d)||new Date(+d-10800000).toISOString().slice(0,16)!==value)throw Error('Data inválida.');return d;}
