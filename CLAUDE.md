# ShadowIndex — Convenções

## Frontend (React)

- **Largura total sempre**: toda página em `frontend/src/pages/` deve usar a largura
  inteira do canvas. Não envolva a raiz da página em container centralizado com
  largura limitada (`max-w-6xl`/`max-w-7xl` + `mx-auto`). Use raiz full width,
  ex.: `className="p-6 space-y-6 w-full"`. `max-w-*` em blocos de texto/tooltip
  internos é permitido.

## Deploy (stack prod, docker-compose.yml)

- O **frontend** é buildado dentro da imagem **nginx** (`nginx/Dockerfile`, stage
  builder). Para publicar mudanças de frontend: `docker compose build nginx` +
  `docker compose up -d nginx`.
- O **backend** não tem bind-mount de código: mudanças exigem
  `docker compose build backend` + `docker compose up -d backend`. Depois de
  recriar o backend, **reinicie o nginx** (`docker compose restart nginx`) — ele
  cacheia o IP do upstream no startup e passa a servir 502 até reiniciar.
