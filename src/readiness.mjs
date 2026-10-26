import {accountReady,publishingOn,validatePublication} from './backend.mjs';

const scopes={instagram:'instagram_content_publish',facebook_page:'pages_manage_posts',linkedin:'w_organization_social',youtube:'https://www.googleapis.com/auth/youtube.force-ssl'};
export function accountReadiness(account,secret,config,now=Date.now()){
 const missing=[];
 if(!account.verified_at)missing.push('Verificar a identidade da conta no provedor.');
 if(!secret)missing.push('Reconectar a conta para salvar o acesso no servidor.');
 if(secret?.expires_at&&Date.parse(secret.expires_at)<=now)missing.push('Acesso expirado: reconectar a conta.');
 if(!scopes[account.channel])missing.push('Esta rede ainda não tem integração de publicação.');
 else if(!(account.scopes||[]).includes(scopes[account.channel]))missing.push('Conceder a permissão de publicação e reconectar a conta.');
 const provider={youtube:'GOOGLE',linkedin:'LINKEDIN'}[account.channel];
 if(provider&&(!config('SMIT_'+provider+'_CLIENT_ID')||!config('SMIT_'+provider+'_CLIENT_SECRET')))missing.push('Concluir a configuração do aplicativo oficial.');
 if(['instagram','facebook_page'].includes(account.channel)&&(!config('SMIT_META_APP_SECRET')||!config('SMIT_META_API_VERSION')))missing.push('Concluir a configuração do aplicativo Meta no servidor.');
 if(account.channel==='linkedin'&&!config('SMIT_LINKEDIN_API_VERSION'))missing.push('Configurar a versão da API LinkedIn.');
 if(!publishingOn(config))missing.push('Ativar o processamento automático no servidor.');
 return {publishing_enabled:!missing.length&&accountReady(account,config),connection_issues:missing,expires_at:secret?.expires_at||null,required_permission:scopes[account.channel]||null,verification_kind:'identity'};
}

export function inspectDestinations({post,accounts,media,secrets,jobs=[],settings={},at,config,now=Date.now()}){
 return accounts.map(a=>{
  const secret=secrets.find(s=>s.account_id===a.id),state=accountReadiness(a,secret,config,now),issues=[...state.connection_issues];let snapshot=null;
  if(jobs.some(j=>j.status!=='cancelled'))issues.push('Esta versão já possui fila ou resultado de envio. Cancele os pendentes ou salve uma nova versão antes de agendar novamente.');
  if(secret?.expires_at&&['instagram','facebook_page'].includes(a.channel)&&Date.parse(secret.expires_at)<+at)issues.push('O acesso expira antes do horário escolhido.');
  try{snapshot=validatePublication(post,a,media,settings[a.id]||{});}catch(e){issues.push(e.status?e.message:'Confira os campos e as mídias desta publicação.');}
  return {account_id:a.id,channel:a.channel,name:a.name,ok:issues.length===0,issues:[...new Set(issues)],snapshot};
 });
}
