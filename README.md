# SMIT Agenda

Agenda editorial independente: código no GitHub, hospedagem e processamento no
Netlify, autenticação, banco e mídia privada no Supabase. Métricas ficam para
uma etapa posterior. A fila não depende de uma sessão do ChatGPT.

## Versão 0.5

Editor com upload privado, biblioteca de arquivos enviados, ordem de imagens,
rascunhos versionados, calendário de São Paulo, seleção explícita de contas e
legendas por destino. A fila guarda a versão e registra o resultado por conta.
Editar cancela os envios ainda pendentes da versão anterior.

Adaptadores implementados: Instagram (imagem JPEG, carrossel de imagens, Reel e
Story), Facebook Página (texto, imagens, Reel e Story), LinkedIn organização
(texto, imagens e vídeo), YouTube (vídeo). Cada formato depende das limitações
da API e das permissões concedidas. TikTok e outros destinos ainda não têm
adaptador nesta versão. Conectar um plugin no ChatGPT não transfere sua
autorização para este servidor.

Um relógio consulta a fila a cada minuto. Apenas havendo trabalho próximo ele
aciona o processamento em segundo plano. A chamada de publicação exige reserva
válida e horário vencido. Resposta incerta bloqueia repetição automática: confira
a publicação na rede antes de resolver a pendência. Não existe promessa de
entrega exatamente no segundo agendado; o processamento pode atrasar o envio.

## Instalação

Vincule o repositório ao projeto Netlify. Configure as variáveis de .env.example
no servidor, em Production, com escopo Functions. Os segredos não pertencem ao
HTML nem ao repositório. Use uma chave aleatória de 32 bytes para cifrar tokens.
Configure as URLs no Supabase Auth e nos aplicativos dos provedores.

Em banco novo, aplique supabase/schema.sql, supabase/access-and-rpc.sql (adaptando
o e-mail autorizado) e supabase/publishing.sql, nesta ordem. Não reaplique essas
migrações em um banco existente. A migração de publicação substitui a escrita de
rascunhos por uma operação do servidor para impedir edições durante um envio.
Implante a versão correspondente em seguida.

O bucket smit-media é privado. Uploads usam URLs assinadas sem a chave de serviço
no navegador. Limite atual: 50 MB por arquivo, 10 mídias por conteúdo, imagens de
até 8 MB para publicação. A fila e as credenciais não têm acesso direto pelo
navegador. SMIT_PUBLISHING_ENABLED=false pausa o processamento; faça novo deploy
para aplicar a variável. Os planos gratuitos têm cotas e podem pausar serviços;
acompanhe os painéis. Evite deploys de produção só para alterar documentação.

## Validação

```sh
npm ci
npm test
npm run build
```

Os testes de API usam respostas simuladas. tests/queue-rollback.sql valida
reservas, horário, bloqueio de edição e permissões dentro da mesma transação da
migração, terminada em ROLLBACK. Não comprovam publicação real nas redes ou
aprovação de aplicativos. A primeira publicação real exige conteúdo autorizado
e acompanhamento do resultado em cada destino.

Abra public/index.html diretamente para a prévia local, sem envio às redes.
