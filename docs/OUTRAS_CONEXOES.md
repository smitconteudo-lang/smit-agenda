# Conexões Google e LinkedIn

Os adaptadores incluem autorização oficial, estado aleatório com validade e uso
único, vínculo à sessão da equipe, seleção explícita de ativos e verificação de
acesso. Tokens e refresh tokens são cifrados com a mesma chave de proteção do
servidor. A interface recebe somente identificadores e nomes dos ativos.

## Google / YouTube

1. No Google Cloud, use um projeto da equipe e aceite os termos aplicáveis.
2. Ative YouTube Data API v3. Métricas serão configuradas depois.
3. Configure a tela de consentimento OAuth. Se estiver em teste, cadastre os
   usuários da equipe que vão autorizar. As limitações de testes do Google se
   aplicam, inclusive à duração das credenciais.
4. Crie um cliente OAuth do tipo Aplicativo da Web.
5. Registre o retorno exato `SMIT_BASE_URL/api/oauth/google/callback`.
6. Salve SMIT_GOOGLE_CLIENT_ID e SMIT_GOOGLE_CLIENT_SECRET nas variáveis do
   projeto Netlify, somente em Production. O segredo nunca pertence ao HTML.

O conector solicita youtube.readonly e youtube.force-ssl. O segundo permite
envio e alteração de vídeos, inclusive visibilidade. É necessário para a etapa
final videos.update. Autorize somente o canal oficial pretendido. A lista de canais usa `mine=true`: um canal público
encontrado por busca não comprova autorização. Contas de marca podem exigir
escolha específica no consentimento do Google. A renovação usa o refresh token;
se ele expirar ou for revogado, é necessário reconectar.

## LinkedIn / Página da organização

1. Use um perfil que administre a página oficial da organização.
2. Crie ou selecione um aplicativo vinculado à Página e solicite o produto
   Community Management API. O LinkedIn controla a aprovação desse acesso.
3. Registre o retorno exato `SMIT_BASE_URL/api/oauth/linkedin/callback`.
4. Configure no servidor SMIT_LINKEDIN_CLIENT_ID, SMIT_LINKEDIN_CLIENT_SECRET,
   SMIT_LINKEDIN_API_VERSION (YYYYMM suportado) e SMIT_LINKEDIN_SCOPES (somente
   escopos aprovados, separados por espaços).

Para listar Páginas, é necessário r_organization_admin ou rw_organization_admin.
O conector aceita adicionalmente r_organization_social e w_organization_social
quando aprovados. Login pessoal com openid/profile não equivale a conectar uma
Página. Somente vínculos APPROVED de ADMINISTRATOR ou CONTENT_ADMINISTRATOR são
apresentados para seleção. O acesso pode depender do produto e nível concedido.

## Publicação, métricas e custos

A versão 0.5 inclui upload privado, fila e adaptadores de publicação. Uma conta
só pode ser escolhida para agendamento se tiver a permissão de escrita.
A coleta de métricas fica para depois. A tela
mostra configuração, autorização e conta verificada como estados distintos.
O botão de coleta permanece desabilitado enquanto a funcionalidade não existir.
A fila de publicação é consultada a cada minuto. Não há chamadas a modelos de IA.

## Testes

Os testes simulam OAuth dos dois provedores, renovação, rejeição de estado de
outro usuário ou reutilizado, seleção de ativos e ausência de tokens na resposta
pública. Teste simulado não comprova aprovação do aplicativo, canal ou Página:
essa confirmação depende da resposta real do provedor após a autorização.

Documentação oficial:

- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/youtube/data/reference/rest/v3/channels/list
- https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-access-control-by-role
