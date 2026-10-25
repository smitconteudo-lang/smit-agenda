# Continuidade técnica — SMIT Agenda 0.5

A prioridade é fechar o agendamento nas redes solicitadas antes de desenvolver
métricas. O sistema deve continuar executando no GitHub, Netlify e Supabase sem
uma sessão do ChatGPT. Consulte README.md e docs/STATUS.json para os componentes
implementados. O estado das contas e credenciais é consultado em runtime;
não o copie para o repositório público.

## Fluxo

O navegador entra por link de e-mail e recebe cookie HttpOnly, Secure e SameSite.
Cada operação mutável valida origem, sessão, membro ativo e token CSRF. A chave
de serviço fica no servidor. Upload direto usa URL assinada para o bucket privado.
O backend confirma tamanho, tipo e assinatura do arquivo antes de disponibilizar
a mídia. O editor salva rascunhos com controle de versão e ordem das mídias.

Agendar cria uma cópia por conta do texto, mídia e opções escolhidas. O relógio
consulta trabalho próximo a cada minuto e chama o worker por requisição assinada.
Uma reserva com prazo e identificador impede duas execuções do mesmo job. Antes
da chamada de publicação há um marcador durável. Reservas de preparo podem ser
retomadas; perda da confirmação de publicação vira unknown e não gera reenvio.
O usuário pode informar o ID da publicação para uma conferência somente de leitura.
A reconciliação exige conta e conteúdo compatíveis quando a API os disponibiliza.

O processamento respeita horário de São Paulo convertido no servidor. O horário
é o momento mais cedo de envio: a rede pode demorar para processar a mídia.
Editar uma versão cancela envios pendentes, mas é bloqueado enquanto houver envio
ou resultado desconhecido. Cancelar a fila não apaga conteúdo já enviado à rede.

## Validação e pendências

npm test cobre interface local e online simulada, OAuth, upload, seleção das
contas, limites por formato, quatro adaptadores, erros de confirmação e assinatura
do worker. Os provedores nesses testes são simulados. O SQL de teste roda na mesma
transação da migração e deve terminar em ROLLBACK. Nunca execute fixtures como
publicações reais. Verifique /api/health e os agendamentos do Netlify após deploy.

Concluir os aplicativos e as autorizações oficiais continua obrigatório. Uma
permissão de leitura não habilita escrita. Plugins conectados ao ChatGPT não
transferem tokens para este servidor. A primeira publicação real por formato e
por rede exige conteúdo autorizado e confirmação no próprio perfil. Não marque
como validado apenas porque o código ou os testes simulados passaram.

TikTok e outras redes solicitadas precisam de adaptadores próprios ou de uma API
de serviço com acesso explicitamente concedido e condições de custo verificadas.
Não existe um adaptador universal nem garantia de acesso gratuito a todas as APIs.
Use a documentação oficial e desenvolva o fluxo independente da interface de
referência. Métricas, relatórios e recomendações ficam para depois do agendamento.

## Cotas e operação

O limite atual de upload é 50 MB por arquivo e de publicação é 10 mídias; imagens
têm limite de 8 MB. Avalie retenção e remoção de mídias para preservar a cota de
armazenamento. Credenciais expiradas exigem renovação ou reconexão. Novos destinos
devem tratar aprovação de aplicativos, formatos, cotas e resultado incerto.

Deploys de produção consomem créditos. Agrupe mudanças; scripts/should-build.mjs
ignora mudanças apenas em documentação ou SQL. Migrações são aplicadas uma única
vez e exigem compatibilidade com o código implantado. Não altere políticas para
liberar tabelas de credenciais, fila ou autorizações ao navegador.
