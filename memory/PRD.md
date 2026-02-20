# Ops Integration Desk - PRD

## Original Problem Statement
Dashboard web para gerenciar credenciais, conexões de banco de dados, servidores proxy e URLs de API SOAP. Integração com um web service SOAP externo para operações como Resolve, Shares, Exec, etc. Mecanismo de cache de 24 horas para respostas SOAP e suporte a modo offline.

## Core Requirements
- Panel web com layout dark mode e sidebar colapsável
- Usar SQLite3 para armazenamento de dados
- Seções "Cadastro" para Credenciais, Conexões de BD, Servidores Proxy e URLs SOAP
- Opção global para selecionar proxy ativo
- Opção global para ignorar cache
- Cache de 24 horas para respostas SOAP
- Modo offline baseado em cache
- Gerenciamento de servidores com estatísticas
- File browser interativo por servidor (estilo JFrog)

## Tech Stack
- **Frontend:** React, Tailwind CSS, Shadcn UI, React Router
- **Backend:** FastAPI, Pydantic, SQLAlchemy (async), requests
- **Database:** SQLite

## What's Been Implemented (as of 2026-02-20)
- [x] Layout UI completo (sidebar colapsável, header fixo, tema dark)
- [x] CRUD completo para Credenciais, DB Connections, Proxies, SOAP APIs, Servers
- [x] Integração com web service SOAP externo
- [x] Sistema de cache de 24 horas para respostas SOAP
- [x] Toggle global "Ignorar Cache"
- [x] Seletor de proxy ativo no header
- [x] Rotas de servidores com refresh automático via SOAP
- [x] **File browser estilo JFrog** com:
  - Árvore de diretórios à esquerda
  - Painel de informações à direita
  - Suporte a shares com caracteres especiais ($)
  - Diferentes informações baseadas no tipo de item (Share/Directory/File)
  - Navegação hierárquica com expand/collapse
  - Download de arquivos
- [x] Parsing XML sem namespace hardcoded
- [x] URI SOAP dinâmica do banco de dados
- [x] Correção de duplicação de shares no refresh

## Pending Issues
- [ ] P1: Erro SSL com proxy (bloqueado - aguarda detalhes do usuário)

## Upcoming Tasks
- [ ] Verificar armazenamento de cache das respostas SOAP
- [ ] Implementar serviço SOAP mockado para testes

## Future/Backlog
- [ ] Implementar "Modo Offline" global
- [ ] Consolidar lógica SOAP em módulo separado (refatoração)

## Key Files
- `backend/server.py` - API endpoints e lógica de negócio
- `backend/soap_service.py` - Cliente SOAP com cache
- `backend/database.py` - Modelos SQLAlchemy
- `frontend/src/pages/ServerBrowser.js` - File browser estilo JFrog
- `frontend/src/components/Layout.js` - Layout principal
- `frontend/src/contexts/AppContext.js` - Estado global
- `frontend/src/pages/` - Páginas da aplicação

## API Endpoints
- `/api/credentials` - CRUD credenciais
- `/api/db-connections` - CRUD conexões BD
- `/api/proxy-servers` - CRUD proxies
- `/api/soap-apis` - CRUD URLs SOAP
- `/api/servers` - CRUD servidores
- `/api/servers/:id` - Detalhes do servidor (nova rota)
- `/api/servers/:id/shares` - Compartilhamentos do servidor
- `/api/servers/:id/browse` - Navegar diretórios (Exec4)
- `/api/servers/:id/download` - Baixar arquivo (Exec5)
- `/api/soap/{operation}` - Operações SOAP (Resolve, Shares, Exec, Exec4, Exec5)
- `/api/active-proxy` - GET/PUT proxy ativo

## Notes
- API SOAP externa retorna 403 Forbidden (acesso restrito)
- Funcionalidade de proxy bloqueada por erro SSL
- Linguagem preferida do usuário: Português
