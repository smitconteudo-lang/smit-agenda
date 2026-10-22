# SMIT Agenda

Plataforma de planejamento de publicações para a SMIT, com calendário, seleção de redes e exportação CSV. Interface azul #0f2c60 e verde #bef264, sem aprovação interna.

## Estado

Versão 0.2.0. O planejamento e a persistência no Supabase estão implementados no código. O login usa link de e-mail. OAuth das redes, upload persistente, execução de publicações e coleta automática de métricas ainda precisam de implementação. Nenhum botão desta versão publica automaticamente.

## Instalação no Netlify

Vincular este repositório ao projeto Netlify escolhido. O netlify.toml declara comando npm run build, diretório public e funções netlify/functions. Configurar SMIT_SUPABASE_URL, SMIT_SUPABASE_PUBLISHABLE_KEY, SMIT_ALLOWED_EMAILS e SMIT_BASE_URL no painel da hospedagem. Não colocar segredos no repositório.

No Supabase Auth, cadastrar a URL da instalação e a URL de retorno. Em um banco novo, aplicar supabase/schema.sql e depois supabase/access-and-rpc.sql, substituindo o e-mail de exemplo pelo e-mail autorizado. Não reaplicar os arquivos em um banco já configurado.

## Desenvolvimento

```sh
npm ci
npm test
npm run build
```

Quatro testes locais verificam navegação, segurança e horário. Eles não provam uma implantação ou publicação nas redes. O arquivo public/index.html aberto diretamente funciona como prévia local. No Netlify, usa as funções e o banco configurados.

Os arquivos em docs explicam a continuidade. Este repositório contém código e exemplos; os parâmetros reais da instalação ficam nas contas dos serviços.
