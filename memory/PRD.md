# ShadowIndex - Product Requirements Document

## Original Problem Statement
Build a web dashboard to manage credentials, database connections, proxy servers, and SOAP API URLs. The application integrates with an external SOAP web service for various operations (Resolve, Shares, Exec, etc.), implements a 24-hour caching mechanism for SOAP responses, and supports an offline mode. Includes a server management feature with an interactive file browser that dynamically loads data from the SOAP API.

## Tech Stack
- **Frontend:** React, Tailwind CSS, Shadcn/UI
- **Backend:** FastAPI, SQLAlchemy
- **Database:** SQLite with Alembic migrations

## Core Requirements
- Web panel with dark mode layout and collapsible left sidebar
- SQLite3 for data storage with Alembic schema migration
- "Cadastro" (Registration) sections for Credentials (with NTLM hash), DB Connections, Proxy Servers
- **Plugin-based architecture** for server communication (SOAP, Direct Interaction)
- Global option to select active proxy for all requests
- Global option to ignore cache for all operations
- 24-hour caching mechanism for SOAP responses
- Global "Offline Mode" relying solely on cache
- "Servers" management to register servers (name, IP) and track statistics
- Interactive, JFrog-style file browser for each server
- Handling for "Access Denied" errors during file browsing

## User's Preferred Language
Portuguese (pt-BR)

---

## Completed Features

### 2026-02-22 (Session 21 - Plugin Management in Server List)
- [x] **Edição de Plugin do Servidor:**
  - Coluna "Plugin" adicionada à tabela de servidores
  - Badge visual mostrando nome do plugin (SOAP API Plugin / Interação Direta)
  - Ícone de edição (lápis) para alterar o plugin inline
  - Select dropdown com todos os plugins disponíveis
  - Botões de confirmar (✓) e cancelar (✕)
- [x] **Backend - Endpoint PATCH /api/servers/{server_id} atualizado:**
  - Suporte para atualizar `plugin_type` e `plugin_config`
  - Validação de campos opcionais
- [x] **Backend - Endpoint POST /api/servers corrigido:**
  - Agora salva `plugin_type` e `plugin_config` ao criar servidor
  - Default: `soap_api`
- [x] **Testes realizados:**
  - Criação de servidor com plugin específico (curl)
  - Atualização de plugin existente (curl)
  - Interface visual (screenshots)

### 2026-02-22 (Session 20 - GitLeaks Integration Complete)
- [x] **Dockerfile atualizado para GitLeaks dinâmico:**
  - Download automático da última versão do GitLeaks no build
  - Detecta arquitetura (arm64/x64) automaticamente
  - Usa GitHub API para obter latest release
- [x] **Novo Dashboard com gráficos (inspirado no Sn1per):**
  - Cards de estatísticas com bordas coloridas (Total Servidores, Serv. com Arquivos, Leaks Detectados, Credenciais)
  - Overall Risk Score em card verde com sparkline
  - Risk vs. Time area chart (recharts)
  - Risk by Severity donut chart
  - Botão "Escanear Todos os Servidores"
- [x] **Página de Leaks redesenhada:**
  - Controle de scan integrado (Todos os Servidores, Servidor Específico, Caminho Custom)
  - Jobs Recentes com status em tempo real
  - Tabela estilo Sn1per: TARGET, LINE, RULE, TAGS, RISK (indicators coloridos), ACTIONS
  - Modal de detalhes com informações completas
- [x] **Backend GitLeaks melhorado:**
  - `POST /api/v2/gitleaks/scan-all-servers` - scan em todos os servidores
  - `GET /api/v2/gitleaks/stats` - estatísticas para Dashboard
  - Normalização de arquivos .ocr e .metadata no processamento
  - Campos adicionados: `original_file`, `scanned_file`, `detection_source`
- [x] **Tratamento de arquivos OCR/Metadata:**
  - Arquivos .ocr são exibidos referenciando o arquivo original (ex: `document.pdf.ocr` → `document.pdf`)
  - Arquivos .metadata idem
  - Badge visual indica fonte de detecção (via OCR, via Metadata)
- [x] **Página GitLeaks separada removida** - controle integrado na página Leaks

### 2026-02-22 (Session 19 - Nmap XML Import)
- [x] **Endpoint de Importação de Servidores via Nmap XML:**
  - `POST /api/v2/servers/import/nmap` - Importa servidores a partir de hosts parseados
  - Aceita lista de hosts com IP, nome, portas SMB e DB
  - Detecta servidores duplicados pelo IP (skip automático)
  - Atribui `plugin_type='direct_interaction'` para servidores importados
  - `plugin_config` armazena metadados: `imported_from`, `has_smb`, `has_db`, `db_types`
- [x] **Frontend `/servers/import`:**
  - Upload de arquivo XML do Nmap
  - Parsing local do XML no navegador
  - Seleção de hosts para importar (checkboxes)
  - Badges indicando portas SMB e tipos de banco de dados
  - Resultados separados: importados, ignorados (duplicados), falhas
- [x] **Rodapé do Layout atualizado:**
  - Agora mostra "ShadowIndex v1.0.0" e "© StrataSec 2026"
- [x] **Testes:**
  - 9 testes backend passando (100%)
  - Todos testes frontend passando

