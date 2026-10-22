// Netlify: 0 ignora o build; 1 continua. Sem dependências npm.
import {spawnSync} from 'node:child_process';
const before=process.env.CACHED_COMMIT_REF,after=process.env.COMMIT_REF;
if(!before||!after){console.log('Primeira implantação: construir.');process.exit(1);}
const result=spawnSync('git',['diff','--quiet',before,after,'--','public','netlify','src','scripts','package.json','package-lock.json','netlify.toml'],{stdio:'inherit'});
if(result.status===0){console.log('Somente documentação ou estrutura do banco: ignorar build.');process.exit(0);}
console.log('Aplicação alterada: construir.');process.exit(1);
