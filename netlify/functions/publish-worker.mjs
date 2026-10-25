import {createHmac,timingSafeEqual} from 'node:crypto';
import {env,publishingOn} from '../../src/backend.mjs';
import {runWorker} from '../../src/worker.mjs';
export function validDispatch(req,now=Date.now()){
 const stamp=req.headers.get('X-SMIT-Time'),signature=req.headers.get('X-SMIT-Signature'),key=env('SMIT_TOKEN_ENCRYPTION_KEY');if(!key||!/^\d{13}$/.test(stamp||'')||Math.abs(now-Number(stamp))>60000||!/^[a-f0-9]{64}$/.test(signature||''))return false;const expected=createHmac('sha256',key).update('dispatch:'+stamp).digest();return timingSafeEqual(expected,Buffer.from(signature,'hex'));
}
export default async function(req){if(req.method!=='POST'||!validDispatch(req)||!publishingOn())return;await runWorker();}
export const config={path:'/internal/publish-worker',background:true,rateLimit:{action:'rate_limit',aggregateBy:'ip',windowSize:60,windowLimit:20}};