### 2026-02-22 (Session 18 - Credential Types, SMB with Impacket, Verification)
- [x] **Credential Types System:**
  - Three types: `user_password`, `token`, `ssh_key`
  - `user_password`: domain, username, password, ntlm_hash
  - `token`: token, token_type (bearer, api_key, etc.)
  - `ssh_key`: ssh_private_key, ssh_passphrase, ssh_public_key
  - Optional `name` field for all types
  - UI with tabbed form for each type
  - Separate cards listing credentials by type
- [x] **Credential Verification:**
  - Fields: `verified`, `last_verified_at`, `verification_error`
  - Endpoint `POST /api/credentials/{id}/verify` marks credential as verified
  - Status badges in UI (Verificada / Não verificada)
- [x] **Endpoint Improvements:**
  - `GET /api/credentials/by-type/{type}` - Filter by credential type
  - Validation specific to each type
- [x] **AuthenticationFailureException:**
  - New exception with username, domain, reason parameters
  - Used in SMB authentication errors
- [x] **Direct Interaction Plugin v1.1.0 - SMB with Impacket:**
  - Uses impacket library for SMB protocol
  - `list_shares()` - List SMB shares on a server
  - `list_directory()` - Browse directories in shares
  - `download_file()` - Download files via SMB
  - Supports NTLM hash authentication
  - Only user_password credentials allowed for SMB
  - credential_id now required in config
- [x] **Tests:**
  - 29 backend tests passing (100%)
  - All frontend UI tests passing

### 2026-02-22 (Session 17 - Credentials NTLM, Editing, Direct Interaction Plugin)
- [x] **Credentials Improvements:**
  - Added `ntlm_hash` field to store NTLM hash (format: LM:NT or just NT)
  - Added `updated_at` field for tracking modifications
  - Validation: password OR ntlm_hash is required (at least one)
  - Added `PUT /api/credentials/{id}` endpoint for editing
  - UI with edit button, inline editing mode
- [x] **Proxy Servers Editing:**
  - Added `PUT /api/proxy-servers/{id}` endpoint for editing
  - UI with edit button, inline editing for all fields
- [x] **Direct Interaction Plugin (NEW):**
  - Plugin type: `direct_interaction`
  - Configuration: `credential_id`, `dns_mode`, `dns_servers`
  - Implements `resolve_address()` for DNS resolution
  - Supports: system DNS, custom DNS servers, SOCKS proxy for DNS
  - Other methods raise `NotImplementedException` (SMB coming later)
  - New page: `/plugins/direct` with test interface
- [x] **Tests:**
  - Created `/app/backend/tests/test_credentials_proxy_direct.py` with 21 tests
  - All tests passing (100% backend, 100% frontend)

### 2026-02-22 (Session 16 - Plugin Architecture Evolution & SOAP Refactoring)
- [x] **Plugin Architecture Evolution:**
  - Enhanced `BasePlugin` class with new methods: `health_check()`, `validate_config()`, `get_config_schema()`
  - Added `PluginConfig.require()` and `validate()` methods for configuration management
  - Added class attributes: `PLUGIN_DESCRIPTION`, `REQUIRED_CONFIG`
  - Better documentation and type hints in base class
- [x] **SOAP Plugin Improvements:**
  - Added `get_config_schema()` returning JSON schema for configuration
  - Implemented `health_check()` to verify SOAP service connectivity
  - Added configurable `timeout` and `namespace` options
- [x] **Plugin Management Endpoints:**
  - `GET /api/plugins` - List all plugins with config_schema
  - `GET /api/plugins/{plugin_type}` - Get detailed plugin info
  - `POST /api/plugins/{plugin_type}/health` - Health check with config
  - `POST /api/plugins/{plugin_type}/validate` - Validate plugin config
- [x] **SOAP Configuration Refactoring:**
  - New page: `PluginSoapConfig.js` at `/plugins/soap`
  - New "Plugins" menu section in sidebar with "SOAP Plugin" submenu
  - Removed "SOAP APIs" from "Configuração" section
  - Added SOAP API selector in `SoapOperations.js`
- [x] **UI Improvements:**
  - Plugin info card showing name, type, version, description
  - Config schema visualization with required/optional fields
  - Test connectivity button for each SOAP URL
- [x] **Tests:**
  - Created `/app/backend/tests/test_plugins_api.py` with 19 tests
  - All tests passing (100% backend, 100% frontend)

### 2026-02-21 (Session 15 - OCR/Tika Integration)
- [x] **Docker Compose Updated:**
  - Added Apache Tika server container (`apache/tika:latest-full`)
  - Internal communication only (no port exposure)
  - Backend depends on Tika service
- [x] **OCR Service (`ocr_service.py`):**
  - TikaService class for text/metadata extraction
  - Support for PDFs, images, Office documents, etc.
  - Configurable OCR language (default: eng+por)
  - Automatic initialization on application startup
- [x] **Database Schema:**
  - Added OCR fields to `FileVersion`: `ocr_content`, `ocr_metadata`, `ocr_processed`, `ocr_processed_at`, `ocr_error`
  - Alembic migration created
- [x] **API Endpoints:**
  - `GET /api/v2/ocr/status` - Check Tika availability
  - `POST /api/v2/servers/{id}/files/{id}/process-ocr` - Process OCR on a file
  - `GET /api/v2/servers/{id}/files/{id}/ocr` - Get OCR data for a file
  - `POST /api/v2/servers/{id}/search-ocr` - Search in OCR content
  - Updated main search to include OCR content
