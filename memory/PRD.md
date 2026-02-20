# Ops Integration Desk - Product Requirements Document

## Original Problem Statement
Build a web dashboard to manage credentials, database connections, proxy servers, and SOAP API URLs. The application integrates with an external SOAP web service for various operations (Resolve, Shares, Exec, etc.), implements a 24-hour caching mechanism for SOAP responses, and supports an offline mode. Includes a server management feature with an interactive file browser that dynamically loads data from the SOAP API.

## Tech Stack
- **Frontend:** React, Tailwind CSS, Shadcn/UI
- **Backend:** FastAPI, SQLAlchemy
- **Database:** SQLite with custom auto-migration

## Core Requirements
- Web panel with dark mode layout and collapsible left sidebar
- SQLite3 for data storage with automatic schema migration
- "Cadastro" (Registration) sections for Credentials, DB Connections, Proxy Servers, SOAP API URLs
- Global option to select active proxy for all SOAP requests
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

### 2026-02-20 (Session 3 - SQL Module)
- [x] **SQL Presets CRUD** - Comandos SQL pré-definidos com nome, query e descrição
- [x] **Default Presets** - 6 presets MS-SQL carregados automaticamente no startup (Is Admin, List Databases, Current User, Database Size, List Tables, Server Version)
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

*No pending issues at this time.*

---

## Backlog / Future Tasks

### P2
- **Mock SOAP Service for Testing:** Create mock service for robustly testing XML parsing without relying on unreliable live API

### P3
- **Refactor DB Schema Migration:** Replace custom migration script with Alembic for robust schema management

### P4
- **Complete File Download Tracking:** Store `downloaded` flag in ServerFile model after successful sync

---

## Architecture

```
/app/
├── backend/
│   ├── data/
│   │   ├── ops_integration.db   # SQLite database
│   │   └── storage/             # Downloaded files
│   ├── requirements.txt
│   ├── database.py              # SQLAlchemy models & init
│   ├── server.py                # Main FastAPI app, all endpoints
│   ├── soap_service.py          # SOAP client with caching
│   └── storage_utils.py         # File storage utilities
├── frontend/
│   ├── package.json
│   ├── src/
│   │   ├── App.js
│   │   ├── components/
│   │   │   └── Layout.js          # Sidebar, header, offline toggle
│   │   ├── contexts/
│   │   │   └── AppContext.js      # Global state (offline mode, cache)
│   │   └── pages/
│   │       ├── ServerBrowser.js   # File tree + info panel (with pre-loading)
│   │       ├── BeautifyTest.js    # Test page for beautify feature
│   │       └── ...
│   └── ...
└── ...
```

## Key DB Schema
- **ServerShare:** `{id, server_guid, share_name, ..., access_denied, error_message, has_children, children_fetched}`
- **ServerItem:** `{id, server_guid, share_name, parent_path, item_type, name, full_path, size, modified, access_denied, error_message, has_children, children_fetched}`
- **SoapCache:** `{id, query_hash, operation, request_data, response_data, timestamp}`
- **AppConfig:** `{id, key, value, updated_at}` - Global state like `offline_mode`, `active_proxy_id`
- **DatabaseConnection:** `{id, name, connection_string, verified, last_verified_at, created_at}`
- **SqlPreset:** `{id, name, query, description, created_at, updated_at}`
- **SqlQueryHistory:** `{id, connection_id, connection_name, query, result, success, error_message, execution_time_ms, executed_at}`

## 3rd Party Integrations
- **Custom SOAP Web Service:** Private SOAP API at sdweb.suzanonet.com.br
- **UI Libraries:** lucide-react for icons

## Critical Notes
- User is very specific about UI/UX - pay attention to reference images and CSS requests
- SOAP API is unreliable - use "Offline Mode" for development with cached data
- Database migration is custom (not Alembic) - ensure schema changes reflected in both server.py and models.py
