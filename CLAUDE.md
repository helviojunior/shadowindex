# ShadowIndex — Convenções

## Frontend (React)

- **Largura total e margens consistentes**: toda página em `frontend/src/pages/`
  deve usar a largura inteira do canvas e as mesmas margens das telas existentes
  (ex.: Servers, Advanced Search). O `<main>` do `Layout.js` **já aplica `p-6`**,
  então a raiz da página NÃO deve adicionar o próprio `p-6`/`px-*` nem `w-full`
  nem container centralizado (`max-w-*` + `mx-auto`) — isso dobra a margem. Use
  a raiz como `className="space-y-6"` (igual ao Servers). Telas full-bleed tipo
  browser (ServerBrowser/GitRepoBrowser) usam `h-[calc(100vh-120px)] flex flex-col`.
  `max-w-*` em blocos de texto/tooltip internos é permitido.

## Deploy (stack prod, docker-compose.yml)

- O **frontend** é buildado dentro da imagem **nginx** (`nginx/Dockerfile`, stage
  builder). Para publicar mudanças de frontend: `docker compose build nginx` +
  `docker compose up -d nginx`.
- O **backend** não tem bind-mount de código: mudanças exigem
  `docker compose build backend` + `docker compose up -d backend`. Depois de
  recriar o backend, **reinicie o nginx** (`docker compose restart nginx`) — ele
  cacheia o IP do upstream no startup e passa a servir 502 até reiniciar.