- [x] **Frontend (ServerBrowser.js):**
  - New "OCR" tab for downloaded files
  - Shows OCR status in Info tab
  - Metadata viewer with extracted fields
  - OCR content viewer with copy button
  - Process/Reprocess OCR button

### 2026-02-21 (Session 15 - SQL Connections Plugin Selection)
- [x] **Plugin Selection for SQL Connections:**
  - Added `plugin_type` and `plugin_config` fields to DatabaseConnection model
  - Updated DatabaseConnections.js UI with plugin selector
  - Table shows plugin column for each connection
  - Edit modal includes plugin selection
  - Alembic migration for new fields

### 2026-02-21 (Session 15 - SOCKS Proxy & Plugin Selection UI)
- [x] **SOCKS Proxy Support:**
  - Added `proxy_type`, `username`, `password` fields to ProxyServer model
  - Updated plugin factory to build correct proxy URLs for HTTP and SOCKS5
  - Updated ProxyServers.js UI with type selector (HTTP/SOCKS5)
  - SOCKS5 shows optional username/password fields
  - Installed PySocks for requests SOCKS support
- [x] **Plugin Selection in Server Form:**
  - Added `/api/plugins` endpoint to list available plugins
  - Updated Servers.js form with plugin selector
  - SOAP API plugin shows optional URL field (uses default if empty)
  - Server model updated with `plugin_type` and `plugin_config` fields
- [x] **Dockerfile Update:**
  - Changed pip install to exclude emergentintegrations from requirements.txt

### 2026-02-21 (Session 15 - Plugin Architecture)
- [x] **Plugin System Architecture** - Complete implementation:
  - Base plugin class with abstract methods: `list_shares`, `list_directory`, `download_file`, `resolve_address`, `sql_request`
  - Standard exceptions: `ItemNotFoundException`, `AccessDeniedException`, `ConnectionException`, `TimeoutException`
  - Global caching layer Core → Plugin with JSON storage on disk
  - Plugin factory for registration and instantiation
- [x] **SOAP API Plugin** - First plugin implementation:
  - All current SOAP logic abstracted into plugin
  - Config: only `soap_url` required
  - Automatic cache with 24h TTL
- [x] **Server Model Updated**:
  - Added `plugin_type` field (default: "soap_api")
  - Added `plugin_config` JSON field for plugin-specific settings
- [x] **Pytest Tests** - 30 tests for plugin system:
  - Exception tests
  - Cache tests (set, get, invalidate, stats)
  - Factory tests
  - SOAP plugin tests
  - Data class tests

### 2026-02-21 (Session 15 - P1/P2 Fixes & Alembic Migration)
- [x] **P2 Fix: libmagic workaround cleanup**
  - Updated `server.py` to use libmagic with fallback to mimetypes by extension
  - Updated `download_worker.py` to calculate mimetype using libmagic or extension fallback
- [x] **P1.2 Fix: Downloaded file metadata update**
  - `download_worker.py` now saves `sha1_hash`, `file_size`, and `mimetype` to `DownloadedFile` table
  - Uses libmagic when available, falls back to extension-based detection
- [x] **P1.1 Fix: Visited directory highlight after refresh**
  - Rewrote `loadShares()` in `ServerBrowser.js` to correctly process all levels of subdirectories
  - Creates map of all items for quick lookup, properly processes `items_by_path` recursively
- [x] **P1.3 Feature: Auto-update file tree after background downloads**
  - Added polling mechanism in `ServerBrowser.js` to check for active downloads
  - When downloads complete, automatically refreshes `downloadedFiles` and reloads shares tree
- [x] **Alembic Migration System**
  - Installed and configured Alembic for SQLAlchemy schema migrations
  - Created initial migration capturing current schema
  - Updated `init_db()` to use Alembic with fallback to `create_all`
  - Removed all manual migration scripts from `database.py`

### 2026-02-21 (Session 15 - Database Migration Fix)
- [x] **P0 Bug Fix: OperationalError: no such column: server_shares.server_id**
  - Verified the `server_id` column already exists in the database
  - Added migration for `server_id` column in `database.py` init_db() to ensure persistence
  - Endpoint `/api/v2/servers/{server_id}/shares?refresh=true` now works correctly
- [x] **Backend restart successful** - Confirmed hot reload picked up database.py changes

### 2026-02-22 (Session 14 - Search Feature)
- [x] **Campo de busca na página do servidor**
  - Busca rápida por nome (com debounce de 300ms)
  - Busca avançada com filtros:
    - Por extensão (.aspx, .config, etc.)
    - Por hash SHA1
    - Por data de atualização (de/até)
    - Por tipo (arquivo/diretório)
  - Resultados organizados por categoria:
    - Diretórios
    - Arquivos
    - Arquivos baixados (com SHA1)
  - Navegação automática para resultado selecionado
- [x] **Novos Endpoints de Busca:**
  - `GET /api/v2/servers/{server_id}/search/quick?q=...` - Busca rápida
  - `POST /api/v2/servers/{server_id}/search` - Busca avançada com filtros

