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

### 2026-02-20
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

### P1 - High Priority
1. **Implement "Beautify" functionality** in file viewer
   - Button exists but lacks formatting logic
   - Install library (e.g., js-beautify) and implement handleBeautify function

### P2 - Medium Priority  
2. **Verify cache storage mechanism**
   - Confirm SOAP responses are saved to `soap_cache` table
   - Test with SQLite CLI after triggering uncached SOAP call

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
│   ├── requirements.txt
│   ├── models.py        # SQLAlchemy ORM models
│   ├── server.py        # Main FastAPI app, all endpoints, SOAP logic
│   ├── soap_service.py  # SOAP client logic
│   ├── storage_utils.py # Utilities for file storage paths
│   └── ops_integration.db
├── frontend/
│   ├── package.json
│   ├── src/
│   │   ├── App.js
│   │   ├── components/
│   │   │   └── Layout.js          # Sidebar, header, offline toggle
│   │   ├── contexts/
│   │   │   └── AppContext.js      # Global state (offline mode, cache)
│   │   └── pages/
│   │       ├── ServerBrowser.js   # File tree + info panel
│   │       └── ...
│   └── ...
└── ...
```

## Key DB Schema
- **SystemSettings:** `{key, value}` - Global state like `offline_mode`
- **ServerShare:** `{id, server_id, share_name, ..., access_denied, error_message}`
- **ServerFile:** `{id, server_id, share_name, ..., access_denied, error_message, downloaded}`
- **SoapCache:** `{id, operation, params, response, timestamp}`

## 3rd Party Integrations
- **Custom SOAP Web Service:** Private SOAP API at sdweb.suzanonet.com.br
- **UI Libraries:** lucide-react for icons

## Critical Notes
- User is very specific about UI/UX - pay attention to reference images and CSS requests
- SOAP API is unreliable - use "Offline Mode" for development with cached data
- Database migration is custom (not Alembic) - ensure schema changes reflected in both server.py and models.py
