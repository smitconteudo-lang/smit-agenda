import {accountReady,publishingOn,validatePublication} from './backend.mjs';
import {unseal} from './meta.mjs';

const scopes={instagram:'instagram_content_publish',facebook_page:'pages_manage_posts',linkedin:'w_organization_social',youtube:'https://www.googleapis.com/auth/youtube.force-ssl'};
const refreshProviders={youtube:'GOOGLE',linkedin:'LINKEDIN'};

export function accountReadiness(account,secret,config,now=Date.now()){
 const missing=[];
 const provider=refreshProviders[account.channel];
 let renewable=false;
 if(provider&&secret?.ciphertext){
  try{
   const credential=unseal(secret.ciphertext,config('SMIT_TOKEN_ENCRYPTION_KEY'),'account:'+account.id);
   renewable=typeof credential.refresh_token==='string'&&credential.refresh_token.length>0;
  }catch{
   missing.push('Reconectar a conta para restaurar o acesso no servidor.');
  }
 }
 if(!account.verified_at)missing.push('Verificar a identidade da conta no provedor.');
 if(!secret)missing.push('Reconectar a conta para salvar o acesso no servidor.');
 if(secret?.expires_at&&Date.parse(secret.expires_at)<=now&&!renewable)missing.push('Acesso expirado: reconectar a conta.');
 if(!scopes[account.channel])missing.push('Esta rede ainda não tem integração de publicação.');
 else if(!(account.scopes||[]).includes(scopes[account.channel]))missing.push('Conceder a permissão de publicação e reconectar a conta.');
 if(provider&&(!config('SMIT_'+provider+'_CLIENT_ID')||!config('SMIT_'+provider+'_CLIENT_SECRET')))missing.push('Concluir a configuração do aplicativo oficial.');
 if(['instagram','facebook_page'].includes(account.channel)&&(!config('SMIT_META_APP_SECRET')||!config('SMIT_META_API_VERSION')))missing.push('Concluir a configuração do aplicativo Meta no servidor.');
 if(account.channel==='linkedin'&&!config('SMIT_LINKEDIN_API_VERSION'))missing.push('Configurar a versão da API LinkedIn.');
 if(!publishingOn(config))missing.push('Ativar o processamento automático no servidor.');
 return {publishing_enabled:!missing.length&&accountReady(account,config),connection_issues:missing,expires_at:secret?.expires_at||null,renewable,required_permission:scopes[account.channel]||null,verification_kind:'identity'};
}

export function inspectDestinations({post,accounts,media,secrets,jobs=[],settings={},at,config,now=Date.now()}){
 return accounts.map(a=>{
  const secret=secrets.find(s=>s.account_id===a.id),state=accountReadiness(a,secret,config,now),issues=[...state.connection_issues];let snapshot=null;
  if(jobs.some(j=>j.status!=='cancelled'))issues.push('Esta versão já possui fila ou resultado de envio. Cancele os pendentes ou salve uma nova versão antes de agendar novamente.');
  // The worker renews access when the token is within two minutes of expiry.
  if(state.expires_at&&!state.renewable&&Date.parse(state.expires_at)<=+at+120000)issues.push('O acesso precisa ser renovado para o horário escolhido. Reconecte a conta.');
  try{snapshot=validatePublication(post,a,media,settings[a.id]||{});}catch(e){issues.push(e.status?e.message:'Confira os campos e as mídias desta publicação.');}
  return {account_id:a.id,channel:a.channel,name:a.name,ok:issues.length===0,issues:[...new Set(issues)],snapshot};
 });
}
