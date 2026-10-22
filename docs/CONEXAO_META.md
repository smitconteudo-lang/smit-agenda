# Conexão Meta — versão 0.3.0

O conector implementa autorização por Facebook Login for Business, listagem de
Páginas e Instagram profissional vinculado, seleção explícita e verificação de
identidade. Não habilita postagem, upload ou coleta de métricas nesta versão.

## Configuração

No aplicativo Meta da equipe, habilite o caso de uso Instagram com Facebook Login.
Crie uma configuração com token de usuário e as permissões instagram_basic,
instagram_content_publish, pages_read_engagement, pages_show_list e, quando exigida
pelo portfólio, business_management. Acesso padrão depende do papel do usuário no
aplicativo. Acesso a terceiros pode exigir análise e verificação pela Meta.

Cadastre o retorno HTTPS exato: `SMIT_BASE_URL/api/oauth/meta/callback`.
Use o ID do aplicativo Facebook, não o ID separado do aplicativo Instagram.

Configure exclusivamente no ambiente Production do projeto Netlify:

- SMIT_META_APP_ID: ID do aplicativo Facebook.
- SMIT_META_CONFIG_ID: ID da configuração de login.
- SMIT_META_API_VERSION: versão suportada pela Meta, no formato vNN.0.
- SMIT_META_APP_SECRET: segredo desse aplicativo Facebook.
- SMIT_SUPABASE_SECRET_KEY: chave secreta do projeto dedicado, usada apenas pelo servidor.
- SMIT_TOKEN_ENCRYPTION_KEY: 32 bytes aleatórios codificados em 64 caracteres hexadecimais.

Marque os valores privados como secretos. Nunca salve valores reais no GitHub,
HTML, localStorage, documentação ou prints. Uma implantação aplica as variáveis.
O endpoint de saúde informa somente meta_configured, sem mostrar valores.

## Operação

1. Entre na plataforma com o e-mail autorizado.
2. Em Contas, clique em Conectar Instagram/Página.
3. Na tela oficial da Meta, autorize somente os ativos da equipe.
4. Ao retornar, confira e confirme as contas apresentadas pela API.
5. Verifique as identidades. Publicação permanece desativada.

O estado é aleatório, de uso único, vinculado ao usuário e válido por 15 minutos.
O callback exige uma sessão Supabase validada. A troca e a validação do token
acontecem no servidor. Os tokens são cifrados com AES-256-GCM, associados ao ID da
tentativa/conta, e armazenados em tabelas privadas sem acesso anon/authenticated.
O navegador recebe somente nomes e IDs das contas, nunca os tokens.

Antes de produção com publicações reais: implementar renovação/reconexão,
desautorização e exclusão de dados, limpeza periódica de tentativas expiradas,
upload persistente, processamento de publicações e coleta verificada de métricas.
Não publicar o aplicativo Meta para terceiros antes de cumprir os requisitos
exibidos no painel e disponibilizar políticas reais da organização.

## Validação

`npm test` verifica criptografia, associação do estado ao usuário, repetição do
callback, seleção de ativos retornados e ausência de tokens nas respostas públicas.
São testes simulados; a conexão real só está confirmada quando a Meta autoriza
e as identidades aparecem verificadas na plataforma.
