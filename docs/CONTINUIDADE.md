# Continuidade técnica — SMIT Agenda 0.2.0

## Objetivo aceito

Agendamento multiplataforma, métricas reais e relatórios, sem Metricool e sem aprovação interna. A aplicação deve executar depois que o usuário perder o acesso temporário ao Work.

## Decisão de estrutura

GitHub para código e histórico; o repositório escolhido pelo usuário, smitconteudo-lang/smit-agenda, está público. Netlify para frontend e funções. Supabase para PostgreSQL e autenticação. Plano gratuito como ponto de partida, sujeito a cotas. Sem API de IA paga nesta versão. Sem dependência de um artefato Claude para publicar.

## Estado em 22/10/2026

GitHub, Supabase e Netlify acessíveis por seus plugins. Supabase `SUPABASE_PROJECT_REF` criado e saudável. Banco e políticas aplicados. Netlify `NETLIFY_SITE_ID`, projeto `agendamentos-smit`, selecionado; quatro parâmetros da aplicação definidos. Código organizado no repositório smitconteudo-lang/smit-agenda, ainda não implantado no Netlify. O conector GitHub atual não oferece criação de repositório; o conector Netlify atual não oferece upload de arquivos de implantação nem vinculação Git. Continuar por ferramentas oficiais, CLI autorizado ou configuração no painel. Não pedir tokens secretos no chat para contornar isso.

A interface recebida foi adaptada para retirar o fluxo de aprovação, usar as cores da SMIT e selecionar redes. O backend Python dos anexos não executa neste pacote; foi substituído, para login e planejamento, por funções JavaScript. NÃO publicar server.py como se fosse uma função Netlify.

## Próximas etapas, em ordem

1. Vincular o repositório smitconteudo-lang/smit-agenda ao projeto Netlify existente, configurar o retorno do Supabase Auth e testar login e persistência ao vivo.
2. Implementar upload persistente de mídias em armazenamento com acesso privado, validação de conteúdo, limite por formato e retenção. Hoje existe somente prévia local. Meta não pode receber uma URL blob: do navegador.
3. Implementar OAuth Meta no backend Netlify. Criar app oficial da SMIT, callback HTTPS exato, escopos de leitura/publicação adequados, state vinculado à sessão, validade, uso único e seleção explícita de ativos. Guardar tokens cifrados fora do acesso dos clientes. Fechar popup não significa sucesso. Nenhuma conta vem pré-conectada.
4. Implementar adaptadores de publicação e fila transacional. A tabela smit_jobs existe, mas nenhuma rotina a executa. Validar formatos; escolher contas reais por ID; capturar versão e conteúdo imutáveis por destino; proteger unicidade; distinguir scheduled/processing/unknown/published/failed. A decisão de agendar já autoriza a ação futura; não introduzir aprovação editorial extra.
5. Registrar marcador de envio antes da chamada que publica. Timeouts com resultado desconhecido ficam unknown e são reconciliados; não reenviar automaticamente conteúdo possivelmente publicado. Somente usar publicado com confirmação e identificador remoto. Ao editar/reagendar, invalidar jobs anteriores de forma atômica.
6. Executar a fila no servidor, sem depender de aba aberta. Escolher frequência com base nas cotas do Netlify. Cron usa UTC; exibir horários em America/Sao_Paulo. Monitorar execução, erros e última execução. Não usar GitHub Actions como relógio pontual de publicação.
7. Implementar coleta real de métricas com origem, fuso, intervalo, horário e granularidade. Não somar alcance único diário para obter alcance único mensal; não preencher indisponível com zero. Preservar leituras antigas quando uma nova coleta falhar. Evitar somar consultas sobrepostas.
8. Expandir para LinkedIn e YouTube por adaptadores e aplicativos próprios, depois de validar permissões e formatos. Essas redes já podem ser selecionadas para planejamento, mas não publicam. TikTok não está incluído no escopo técnico recebido mais recente.
9. Completar relatórios e análise com dados reais; CSV/JSON já existem para dados carregados. Relatórios PDF e recomendações automáticas ainda não existem.

## Verificação após implantação

Confirmar versão no /api/health; negar workspace sem login; entrar pelo e-mail autorizado; salvar/editar/planejar e recarregar; testar usuário não autorizado; testar segundo navegador; conferir dados após novo deploy. Não marcar nenhum desses testes como feito antes de executá-los.

## Prompt para continuar com outro desenvolvedor ou IA

> Continue o repositório SMIT Agenda 0.2.0. Leia README.md, docs/STATUS.json e os arquivos em supabase/. Preserve o escopo: agendamento multiplataforma, métricas e relatórios, sem Metricool e sem aprovação interna. O banco Supabase já está criado e os dois SQLs foram aplicados. O site Netlify existe, mas o novo código ainda não foi implantado no momento deste registro. Valide o estado atual antes de qualquer operação. Use autenticação oficial e segredos no servidor. Não declare contas conectadas, jobs criados, envios ou métricas sem confirmação. Complete uma etapa e seus testes antes de avançar. Atualize este registro com evidências e mantenha todo o código no GitHub da equipe.
