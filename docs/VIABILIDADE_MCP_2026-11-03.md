# SMIT Agenda — comparação funcional e viabilidade — 03/11/2026

## Escopo

Análise dos fluxos públicos de mLabs/Metricool, APIs oficiais e ferramentas conectadas. Não é inspeção do código proprietário. Não houve publicação de conteúdo, contratação, alteração da main ou deploy de produção nesta etapa. O requisito é custo financeiro zero.

## Resultado da comparação

| Camada | O que podemos manter/reproduzir | Limite a resolver |
|---|---|---|
| Interface | Composer, calendário, mídia e opções por conta | Capa, validação de metadados e publicação manual por aviso ainda têm lacunas |
| Motor próprio | Versões, fila por destino, tokens cifrados, envio e reconciliação | 78 testes locais com provedores simulados não substituem ensaio real |
| Meta | Adaptadores Instagram/Facebook, Stories e Reels de teste | Reautorizar Facebook com pages_manage_posts e validar entrega real |
| YouTube | OAuth Google e upload retomável implementados | Credenciais no ambiente e autorização do canal ainda precisam ser verificadas |
| TikTok Direct Post próprio | Exige desenvolvimento e autorização próprias | Restrição importante: as diretrizes não aceitam ferramenta limitada às contas da própria equipe para esse uso |
| Metricool MCP | Marcas, métricas, consulta e criação/edição de agendamentos pelo cliente conectado | Respeita o plano: Free até 20 posts/mês e 30 dias de histórico de métricas |
| API HTTP Metricool | Integração programática com nosso servidor | Exige Advanced/Custom; não atende ao requisito de gasto zero |
| mLabs | Referência de fluxo: perfis/canais, MP4, configuração por rede e data | Não foi encontrado conector MCP mLabs disponível na pesquisa de plugins desta sessão |

## Descoberta que altera o plano para TikTok

A documentação Direct Post distingue um cliente auditado de uma simples autorização OAuth. Sem auditoria há restrições de publicação privada. Nas diretrizes de uso, ferramentas limitadas a grupos internos/uso privado, inclusive utilitários para contas da própria equipe, são listadas como não aceitas. Portanto, não prometer que basta criar um aplicativo TikTok para o SMIT Agenda publicar publicamente. Não mudar a visibilidade da conta institucional para privada como solução.

Isso não é uma limitação que reproduzir a interface do mLabs remove. A mLabs documenta um fluxo de agendamento automático baseado na API oficial; nossa integração própria precisaria ser avaliada no seu próprio contexto.

## Alternativa operacional sem custo novo

1. Manter SMIT Agenda como editor, biblioteca, calendário e fila nas redes cujas autorizações próprias forem concluídas.
2. Usar o Metricool MCP conectado como apoio operacional do ChatGPT para agendar TikTok/YouTube dentro da franquia disponível. Não confundir esse acesso com uma API gratuita incorporável ao HTML.
3. Separar a identidade do executor: envio próprio versus envio via Metricool. Não colocar o mesmo conteúdo nas duas filas sem deduplicação e confirmação.
4. Preservar resultados de cada coleta com data e origem para o dashboard, pois o histórico consultável no Free é limitado.
5. Validar a primeira publicação de cada rede com arquivo aprovado, texto final, data/hora e opções exigidas (inclusive público infantil do YouTube). Depois comparar calendário do executor e URL/ID final da rede.

## Verificações reais nesta sessão

- Metricool retornou a marca da SMIT com Instagram, Facebook, TikTok, YouTube e Perfil da Empresa vinculados. Isso comprova vínculo no Metricool, não a permissão de escrita da integração própria.
- A consulta dos posts futuros de 03 a 30/11/2026 retornou lista vazia. Isso não comprova que as 20 publicações mensais estejam integralmente livres: a lista não cobre publicações já consumidas no mês.
- A extensão respondeu novamente que falta o contexto do navegador de origem nesta conversa. Como o usuário informa funcionamento em outros chats, estado específico desta conversa é uma hipótese plausível, sem diagnóstico confirmado.

## Extensão: saída documentada

A documentação oficial do ChatGPT inclui abrir um novo chat Work/Codex como forma de limpar estado de conexão específico de uma conversa. Continuar em um dos chats onde a extensão já funciona é uma tentativa fundamentada; reinstalar repetidamente não é o primeiro passo para este caso. Levar a URL do repositório, esta análise e o pacote de desenvolvimento para preservar continuidade. Se persistir em novo chat, usar /feedback com identificação da conversa.

## YouTube: cuidado com documentação divergente

A página atual em inglês de videos.insert informa que projetos não verificados não ficam restritos ao privado. O histórico de revisões e algumas versões/localizações ainda contêm a regra antiga de auditoria de 2020. Não transformar essa divergência em garantia de publicação pública nem em bloqueio universal. Conferir a configuração concreta do projeto, cotas, consentimento e resultado do primeiro upload autorizado.

## Fontes oficiais consultadas

- https://help.metricool.com/mcp-limits-and-plan-requirements-h72jg
- https://help.metricool.com/mcp-vs-api-access-what-is-the-difference-5y3ib
- https://help.metricool.com/schedule-and-post-on-instagram-6b6q5
- https://help.metricool.com/how-to-manage-your-calendar-in-metricool-xhlbw
- https://ajuda.mlabs.com.br/pt-BR/articles/6445747-como-agendar-videos-no-tiktok-pela-mlabs
- https://developers.tiktok.com/docs/en/content-sharing-guidelines
- https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post
- https://developers.google.com/youtube/data/reference/rest/v3/videos/insert?hl=en
- https://developers.google.com/youtube/data/revision_history
- https://learn.chatgpt.com/docs/chrome-extension