### 2026-02-22 (Session 13 - API V2 Complete Migration)
- [x] **Nova API V2 baseada em IDs**
  - Criado arquivo `backend/routes_v2.py` com endpoints baseados em IDs
  - Resolve problemas de encoding em URLs com caracteres especiais (`\`, `$`, `:`, etc.)
  - Estrutura mais RESTful e segura
- [x] **Novos Endpoints V2:**
  - `GET /api/v2/servers/{server_id}/shares` - Lista shares
  - `GET /api/v2/servers/{server_id}/shares-tree` - Shares com itens
  - `GET /api/v2/servers/{server_id}/shares/{share_id}` - Info do share
  - `GET /api/v2/servers/{server_id}/shares/{share_id}/items` - Itens do share
  - `POST /api/v2/servers/{server_id}/shares/{share_id}/browse` - Navegar no share (SOAP)
  - `GET /api/v2/servers/{server_id}/items` - Lista itens (com filtro parent_path)
  - `GET /api/v2/servers/{server_id}/items/by-path?full_path=...` - Buscar item por path
  - `GET /api/v2/servers/{server_id}/items/{item_id}` - Info do item
  - `GET /api/v2/servers/{server_id}/items/{item_id}/children` - Filhos do item
  - `POST /api/v2/servers/{server_id}/items/{item_id}/browse` - Navegar no diretório
  - `POST /api/v2/servers/{server_id}/items/{item_id}/download` - Download direto
  - `POST /api/v2/servers/{server_id}/items/{item_id}/queue` - Adicionar à fila
  - `POST /api/v2/servers/{server_id}/browse` - Browse por path (genérico)
  - `POST /api/v2/servers/{server_id}/download` - Download por path
  - `POST /api/v2/servers/{server_id}/download-chunk` - Download em chunks
  - `GET /api/v2/servers/{server_id}/files/by-path?file_path=...` - Buscar arquivo por path
  - `GET /api/v2/servers/{server_id}/files/{file_id}` - Info do arquivo baixado
  - `GET /api/v2/servers/{server_id}/files/{file_id}/content` - Conteúdo do arquivo
  - `GET /api/v2/servers/{server_id}/files/{file_id}/versions` - Versões do arquivo
  - `POST /api/v2/servers/{server_id}/files/{file_id}/certificate-info` - Info certificado
  - `GET /api/v2/servers/{server_id}/files/{file_id}/download` - Download do arquivo
  - `POST /api/v2/downloads` - Adicionar à fila de downloads
  - `POST /api/v2/downloads/check-queue` - Verificar se arquivo está na fila
  - `POST /api/v2/servers/{server_id}/batch/queue` - Batch queue
- [x] **Frontend completamente migrado para API V2:**
  - `loadShares` usa API V2
  - `refreshShares` usa API V2
  - `loadDirectory` usa API V2
  - `handleDownload` usa API V2
  - `checkFileInQueue` usa API V2
  - `processDirectoryDownload` usa API V2
  - `forceDownloadItem` usa API V2
  - `loadFileContent` usa ID quando disponível
  - `loadFileVersions` usa ID quando disponível
  - `openFile` usa ID quando disponível
- [x] **Endpoints antigos marcados como deprecated:**
  - `GET /api/servers/{server_id}/shares` → deprecated
  - `GET /api/servers/{server_id}/shares-tree` → deprecated
  - `GET /api/servers/{server_id}/items` → deprecated
  - `POST /api/servers/{server_id}/browse` → deprecated
  - `POST /api/servers/{server_id}/download` → deprecated
  - `POST /api/servers/{server_id}/download-chunk` → deprecated

### 2026-02-22 (Session 12 - Scan Jobs & Download Sorting)
- [x] **Botão "Limpar Finalizados" para Scan Jobs**
  - Adicionado botão `data-testid="clear-finished-scans"` na seção de Scan Jobs
  - Só aparece quando há scans com status `completed`, `cancelled` ou `failed`
  - Chama endpoint `POST /api/scans/clear-finished`
- [x] **Ordenação de Downloads na lista**
  - Downloads agora são ordenados por status: `downloading > pending > completed > failed > cancelled > skipped`
  - Arquivos em download sempre aparecem primeiro
- [x] **UI da seção de Scan Jobs melhorada**
  - Botões "Limpar Finalizados" e "Cancelar Todos" condicionais
  - Melhor organização visual dos botões

### 2026-02-21 (Session 11 - Bug Fixes & UI Polish)
- [x] **Bug Fix Crítico: DownloadedFile.remote_path**
  - Corrigido em `download_worker.py`: Alterado `remote_path` → `file_path` 
  - Removido `local_path` que não existia no modelo
  - O modelo `DownloadedFile` usa `file_path` e `sanitized_path`
- [x] **Bug Fix: Batch download com campo path**
  - Corrigido em `server.py`: Adicionado suporte para `path` além de `file_path` e `fullPath`
  - Adicionada validação para evitar erros de `None` em `file_path`
- [x] **UI Fix: Espaçamento na página Downloads**
  - Alterado container de `space-y-6` para `flex flex-col gap-6`
  - Corrigido renderização condicional do filtro ativo (usando `? : null`)
  - Removido gap visual estranho entre cards de status e lista de downloads
- [x] **UI Fix: Ícones dos cards de status**
  - Removido background circular dos ícones
  - Ícones reposicionados para canto superior direito (top-3 right-3)
- [x] **Verificação de fila de downloads**
  - Novo endpoint: `POST /api/downloads/check-queue` - Verifica se arquivo está na fila
  - Frontend mostra "Em fila de download" ao invés do botão Sync quando arquivo já está na fila
  - Mensagem de erro clara quando tenta adicionar arquivo duplicado na fila
- [x] **Botão "Forçar" para arquivos ignorados**
  - Na listagem de download em massa, arquivos ignorados agora têm botão "Forçar"
  - Permite forçar o download de arquivos que foram ignorados por tamanho/extensão

### 2026-02-22 (Session 10 - Sistema de Downloads Backend-Driven v2)
- [x] **Resolve separado para IPv4**
  - `/api/soap/resolve` - Retorna lista completa de IPs (para Operações SOAP)
  - `/api/soap/resolve-ipv4` - Retorna apenas IPv4 prioritário (para adicionar servidores)
- [x] **Fix: Path duplicado no download** - Verificação se path já é UNC completo
- [x] **Layout melhorado da página de Downloads**
  - Cards com ícones em círculos
  - Ícone de "Baixando" alterado (sem animação de loading)
  - Melhor separação visual entre cards
- [x] **Nova página: Configurações > Gerais**
  - Downloads Simultâneos (afeta worker)
  - Níveis de Profundidade (default do combo)
  - Tamanho Máximo (default do combo)
- [x] **Modelo AppSettings** - Persistência de configurações no banco
- [x] **Directory Scanner Worker** (`directory_scanner.py`)
  - Lista diretórios recursivamente
  - Adiciona arquivos à fila de downloads
  - Respeita limites de profundidade
  - Não contabiliza no limite de downloads simultâneos
- [x] **Download Worker atualizado**
  - Lê configurações do banco
  - Número de workers configurável via AppSettings

### 2026-02-22 (Session 10 - Sistema de Downloads Backend-Driven)
- [x] **P0 Bug Fix: Destaque de menu ativo incorreto** - Corrigida função `findActiveMenu` em `Layout.js`
- [x] **P1 Bug Fix: Menu flyout verificado** - Confirmado funcionamento correto do flyout quando sidebar colapsado
- [x] **UI: Forms colapsáveis em todas as telas de cadastro** (Conexões, Proxy, Credenciais, SOAP APIs, Servidores, Presets)
- [x] **Priorização de IPv4 na função Resolve** - Criada função `extract_ipv4_from_resolve_result()`
- [x] **Labels de tabs de Operações SOAP** (Exec→Consulta SQL, Exec4→Lista Diretório, Exec5→Download File)
- [x] **Worker de Downloads em Background**
  - Criado `download_worker.py` com processamento assíncrono
  - Máximo de 3 downloads simultâneos
  - Processamento em background independente do navegador
- [x] **Lógica de download inteligente no ServerBrowser**
  - Arquivo < 1MB: download direto via frontend
  - Arquivo > 1MB: enviado para fila de downloads (backend)
  - Download em massa: coleta arquivos e envia para fila em lote
- [x] **Página de Downloads funcional com polling a cada 2s**

### 2026-02-21 (Session 9 - Multi-level Menu & Download System)
- [x] **Side Panel Multi-nível estilo JFrog**
  - Menu com suporte a multi-nível (Dashboard, Arquivos, SQL, Configuração, Tools)
  - Comportamento expandido: submenus inline
  - Comportamento colapsado: flyout menu ao hover
  - Indicador visual de menu/submenu ativo
  - Persistência do estado de colapso no localStorage
- [x] **Nova estrutura de menus:**
  - Dashboard (/)
  - Arquivos → Servidores (/servers), Downloads (/downloads)
  - SQL → Conexões (/sql), Presets (/sql/presets)
  - Configuração → Proxy Servers, SOAP APIs, Credenciais
  - Tools → Operações SOAP
- [x] **Página de Downloads (frontend)**
  - Cards de status clicáveis para filtro (Pendente, Baixando, Concluído, Falhou, Cancelado, Ignorado)
  - Lista agrupada por servidor
  - Ações: cancelar, forçar download, retry
- [x] **Backend de Downloads**
  - Modelo DownloadJob no banco de dados
  - Endpoints: GET /downloads, POST /downloads, POST /downloads/batch
  - Endpoints: cancel, cancel-all, force, retry, clear-finished

### 2026-02-21 (Session 8 - Access Denied Error Handling)
- [x] **P0 Bug Fix: Tratamento de erro "Access Denied" no download** 
  - Backend: Nova função `update_file_access_denied_status()` marca o ARQUIVO específico (não a pasta pai)
  - Backend: Nova função `update_directory_access_denied_status()` marca a PASTA quando erro ao acessar diretório
  - Backend: Ambos endpoints `/download` e `/download-chunk` usam a nova lógica
  - Backend: Novo endpoint `POST /servers/{id}/clear-access-denied` para limpar status de erro
  - Frontend: `handleDownload` agora extrai `error.response?.data?.detail` para mostrar mensagem de erro específica
  - Frontend: Bulk download mostra "Acesso Negado" ou "Não encontrado" para códigos HTTP específicos
  - Frontend: Botão "Limpar e Re-testar" no alerta de acesso negado
  - Criados testes unitários em `/app/backend/tests/test_download_error_handling.py`
- [x] **Fluxo 1 (Arquivo):** Erro ao baixar arquivo → marca o arquivo como acesso negado no DB
- [x] **Fluxo 2 (Pasta):** Erro ao acessar pasta → marca a pasta/share como acesso negado no DB

### 2026-02-21 (Session 7 - Hydration Bug Fix)
- [x] **Bug Fix: Hydration Error** - Corrigido erro `<span> cannot be a child of <tbody>` em ServerBrowser.js
  - O erro era causado por fragmentos `<>...</>` sendo usados incorretamente dentro de elementos de tabela
  - Substituídos fragmentos por `<div>` consistentes na aba de Download
  - Corrigido mismatch de tags (`<div>` abrindo e `</>` fechando)
- [x] **Feature: Aba View como padrão** - Quando um arquivo já baixado é clicado:
  - Se o arquivo pode ser visualizado (texto, imagem, PDF, certificado), a aba "View" é selecionada automaticamente
  - O conteúdo do arquivo é carregado automaticamente quando a aba View é ativada
  - Arquivos não baixados ou não visualizáveis continuam abrindo na aba "Info"

### 2026-02-20 (Session 6 - Server Browser Fixes)
- [x] **Bug Fix: Share fica azul ao expandir** - Share agora fica azul imediatamente após primeiro clique/expansão
- [x] **Bug Fix: Refresh preserva estado** - Botão "Atualizar Compartilhamentos" agora preserva estado de expansão da árvore
- [x] **Auto-expand on click** - Clicar em diretório não expandido agora mostra Info E expande automaticamente
- [x] **Docker files reorganized** - `docker-compose.yml` agora é produção (sem volumes), `docker-compose.dev.yml` é desenvolvimento (com volumes e reload)
- [x] Frontend: `handleSelectItem()` agora expande diretórios automaticamente se não expandidos
- [x] Frontend: `refreshShares()` preserva `expandedNodes` e `nodeChildren` durante refresh
- [x] Frontend: Atualização de estado local do share ocorre imediatamente (não aguarda PATCH)

### 2026-02-20 (Session 5 - SQL Enhancements)
- [x] **Ctrl+Enter keyboard shortcut** - Executar query com atalho Ctrl+Enter (já implementado)
- [x] **Test Connection button** - Botão "Testar Conexão" (ícone raio ⚡) na página de conexões SQL
- [x] **59 SQL Presets** - Lista extensa de presets para MSSQL, MySQL, PostgreSQL e Oracle:
  - **MSSQL (17 presets):** Server Version, Current User, Current Database, Is Admin, Is Public Role, List Databases, List Schemas, List Tables, List Columns, Find Sensitive Columns, List Users, List Admin Users, List Impersonate Permissions, List Server Roles, List SQL Services, SQL Services Detail, Database Size
  - **MySQL (13 presets):** Server Version, Current User, Current Database, List Databases, List Schemas, List Tables, List Columns, Find Sensitive Columns, List Users, List Admin Users, Database Size, Show Grants, Show Variables
  - **PostgreSQL (14 presets):** Server Version, Current User, Current Database, List Databases, List Schemas, List Tables, List Columns, Find Sensitive Columns, List Users, List Admin Users, List Roles, Database Size, Table Sizes, Active Connections
  - **Oracle (13 presets):** Server Version, Current User, Current Database, List Schemas, List Tables, List All Tables, List Columns, Find Sensitive Columns, List Users, List Admin Users, Current Privileges, Database Size, Active Sessions
  - **Universal (2 presets):** Select All (Limit 100), Count Records

### 2026-02-20 (Session 4 - DB Types & Presets)
- [x] **DatabaseType table** - Nova tabela para tipos de banco (MS-SQL, MySQL, PostgreSQL, Oracle, SQLite, MariaDB, MongoDB)
- [x] **DB Type selection on connection** - Seletor de tipo de banco ao criar conexão SQL
- [x] **Connections as table** - Listagem de conexões em formato de tabela com colunas: Nome, Tipo, Connection String, Status, Última Verificação, Ações
- [x] **SQL Presets linked to DB Type** - Presets vinculados ao tipo de banco (ou universal se null)
- [x] **Filtered presets in SQL Editor** - Presets filtrados automaticamente pelo tipo de banco da conexão
- [x] **DB Type colors** - Cada tipo de banco tem sua cor característica (MS-SQL=#CC2927, MySQL=#4479A1, PostgreSQL=#336791, etc.)
- [x] **Presets filter by type** - Filtro de tipo de banco na página de presets
- [x] Backend endpoints: GET `/api/db-types`
- [x] Updated models: `DatabaseType`, `DatabaseConnection.db_type_id`, `SqlPreset.db_type_id`

### 2026-02-20 (Session 3 - SQL Module)
- [x] **SQL Presets CRUD** - Comandos SQL pré-definidos com nome, query e descrição
- [x] **SQL Query History** - Histórico de todas queries executadas com resultado, tempo e status
- [x] **SQL Executor Page** - Interface tipo phpMyAdmin para executar comandos SQL
- [x] **Vertical Layout** - Editor SQL em cima, resultados embaixo (layout de 2 linhas)
- [x] **Resizable Editor** - Barra arrastável para redimensionar altura do editor SQL
- [x] **History Modal** - Histórico abre em janela modal separada
- [x] **History to New Tab** - Clicar em item do histórico cria nova aba com query preenchida
- [x] **Presets Dropdown** - Botão para selecionar query pré-definida e preencher automaticamente
- [x] **Connection Verification** - Conexões são marcadas como "Verificado" após execução bem-sucedida
- [x] **Result Table** - Exibe resultados em tabela com colunas dinâmicas
- [x] **Error Handling** - Exibe mensagens de erro detalhadas em caso de falha
- [x] **Export to CSV** - Botão para exportar resultados em formato CSV
- [x] **Export to Excel** - Botão para exportar resultados em formato XLSX usando biblioteca xlsx
- [x] **SQL Syntax Highlighting** - Editor com syntax highlighting usando PrismJS (keywords azul, strings laranja, números verde)
- [x] **Multiple Query Tabs** - Sistema de abas permitindo múltiplas queries simultâneas com estados independentes
- [x] Backend endpoints: GET/POST/PUT/DELETE `/api/sql-presets`
- [x] Backend endpoints: GET/POST `/api/sql/execute`, GET/DELETE `/api/sql/history`
- [x] Frontend pages: `SqlExecutor.js`, `SqlPresets.js`
- [x] Updated `DatabaseConnections.js` with verification status and executor link
- [x] Fixed: Subdirectory color scheme now works correctly (uses `childrenFetched` from DB)
- [x] Fixed: Directories no longer auto-expand on page load

### 2026-02-20 (Session 2)
- [x] **P0: Pre-load children from database** - `loadDirectory` now checks `/api/servers/{id}/items?parent_path=...` before making SOAP calls
- [x] **P1: Verified cache storage mechanism** - Confirmed `soap_cache` table structure is correct and insert/read operations work properly
- [x] Created `ServerItem` model and table for storing browsed files/directories
- [x] Backend saves browsed items to `server_items` table during SOAP calls
- [x] New endpoint: `GET /api/servers/{id}/shares-tree` - Returns shares with pre-loaded children from DB
- [x] New endpoint: `GET /api/servers/{id}/items?parent_path=...` - Returns cached items for a specific path
- [x] Frontend `loadShares()` now uses `shares-tree` endpoint to pre-populate tree state
- [x] Frontend `loadDirectory()` checks database cache first, falls back to SOAP only if needed
- [x] Tree expansion now instant when data exists in database (no SOAP call required)
- [x] Added `forceRefresh` parameter to `loadDirectory` for explicit refresh scenarios

### 2026-02-20 (Session 1)
- [x] Auto-beautify: XML/JSON files are automatically formatted when loaded
- [x] Changed buttons: "Beautify" becomes "Raw Content" when formatted, vice-versa
- [x] Copy button always copies original RAW content
- [x] Gray color logic now applies to ALL directories (not just shares)
- [x] Implemented XML/JSON Beautify with proper indentation
- [x] Added syntax highlighting with colors (tags=blue, attributes=yellow, values=green, comments=gray)
- [x] Created /beautify-test page for demonstration
- [x] Directory color logic now matches shares (gray=not fetched, blue=fetched, red=access denied)
- [x] Access denied no longer propagates to parent items - only affects the specific node
- [x] Backend only marks share as access_denied if error occurs at share root level
- [x] Added inline IP editing for servers (pencil icon, input, save/cancel buttons)
- [x] Added PATCH endpoint for partial server updates
- [x] Backend skips SOAP Resolve if IP is already valid
- [x] Added `has_children` and `children_fetched` flags to ServerShare model
- [x] Backend updates flags when browsing directories
- [x] Frontend uses DB flags for initial color rendering (gray = not fetched, red = access denied)
- [x] Moved DB to local path: `/app/backend/data/ops_integration.db`
- [x] Moved storage to local path: `/app/backend/data/storage/`
- [x] Removed `<h3>Info</h3>` tag from info panel
- [x] Removed download buttons from View tab
- [x] Implemented tree hierarchy lines (vertical + horizontal connectors like JFrog)
- [x] Dashboard: Added "Servidores" and "Arquivos Baixados" stat cards
- [x] Dashboard: Grid updated to 6 columns on large screens
- [x] Server Browser: Gray icons/text for shares/directories without fetched children
- [x] Server Browser: Renamed tab from "General" to "Info"
- [x] Server Browser: Implemented image preview (PNG, JPG, GIF, WebP, BMP, ICO, SVG)
- [x] Server Browser: Implemented PDF preview via iframe
- [x] Sidebar menu reorder: Servidores → SQL → Operações SOAP → Credenciais → SOAP APIs → Proxy Servers
- [x] Renamed "Conexões DB" to "SQL"
- [x] Changed order of info panel rows: "Access Status" before "Fetched Date"
- [x] Fixed JSX syntax error in ServerBrowser.js (orphan TabsContent/Tabs tags)

### Previous Sessions
- [x] Server Browser Redesign: Two-panel JFrog-style layout with file tree and tabbed info/viewer panel
- [x] "Access Denied" Handling: End-to-end handling for SOAP API access errors
- [x] Global Offline Mode: Toggle in header with backend state persistence
- [x] File Viewing/Downloading: View tab for text files, download any file from server storage
- [x] Conditional View Tab: Only shows for known text file extensions
- [x] Flat Tab Styling: Green underline and text for active tab
- [x] Bug Fixes: Shares with $ symbol, duplicate share listings, broken tabs, JSON parsing errors
- [x] Basic DB Auto-Migration: Script in server.py to check/add missing columns

---

## Pending Issues

### User Verification Pending
- **Sync (Download) button:** Needs end-to-end testing after recent refactorings
- **Directory highlight persistence:** Needs confirmation that visited directories stay highlighted after page refresh
- **SOCKS5 Proxy:** Needs testing with real SOCKS5 proxy server
- **OCR with Tika:** Needs testing with real files when Tika service is running

### Completed (Session 19)
- ✅ **Importação de Servidores via Nmap XML:** Endpoint e UI completamente funcionais

---

## Backlog / Future Tasks

### P2
- **Mock SOAP Service for Testing:** Create mock service for robustly testing XML parsing without relying on unreliable live API

### P3
- **SMB Plugin:** Direct SMB connection to shares (without SOAP intermediary)
- **Database Plugin:** Direct database connections for SQL queries
- **WebSocket for Real-time Updates:** Replace polling with WebSocket for more efficient real-time UI updates

### P4
- **Complete File Download Tracking:** Store `downloaded` flag in ServerFile model after successful sync

---

## Architecture

```
/app/
├── backend/
│   ├── alembic/              # Alembic migrations
│   │   ├── env.py            # Migration environment config
│   │   └── versions/         # Migration scripts
│   ├── alembic.ini           # Alembic configuration
│   ├── plugins/              # Plugin system
│   │   ├── __init__.py       # Plugin exports
│   │   ├── base.py           # BasePlugin abstract class (health_check, validate_config, config_schema)
│   │   ├── exceptions.py     # Standard exceptions
│   │   ├── cache.py          # Global cache system
│   │   ├── factory.py        # Plugin factory & registration
│   │   └── soap_api.py       # SOAP API Plugin implementation
│   ├── data/
│   │   ├── ops_integration.db   # SQLite database
│   │   ├── storage/             # Downloaded files
│   │   └── cache/plugins/       # Plugin cache (JSON)
│   ├── tests/
│   │   ├── test_plugins.py      # Plugin system tests (30 tests)
│   │   └── test_plugins_api.py  # Plugin API tests (19 tests)
│   ├── requirements.txt
│   ├── database.py              # SQLAlchemy models & init (with Alembic)
│   ├── server.py                # Main FastAPI app, all endpoints
│   ├── routes_v2.py             # API V2 endpoints (ID-based)
│   ├── download_worker.py       # Background download processor
│   ├── directory_scanner.py     # Recursive directory scanner
│   ├── ocr_service.py           # Apache Tika OCR integration
│   ├── soap_service.py          # DEPRECATED - use plugins/soap_api.py
│   └── storage_utils.py         # File storage utilities
├── frontend/
│   ├── package.json
│   ├── src/
│   │   ├── App.js
│   │   ├── components/
│   │   │   └── Layout.js          # Sidebar (with Plugins menu), header, offline toggle
│   │   ├── contexts/
│   │   │   └── AppContext.js      # Global state (offline mode, cache)
│   │   └── pages/
│   │       ├── PluginSoapConfig.js # SOAP Plugin configuration page
│   │       ├── SoapOperations.js   # SOAP operations with API selector
│   │       ├── SqlExecutor.js      # SQL editor with Ctrl+Enter shortcut
│   │       ├── DatabaseConnections.js  # Connections table with Test Connection button
│   │       ├── SqlPresets.js       # Presets management (59 presets)
│   │       ├── ServerBrowser.js    # File tree + info panel (with polling, OCR tab)
│   │       ├── Downloads.js        # Download queue management
│   │       └── ...
│   └── ...
├── docker-compose.yml           # Production (no volumes, no reload)
├── docker-compose.dev.yml       # Development (volumes, hot reload, Tika service)
└── ...
```

### Plugin Architecture
```
┌─────────────┐     ┌─────────────┐     ┌─────────────────┐
│   Core      │ ──► │   Cache     │ ──► │   BasePlugin    │
│  (Routes)   │     │  (JSON)     │     │   (Abstract)    │
└─────────────┘     └─────────────┘     └─────────────────┘
                                                 │
                         ┌───────────────────────┼───────────────────────┐
                         ▼                       ▼                       ▼
                 ┌───────────────┐       ┌───────────────┐       ┌───────────────┐
                 │ SoapApiPlugin │       │  SMB Plugin   │       │   DB Plugin   │
                 │  (SOAP URL)   │       │   (Future)    │       │   (Future)    │
                 └───────────────┘       └───────────────┘       └───────────────┘
```

## Key DB Schema
- **ServerShare:** `{id, server_guid, share_name, ..., access_denied, error_message, has_children, children_fetched}`
- **ServerItem:** `{id, server_guid, share_name, parent_path, item_type, name, full_path, size, modified, access_denied, error_message, has_children, children_fetched}`
- **SoapCache:** `{id, query_hash, operation, request_data, response_data, timestamp}`
- **AppConfig:** `{id, key, value, updated_at}` - Global state like `offline_mode`, `active_proxy_id`
- **DatabaseType:** `{id, name, code, icon, color}` - Supported database types
- **DatabaseConnection:** `{id, name, db_type_id, connection_string, verified, last_verified_at, created_at}`
- **SqlPreset:** `{id, db_type_id, name, query, description, created_at, updated_at}`
- **SqlQueryHistory:** `{id, connection_id, connection_name, query, result, success, error_message, execution_time_ms, executed_at}`

## 3rd Party Integrations
- **Custom SOAP Web Service:** Private SOAP API (configurable)
- **UI Libraries:** lucide-react for icons, PrismJS for syntax highlighting, xlsx for Excel export

## Critical Notes
- User is very specific about UI/UX - pay attention to reference images and CSS requests
- SOAP API is unreliable - use "Offline Mode" for development with cached data
- Database migration is custom (not Alembic) - ensure schema changes reflected in both server.py and database.py
