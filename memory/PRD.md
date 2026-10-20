# ShadowIndex - Product Requirements Document

## Original Problem Statement
Build a web dashboard to manage credentials, database connections, proxy servers, and SOAP API URLs. The application integrates with an external SOAP web service for various operations (Resolve, Shares, Exec, etc.), implements a 24-hour caching mechanism for SOAP responses, and supports an offline mode. Includes a server management feature with an interactive file browser that dynamically loads data from the SOAP API.

## Tech Stack
- **Frontend:** React, Tailwind CSS, Shadcn/UI, react-pdf
- **Backend:** FastAPI, SQLAlchemy
- **Database:** SQLite with Alembic migrations
- **Real-time:** WebSocket para atualizações em tempo real
- **DB Drivers:** pymssql, pymysql, psycopg2, oracledb, pymongo

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

### 2025-12-XX (Session 45 - Cache Removal Completion)
- [x] **Remoção completa de caches de configuração:**
  - Removido cache `_critical_search_config` do `directory_scanner.py`
  - Refatorado `critical_search_service.py`:
    - Adicionado import `fnmatch` que estava faltando
    - Removidos métodos síncronos quebrados (`is_critical_file`, `is_log_directory`, `should_auto_start_gitleaks`, `get_gitleaks_delay`)
    - Métodos agora são todos assíncronos: `is_critical_file_async()`, `is_log_directory_async()`, `should_auto_start_gitleaks_async()`, `get_gitleaks_delay_async()`
    - Todos os métodos buscam a configuração diretamente do banco de dados (sem cache)
    - Método `_check_critical()` agora retorna `Tuple[bool, str]` com razão da detecção
  - Removido método legado `load_findings_from_disk()` do `leaks_service.py`
- [x] **Testes de configuração dinâmica:**
  - Verificado que alterações de configuração feitas na UI são aplicadas imediatamente
  - Não é necessário reiniciar o backend para aplicar novas configurações
  - Configuração é buscada do PostgreSQL a cada uso

### 2025-12-XX (Session 44 - SYNC Download Path Bug Fix & Certificate Display Fix)
- [x] **Correção crítica: Bug no caminho de download via SYNC**
  - Problema: Arquivos baixados via SYNC estavam sendo salvos em `/app/data/storage/3` (ID numérico) em vez de `/app/data/storage/{server_guid}/...`
  - Causa raiz: Endpoints `download_item` e `download_file_by_path` em `routes_v2.py` usavam `save_file_by_id(server.id, ...)` em vez de `save_file_with_standard_path(server.guid, ...)`
  - Correção: Refatorados ambos os endpoints para usar a estrutura de caminho padrão: `{server_guid}/{share_id}/{file_version_id}`
  - Arquivos modificados: `backend/routes_v2.py` (linhas 1360-1540 e 1785-2010)
  - Funções corrigidas: `download_item()`, `download_file_by_path()`
  - Adicionada importação de `update` do SQLAlchemy para marcar versões antigas como não-atuais
- [x] **Correção: Datas do certificado mostrando "Invalid Date"**
  - Problema: As datas "Válido de" e "Válido até" na visualização de certificados estavam mostrando "Invalid Date"
  - Causa raiz: Frontend usava `cert.not_valid_before` mas backend retornava `cert.not_before`
  - Correção no frontend: Alterado para usar `cert.not_before` e `cert.not_after`
  - Correção no backend: Adicionados campos faltantes na resposta do endpoint `/certificate-info`:
    - `index`: Número do certificado na lista
    - `days_until_expiry`: Dias até a expiração
    - `fingerprint_sha1` e `fingerprint_sha256`: Impressões digitais
    - `signature_algorithm`: Algoritmo de assinatura
    - `public_key`: Informações da chave pública (algorithm, key_size)
    - `extensions`: Lista de extensões do certificado
  - Arquivos modificados: `frontend/src/pages/ServerBrowser.js`, `backend/routes_v2.py`
- [x] **Correção: Download de arquivos de tamanho zero**
  - Problema: Ao baixar arquivo com tamanho 0, sistema retornava "Resposta vazia do servidor"
  - Causa raiz: Verificação `if not content_bytes` avalia `b''` como falsy
  - Correção: Alterado para `if content_bytes is None` para aceitar bytes vazios
  - Arquivo modificado: `backend/routes_v2.py` (linha 1862)
- [x] **Gráfico "Leaks vs. Tempo" com dados reais**
  - Problema: Gráfico usava dados mockados/estáticos
  - Solução: Criado novo endpoint `GET /api/v2/gitleaks/leaks-over-time` que:
    - Busca todos os findings do banco de dados
    - Agrupa por mês/ano usando a data de download do arquivo (proxy para data de modificação)
    - Fallback para data do scan ou data de criação do finding
    - Retorna formato: `{ data: [{ date: "MM/YY", month, year, count }], total }`
  - Frontend atualizado para consumir dados reais do novo endpoint
  - Arquivos modificados: `backend/routes_v2.py`, `frontend/src/pages/Dashboard.js`
- [x] **Extensões de exclusão expandidas e consistentes**
  - Verificado: Busca Crítica usa **apenas** suas próprias configs (não herda da config geral)
  - A lógica em `directory_scanner.py` linha 566 confirma: `not scan_job.critical_only`
  - Expandidas listas de extensões excluídas em ambas as configurações:
    - Critical Search: `excluded_extensions` + `excluded_files` em `routes_v2.py` e `leaks_service.py`
    - OCR Geral: `auto_ocr_excluded_extensions` em `database.py`
  - Extensões de SO adicionadas: `.sys`, `.drv`, `.ocx`, `.cpl`, `.scr`, `.etl`, `.evtx`, `.dmp`, `.vhd`, `.vmdk`, etc.
  - Arquivos de sistema adicionados: `ntuser.dat.LOG*`, `$MFT`, `$LogFile`, `bootmgr`, `.Spotlight-V100`, etc.
- [x] **Visualização de arquivos expandida**
  - Suporte a mime type `text/*` para visualização de arquivos
  - Extensões de scripts adicionadas: `.ps1`, `.psm1`, `.psd1`, `.vbs`, `.vbe`, `.wsf`, `.wsh`, `.sh`, `.bash`, `.zsh`, etc.
  - Muitas outras extensões de linguagens e configuração adicionadas
  - Arquivos especiais expandidos: `.bashrc`, `.zshrc`, `Vagrantfile`, `hosts`, `passwd`, `sudoers`, etc.
  - Arquivo modificado: `frontend/src/pages/ServerBrowser.js`
- [x] **Persistência de Scans de Diretórios**
  - Problema: Scans de diretórios eram perdidos ao reiniciar o serviço
  - Solução: Implementada persistência no banco de dados usando a tabela `scan_jobs` existente
  - Funcionalidades:
    - Jobs são salvos no banco ao serem criados
    - Status é atualizado durante a execução (pending → running → completed/failed)
    - Jobs pendentes/running são restaurados automaticamente na inicialização do backend
    - Cancelamento atualiza o banco de dados
    - Limpeza de jobs finalizados remove do banco
  - Arquivos modificados: `backend/directory_scanner.py`, `backend/server.py`
  - Nova classe `ScanJobMemory` para processamento em memória
  - Métodos atualizados: `_restore_pending_jobs()`, `_update_job_status_in_db()`, `add_scan_job()`, `cancel_scan()`, etc.
- [x] **Múltiplos workers para scan de diretórios**
  - Nova configuração `max_simultaneous_scans` (padrão: 3)
  - Processamento paralelo usando tasks assíncronas
  - UI para configurar número de workers em Configurações Gerais
- [x] **Suporte a PostgreSQL**
  - Backend agora suporta PostgreSQL como banco principal (recomendado para produção)
  - SQLite mantido como fallback para desenvolvimento
  - Configuração via variável de ambiente `POSTGRES_URL`
  - Script de migração `migrate_sqlite_to_postgres.py` para migrar dados existentes
  - docker-compose.yml atualizado com serviço PostgreSQL
  - Usa asyncpg para conexões assíncronas
  - Pool de conexões configurado para melhor performance
- [x] **Remoção de caches em memória**
  - Findings do GitLeaks agora são buscados diretamente do banco de dados
  - Removido `_findings` cache da classe `GitleaksService`
  - Métodos `get_all_findings()`, `get_findings_by_server()`, `get_findings_by_job()` agora são async e buscam do banco
  - Novo método `_finding_to_dict()` para converter objetos do banco
  - Endpoints atualizados para usar async/await
  - Evita perda de dados quando o serviço reinicia

### 2026-02-23 (Session 43 - OCR Worker Concurrency Fix)
- [x] **Correção crítica de concorrência no OCR Worker:**
  - Bug de indentação corrigido: código de processamento estava fora do loop `for`
  - Implementada concorrência real usando `asyncio.create_task` para cada job
  - Novo método `_process_single_job()` executa cada job em sua própria task assíncrona
  - Jobs são marcados como 'running' em lote antes de disparar as tasks (evita race condition)
  - Configuração `max_simultaneous_ocr_jobs` é lida dinamicamente a cada iteração do loop
  - Alterações na UI de configurações são aplicadas automaticamente sem reiniciar o serviço
  - Cada job executa com sua própria sessão de banco de dados (isolamento de erros)
  - Arquivo modificado: `backend/ocr_worker.py`

### 2026-02-23 (Session 42 - Tree View Visual Enhancements & Download Worker Fix)
- [x] **Coloração de nós visitados/não visitados na Tree View:**
  - Diretórios **visitados** (já expandidos/explorados): ícone `text-blue-500`, texto `text-blue-400`
  - Diretórios **não visitados** (nunca explorados): ícone `text-gray-500`, texto `text-gray-500`
  - Arquivos **baixados**: ícone `text-green-500`, texto cor padrão
  - Arquivos **não baixados**: ícone `text-gray-500`, texto `text-gray-500`
  - Acesso negado: ícone e texto `text-red-500`
  - Baseado no campo `children_fetched` do banco de dados para persistência entre sessões
- [x] **Página Navegação de Arquivos reorganizada com abas:**
  - Aba "Acessados": servidores com `shares_count > 0` ou `downloaded_files_count > 0` (cards normais)
  - Aba "Não Acessados": servidores sem shares e sem downloads (cards compactos, ícones menores em cinza)
  - Template de abas seguindo o padrão de `/plugins/soap`
  - Grid mais denso na aba de não acessados para caber mais itens na tela
  - Arquivo modificado: `frontend/src/pages/FileNavigation.js`
- [x] **Correção: Downloads em background criam ServerItem para diretórios e arquivos:**
  - Nova função `ensure_parent_directories()` no `download_worker.py`
  - Ao baixar arquivo, cria automaticamente objetos `ServerItem` para todos os diretórios pais
  - Também cria o `ServerItem` do próprio arquivo baixado
  - Permite que a Tree View mostre corretamente a estrutura de pastas mesmo para arquivos baixados via jobs

### 2026-02-22 (Session 41 - SOCKS Proxy Validation)
- [x] **Validação de tipo de proxy para plugin de Interação Direta:**
  - Plugin agora valida que o proxy ativo seja do tipo SOCKS (SOCKS4 ou SOCKS5)
  - Retorna erro claro quando um proxy HTTP é usado com o plugin de Interação Direta
  - Mensagem: "Proxy selecionado '{nome}' não suportado para '{instância}'. O plugin de Interação Direta requer um proxy do tipo SOCKS (SOCKS4 ou SOCKS5)."
- [x] **Credenciais do proxy vindas exclusivamente do objeto Credential:**
  - Função `get_active_proxy_config` busca username/password apenas do `Credential` vinculado
  - Campos deprecated `username/password` no modelo `ProxyServer` são ignorados
  - Credenciais do proxy são passadas para o plugin via `proxy_user` e `proxy_pass` no config
- [x] **Botão de edição do nome do servidor movido para listagem:**
  - Botão de edição removido da página de browse (`/servers/{id}/browse`)
  - Botão de edição adicionado na tabela de listagem de servidores (`/servers`)
  - Edição inline com Enter para salvar e Escape para cancelar
- [x] **Novas colunas na tabela de servidores:**
  - Coluna "Risco" com índice de risco (0-100) com badge colorido (verde/amarelo/vermelho)
  - Coluna "Leaks" mostrando quantidade de leaks encontrados
  - Ordenação habilitada para: Risco, Leaks, Shares, Downloads
  - Backend calcula risk_score baseado em: leaks (peso maior), shares e downloads
- [x] **Extensões excluídas na Busca Crítica:**
  - Adicionada opção para excluir extensões (ex: .exe, .msi, .dll, binários, mídia)
  - UI com badges vermelhos e campo de input para adicionar novas exclusões
  - Backend filtra arquivos com extensões excluídas antes de verificar critérios
  - Padrão inclui: executáveis, bibliotecas, mídia, imagens, arquivos compactados
- [x] **Sistema de notificação sonora (já implementado):**
  - Som toca apenas quando TODOS os jobs de um tipo finalizam (Downloads, OCR, GitLeaks)
  - Hook `useJobCompletionSFX` monitora transição de >0 para 0 jobs ativos
- [x] **Correção: Remoção de findings na exclusão de servidor:**
  - Adicionado fallback para buscar findings por `server_name` + `server_ip` 
  - Cobre casos de: `server_id`, `extracted_server_id` e `nome/IP` (para dados antigos)

### 2026-02-22 (Session 40 - SQL Execution & Bug Fixes)
- [x] **Execute SQL no Plugin de Interação Direta:**
  - Implementado suporte completo a múltiplos bancos de dados
  - MSSQL (pymssql), MySQL/MariaDB (pymysql), PostgreSQL (psycopg2)
  - Oracle (oracledb), SQLite (sqlite3), MongoDB (pymongo)
  - Suporte a proxy SOCKS para todas as conexões
  - Connection string em formato URL ou JSON
- [x] **Correção de visualização de PDF:**
  - Substituído iframe por react-pdf para compatibilidade com Chrome
  - Adicionados controles de navegação de páginas
  - Adicionados controles de zoom (50% a 200%)
- [x] **Correção da aba Objetos no Share:**
  - Corrigido problema com `share_name` vs `shareName` que impedia exibição dos itens
- [x] **Edição do nome do servidor:**
  - Adicionado botão de edição ao lado do nome do servidor
  - Permite edição inline com Enter para salvar e Escape para cancelar
- [x] **Atualização do .gitignore:**
  - Adicionados paths `backend/storage_deleted/` e `/data/storage_deleted/`
- [x] **Configuração de Critical Search:**
  - Adicionados: `id_rsa`, `credentials` em nomes exatos
  - Adicionados: `.ppk`, `.kdbx`, `.psafe`, `.psafe3` em extensões
  - Adicionados: `cofre`, `safe` em palavras-chave
  - Adicionado: `.txt` em extensões de log

### 2026-02-22 (Session 39 - Bug Fixes & Critical Search)
- [x] **Correção da rota DELETE /api/servers/{id}:**
  - Corrigido acesso ao atributo `credential_type` (era `auth_type`)
  - Corrigido acesso ao `credential_id` via plugin config (não é campo direto do PluginInstance)
- [x] **Handler global de erros 500:**
  - Novo exception handler que captura exceções não tratadas
  - Retorna JSON estruturado com error_id, message, type, path, method
  - Log completo com stack trace no backend
- [x] **Botão "Cancelar Todos" na página OCR:**
  - Novo endpoint `POST /api/v2/ocr/cancel-all`
  - Cancela todos os jobs pendentes ou em execução de uma vez
  - Botão com estilo laranja na UI
- [x] **Ícone estático no card "Executando" (OCR):**
  - Substituído Loader2 animado por ícone Play estático
- [x] **Espaçamento na página Downloads:**
  - Adicionado `mb-6` nos botões de ação para separar do card abaixo
- [x] **Atualização do .gitignore:**
  - Adicionados paths `backend/backups/` e `/data/backups/`
- [x] **Funcionalidade "Critical Search" (Busca Crítica):**
  - Nova página de configuração `/settings/critical-search`
  - Regras configuráveis: palavras-chave, extensões, nomes exatos, MIME types
  - Regras de tamanho (min/max bytes)
  - Detecção de diretórios de log (ignora automaticamente)
  - Auto GitLeaks após scan crítico
  - Botão "Busca Crítica" na Tree View (ServerBrowser)
  - Lógica de filtragem implementada no `directory_scanner.py`
  - Encadeamento automático com GitLeaks ao final do scan

### 2026-02-22 (Session 38 - OCR Jobs Page & Sound Notifications)
- [x] **Sistema de Notificação Sonora Global:**
  - Hook `useJobCompletionSFX.js` para tocar som quando jobs completam
  - Som gerado via Web Audio API (sem dependência de arquivos externos)
  - Integrado no Layout para funcionar em todas as páginas
  - Monitora Downloads, GitLeaks e OCR via WebSocket
- [x] **Página de Jobs de OCR (`/ocr`):**
  - Visualização de todos os jobs de OCR com filtros
  - Cards de estatísticas (total, pendentes, executando, concluídos, falhados, ignorados)
  - Tabela com detalhes dos jobs
  - Botão para cancelar jobs pendentes/em execução
  - Botão para limpar jobs finalizados
  - Atualização em tempo real via polling
- [x] **Backend OCR Melhorias:**
  - Novo endpoint `POST /api/v2/ocr/jobs/{job_id}/cancel`
  - Emissão de estatísticas OCR via WebSocket (`ocr_stats_updated`)
  - Função `emit_ocr_stats()` no ocr_worker.py
- [x] **Banco de dados renomeado:** `ops_integration.db` → `shadowindex.db`
- [x] **Backup automático do banco:** Cria backup comprimido em `./data/backups/db_YYYYMMDD_EPOCH.db.gz` no startup
- [x] **Exclusão de servidor com backup:** Move storage para `storage_deleted/` e exporta JSON com todos os dados incluindo GitLeaks findings

### 2026-02-22 (Session 37 - Dashboard Visual Improvements)
- [x] **Ajustes visuais no Dashboard:**
  - Removidas barras horizontais entre seções do dashboard
  - Adicionadas barras verticais cinza entre colunas do "Monitoramento de Jobs"
  - Aumentada altura do painel de Jobs em ~30% (de 150px para 200px)

### 2026-02-22 (Session 36 - Download Worker Improvements & Jobs Monitor)
- [x] **Correção de Jobs de Download Travados:**
  - Reset de jobs "downloading" na inicialização do worker (comportamento existente mantido)
  - Emissão de evento `download_started` para downloads diretos (arquivos pequenos)
- [x] **Correção da função `get_active_proxy_url`:**
  - Agora busca credenciais da tabela `Credential` via `credential_id` do proxy
  - Suporte a autenticação HTTP com username:password
  - Fallback para campos deprecated `username/password` se `credential_id` não definido
- [x] **Painel de Monitoramento de Jobs no Dashboard:**
  - Nova seção "Monitoramento de Jobs" após "Status do Scan"
  - Downloads ativos com progresso em tempo real
  - Scans de diretório ativos com status
  - Jobs recentes (concluídos/falhos) com badges coloridos
  - Contador de jobs ativos no header
  - Atualização via WebSocket em tempo real
  - Polling de fallback a cada 5 segundos

### 2026-02-22 (Session 35 - Connection Status Alert Bar & WebSocket Expansion)
- [x] **Barra de alerta global para erros de conexão:**
  - Novo contexto `ConnectionStatusContext.js` para gerenciar estado de conexão
  - Componente `ConnectionBridge.js` que conecta WebSocket ao contexto de status
  - Barra vermelha suave no topo da aplicação quando há falha de comunicação
  - Botão "Tentar novamente" com animação de loading
  - Botão "X" para dispensar o alerta manualmente
  - Health check periódico (10s) para detectar problemas de API HTTP
  - WebSocket só reporta desconexão após 10 segundos (evita falsos positivos)
  - Auto-recuperação quando a conexão é restabelecida
- [x] **WebSocket para Dashboard:**
  - Hook `useStatsEvents` integrado para receber atualizações em tempo real
  - Badge "Tempo real" / "Offline" no header do Dashboard indicando status da conexão
  - Estatísticas são atualizadas automaticamente via WebSocket
- [x] **WebSocket para Tree View (ServerBrowser):**
  - Hooks `useFileStatusEvents` e `useDownloadEvents` integrados
  - Status de arquivos (baixado, em progresso) atualizado em tempo real
  - Progresso de download individual mostrado sem polling
  - Lista de arquivos baixados atualizada automaticamente
- [x] **UI de configurações "Auto OCR":**
  - Interface completa na página GeneralSettings
  - Toggle para habilitar/desabilitar OCR automático
  - Lista editável de extensões para OCR (.pdf, .doc, .docx, etc.)
  - Lista editável de MIME types para OCR automático
  - Info box explicativo sobre funcionamento
- [x] **Proxy SOCKS5:**
  - UI completa com seletor HTTP/SOCKS5 na página Proxy Servers
  - Backend implementado com suporte a autenticação
  - Função `get_active_proxy_url()` gera URLs corretas para SOCKS5
  - Plugin DirectInteraction com método `_resolve_through_socks()` para DNS via SOCKS

### 2026-02-22 (Session 34 - WebSocket Implementation)
- [x] **WebSocket para atualizações em tempo real:**
  - Backend: `websocket_manager.py` com gerenciador centralizado de conexões
  - Endpoint `/ws` para conexões WebSocket
  - Eventos emitidos: download_progress, download_complete, download_failed, download_started, scan_progress, scan_complete, new_leak, stats_update, file_status_change
  - Frontend: Hook `useWebSocket.js` com Context Provider
  - Hooks específicos: useDownloadEvents, useScanEvents, useLeakEvents, useFileStatusEvents, useStatsEvents
  - Integração na página Downloads com indicador de conexão (Tempo real/Offline)
  - Atualizações automáticas de progresso sem polling
- [x] **Botão "Refazer Falhados" inclui Scan Jobs:**
  - Endpoint `/downloads/retry-all-failed` atualizado
- [x] **Tree view: Linha de conexão para arquivos:**
  - Linha horizontal estendida para arquivos (`calc(50% + 20px)`)
- [x] **Botão de remover Finding individual:**
  - Endpoint com suporte a fingerprints com caracteres especiais (`{fingerprint:path}`)
- [x] **Botão "Limpar" remove do banco de dados:**
  - Método `clear_findings_from_db()` adicionado
- [x] **Jobs de download travados resetados na inicialização:**
  - `_reset_stale_downloading_jobs()` no download_worker

### 2026-02-22 (Session 33 - GitLeaks & OCR Improvements)
- [x] **Correção: Botão "Abrir Arquivo" para leaks:**
  - Botão só aparece quando `extracted_file_id` existe (arquivo foi baixado)
  - Simplificada lógica - usa diretamente `?file_id=` sem busca extra
  - Arquivos modificados: `frontend/src/pages/Leaks.js`
- [x] **Verificação de deduplicação do GitLeaks:**
  - Confirmado funcionamento correto de prevenção de duplicatas
  - `save_finding_to_db` verifica fingerprint antes de salvar
- [x] **OCR: Removida extensão .txt da lista automática:**
  - Não faz sentido fazer OCR em arquivos de texto puro
  - Atualizado em `database.py` (valor padrão) e via API (banco)
- [x] **OCR: Suporte a certificados digitais (.pfx, .p12, .cer, .crt, .pem):**
  - Novo método `_extract_certificate_text()` em `ocr_worker.py`
  - Extrai todas as informações do certificado em formato texto:
    - Thumbprint (SHA1)
    - Subject (CN, O, OU, C, ST, L, Email)
    - Issuer (mesmos campos)
    - Validade (data início, fim, status, dias restantes)
    - Informações técnicas (versão, serial, algoritmo)
    - Indicação de chave privada (com alerta)
    - Cadeia de certificados (se PFX)
    - Extensões (Key Usage, Subject Alt Names, etc.)
  - Salva resultado em arquivo `.ocr` no mesmo diretório
  - Suporta PFX/P12 com múltiplas tentativas de senha

### 2026-02-22 (Session 32 - GitLeaks Enhancement & UI Improvements)
- [x] **Bug Fix: Erro `'str' object has no attribute 'isoformat'` ao navegar diretórios:**
  - O cache de plugins serializa `datetime` como string via JSON
  - Adicionado tratamento defensivo em `routes_v2.py` para verificar se `modified_at` já é string antes de chamar `.isoformat()`
  - Afeta linhas 719-733, 900-914, 1150-1164
- [x] **Botão "Forçar Fetch" na árvore de diretórios:**
  - Botão com ícone `RefreshCw` adicionado em cada nó de diretório/share
  - Aparece no hover (classe `group` + `group-hover:opacity-100`)
  - Ignora cache e força nova requisição ao servidor
  - Exibe toast de confirmação após atualização
- [x] **Enriquecimento de Leaks com dados do banco:**
  - Função `extract_ids_from_path()` adicionada ao `gitleaks_service.py`
  - Extrai `server_id`, `file_id`, `version` do caminho físico do arquivo
  - IDs são armazenados em `extracted_server_id`, `extracted_file_id`, `extracted_version`
- [x] **Endpoint `/gitleaks/findings` enriquecido:**
  - Agora busca dados do banco (Server, DownloadedFile) usando IDs extraídos
  - Retorna campos adicionais: `server_name`, `server_ip`, `file_name`, `server_path`, `share_name`
- [x] **Nova coluna "SERVIDOR" na tabela de Leaks:**
  - Exibe nome do servidor (cor emerald) e IP abaixo
  - Coluna "ARQUIVO" agora mostra:
    - Primeira linha: Nome do arquivo (file_name do banco)
    - Segunda linha: Caminho original no servidor (server_path)

### 2026-02-23 (Session 31 - Sync Download & Network Error Handling)
- [x] **Nome da Instância de Plugin no Card do Servidor:**
  - Campo `plugin_instance_name` adicionado ao `ServerResponse` em `server.py`
  - Endpoint `GET /api/servers/{server_id}` agora retorna o nome da instância configurada
  - Frontend `ServerBrowser.js` exibe o nome da instância em badge abaixo do IP
- [x] **Correção do Download em Batch (Sync):**
  - Endpoint `/downloads/scan` corrigido para usar `DirectoryScanner.add_scan_job()`
  - Anteriormente criava jobs na tabela SQLAlchemy (não processados)
  - Agora usa o scanner em memória que processa jobs de forma assíncrona
- [x] **Preservação de Nós da Tree View após Download:**
  - Função `processDirectoryDownload` corrigida para usar IDs corretos do banco
  - Cálculo de `nodeId` agora busca o ID real nos `nodeChildren` existentes
  - `setNodeChildren` agora mescla dados existentes com novos, preservando estado
  - Subdiretórios usam `dir.id` do banco de dados em vez de hash do path
- [x] **Tratamento de Erro de Rede no SOAP (Código 53):**
  - Plugin SOAP (`soap_api.py`) agora detecta erros de rede no `list_shares`
  - Códigos tratados: 53 (rede), 5 (acesso negado), 1326 (autenticação)
  - Exceções específicas: `ConnectionException`, `AccessDeniedException`
- [x] **Mock SOAP para Servidores Offline:**
  - Lista `OFFLINE_SERVERS` adicionada ao mock para simular servidores inacessíveis
  - Função `build_network_error_response()` gera XML de erro realista
  - IPs de teste: `192.168.99.99`, `offline.test.local`, `10.0.0.254`
- [x] **Tratamento de Exceções no Endpoint list_shares:**
  - `ConnectionException` retorna HTTP 503 (Service Unavailable)
  - `AccessDeniedException` retorna HTTP 403 (Forbidden)
  - Mensagens de erro em português incluídas na resposta
- [x] **Consultas SQL usando Instância de Plugin Correta:**
  - Endpoint `/sql/execute` refatorado para usar `get_plugin_for_instance()`
  - Antes usava `get_default_soap_service()` ignorando a instância configurada
  - Agora usa o método `sql_request()` do plugin SOAP com a URL da instância correta
  - Plugin SOAP (`sql_request`) atualizado para usar operação `Exec` com parâmetros corretos
  - Tratamento de erros diffgram (message + stacktrace) no parsing de resultados SQL
  - Validação: retorna HTTP 422 se conexão não tiver `plugin_instance_id` configurado
- [x] **Texto "X encontrado" movido no filtro de navegação:**
  - Contador de resultados agora aparece diretamente abaixo do campo de busca
  - Removido contador duplicado do final da página

### 2026-02-22 (Session 30 - Plugin Instance Architecture Update)
- [x] **SOAP Mock Server criado:**
  - Novo serviço em `backend/soap_mock/mock_server.py`
  - Suporta operações: `ListShares`, `ListDirectory`, `ResolveAddress`, `DownloadFile`
  - Formato de resposta compatível com o webservice real (diffgram)
  - Inclui tratamento de erros (Access Denied, File Not Found)
  - Docker Compose atualizado com serviço `soap-mock` na porta 9999
  - Criado `docker-compose.dev.yml` para desenvolvimento sem Tika
- [x] **Plugin SOAP melhorado:**
  - `ResolveAddress` já usa parâmetro `hostname` corretamente
  - `list_directory` agora trata erros `<message>` e `<stacktrace>` do XML
  - `download_file` valida se o resultado é erro ou conteúdo válido
- [x] **Validação backend para plugin_instance_id:**
  - Função `get_plugin_for_server()` agora requer `plugin_instance_id`
  - Retorna erro 422 com mensagem clara: "Servidor não possui instância de plugin configurada"
  - Removido fallback para `plugin_type` (arquitetura legacy)
- [x] **Bug fix: Árvore de arquivos perdendo filhos após download:**
  - Removido `loadShares()` do polling de downloads concluídos
  - Apenas `loadDownloadedFiles()` é chamado, preservando a estrutura da árvore
- [x] **Configuração do Tika corrigida:**
  - URL padrão alterada de `http://localhost:9998` para `http://tika:9998`
  - Compatível com o hostname do container Docker
- [x] **Alteração nas Conexões SQL para usar Instâncias de Plugin:**
  - Formulário de criação/edição agora usa `plugin_instance_id` ao invés de `plugin_type`
  - Dropdown mostra nome da instância e tipo do plugin (ex: "SOAP Padrão (soap_api)")
  - Tabela de conexões exibe o nome da instância de plugin associada
- [x] **Alteração na Importação de Servidores para usar Instâncias de Plugin:**
  - Combobox de plugin começa vazio (sem seleção padrão)
  - Validação obrigatória: erro ao tentar importar sem selecionar instância
  - Label alterada de "Plugin" para "Instância"
  - Botão de importar desabilitado se nenhuma instância selecionada
- [x] **Bloqueio de operações em servidores sem instância de plugin:**
  - Banner de alerta amarelo no ServerBrowser quando `plugin_instance_id` é null
  - Botão "Configurar" que leva para a página de Servidores
  - Toast de erro quando tenta carregar shares sem instância configurada
  - Operações de listagem e download bloqueadas até configurar instância
- [x] **Migração de banco de dados:**
  - Coluna `plugin_instance_id` adicionada à tabela `database_connections`
- [x] **Arquivos modificados:**
  - `frontend/src/pages/DatabaseConnections.js` - Formulário e listagem atualizados
  - `frontend/src/pages/ImportServers.js` - Seletor de instâncias implementado
  - `frontend/src/pages/ServerBrowser.js` - Banner de alerta e verificação adicionados
  - `backend/server.py` - Schemas atualizados com plugin_instance_id
  - `backend/routes_v2.py` - Endpoint de importação atualizado
  - `backend/database.py` - Modelo DatabaseConnection atualizado

### 2026-02-22 (Session 29 - Plugin-Aware Download Fix)
- [x] **Bug Fix P1: Download/Sync usando plugin errado:**
  - Corrigidos 4 endpoints em `routes_v2.py` que usavam `get_default_soap_service()` em vez de `get_plugin_for_server()`
  - `/servers/{server_id}/items/{item_id}/browse` - Agora usa o plugin correto do servidor
  - `/servers/{server_id}/items/{item_id}/download` - Agora usa o plugin correto do servidor
  - `/servers/{server_id}/download` - Agora usa o plugin correto do servidor
  - `/servers/{server_id}/download-chunk` - Agora usa o plugin correto do servidor
- [x] **Refatoração do download_worker.py:**
  - Worker de downloads em background agora usa `get_plugin_for_server()` 
  - Métodos `_download_direct_via_plugin()` e `_download_chunked_via_plugin()` criados
  - Tratamento específico de exceções: `CredentialNotSetException`, `AccessDeniedException`, `ItemNotFoundException`
- [x] **Arquivos modificados:**
  - `backend/routes_v2.py` - Endpoints de browse e download corrigidos
  - `backend/download_worker.py` - Worker refatorado para usar plugins

### 2026-02-22 (Session 28 - Plugin Page Refactoring)
- [x] **Refatoração da Página de Plugins:**
  - Removida a página centralizada "Instâncias de Plugins" (`/plugins/instances`)
  - Cada plugin agora tem sua própria página com 2 abas: "Instâncias" e "Info"
  - SOAP Plugin (`/plugins/soap`): Aba Instâncias para gerenciar instâncias SOAP, Aba Info para informações do plugin e funcionalidades
  - Interação Direta (`/plugins/direct`): Aba Instâncias para gerenciar instâncias SMB, Aba Info para testar configuração e ver funcionalidades
- [x] **Criação Automática de Instâncias Padrão:**
  - Na inicialização da aplicação, se não existir nenhuma instância, são criadas automaticamente:
    - "SOAP Padrão": Sem URL configurada, marcada como padrão
    - "Interação Direta Padrão": Sem credencial (sem autenticação), marcada como padrão
  - Lógica implementada em `create_default_plugin_instances()` no `server.py`
- [x] **Atualização do Menu Lateral:**
  - Removido item "Instâncias" do submenu de Plugins
  - Mantidos apenas "SOAP API" e "Interação Direta"
- [x] **Arquivos modificados:**
  - `frontend/src/pages/PluginSoapConfig.js` - Reescrito com abas Instâncias/Info
  - `frontend/src/pages/PluginDirectConfig.js` - Reescrito com abas Instâncias/Info
  - `frontend/src/components/Layout.js` - Menu atualizado
  - `frontend/src/App.js` - Rota `/plugins/instances` removida
  - `backend/server.py` - Função de criação de instâncias padrão adicionada ao startup

### 2026-02-22 (Session 27 - Credential Verification & Proxy Credentials)
- [x] **Flag `verified` em Credenciais:**
  - Campo `verified`, `last_verified_at`, `verification_error` no modelo Credential
  - Serviço `credential_verification.py` com funções `mark_credential_verified` e `mark_credential_failed`
  - Credencial marcada como verificada após comunicação SMB bem sucedida (plugin Direct Interaction)
  - Credencial do proxy marcada como verificada após comunicação SOAP bem sucedida
  - UI de Credenciais já exibe status "Verificada" / "Não verificada"
- [x] **Combo de Autenticação em Proxy Servers:**
  - Novo campo `credential_id` na tabela `proxy_servers`
  - Dropdown mostra "Sem autenticação" + lista de credenciais do tipo `user_password`
  - Migração SQL aplicada: `ALTER TABLE proxy_servers ADD COLUMN credential_id INTEGER`
- [x] **Correção de bugs:**
  - Import `Key` adicionado em `Credentials.js`
  - Import `CredentialKeyIcon` corrigido em `ProxyServers.js`

### 2026-02-22 (Session 26 - Dashboard Layout & CredentialNotSetException)
- [x] **Layout do Dashboard já implementado:**
  - 3 linhas de widgets funcionando corretamente
  - Linha 1: Cards de estatísticas (Total Servidores, Serv. com Arquivos, Leaks Detectados, Credenciais)
  - Linha 2: Overall Risk Score (verde com sparkline), Risk by Severity (donut), Vulnerabilities by Extension (spider/radar chart)
  - Linha 3: Status do Scan (com botão), Risk vs. Time (area chart)
- [x] **Nova Exception CredentialNotSetException:**
  - Adicionada em `plugins/exceptions.py` com campos: operation, plugin_name, message
  - Integrada ao `plugins/factory.py` para validação automática de credenciais
  - Levanta erro HTTP 422 com estrutura JSON detalhada: `{error, message, operation, plugin_name}`
- [x] **Tratamento de erro no Frontend:**
  - `ServerBrowser.js` atualizado para tratar erro 422 com `detail.error === 'credential_not_set'`
  - Toast de erro com duração de 6 segundos e descrição orientando o usuário
  - Funções atualizadas: `loadShares`, `refreshShares`, `loadDirectory`
- [x] **Validação automática de credenciais no plugin Direct Interaction:**
  - `get_plugin_for_server()` agora carrega e valida credenciais automaticamente
  - Verifica se `credential_id` está configurado no plugin
  - Verifica se a credencial existe no banco de dados
  - Verifica se o tipo de credencial é `user_password` (único suportado para SMB)

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

### 2026-02-22 (Session 22 - P0 Fix & Import Improvements)
- [x] **P0 Corrigido: Health Check do Plugin SOAP usando Proxy:**
  - Método `health_check()` em `plugins/soap_api.py` agora utiliza o proxy ativo
  - Campo `proxy_used` adicionado aos detalhes da resposta
  - Testado: quando proxy ativo, a requisição passa pelo proxy configurado
- [x] **Página de Importação de Servidores melhorada:**
  - Status de upload em tempo real: "Enviando arquivo...", "Analisando XML...", "Pronto para importar"
  - Progress bar durante upload do arquivo
  - Botões de ação movidos para o header do card (Selecionar Todos, Desmarcar, Importar)
  - Removido ScrollArea interno - lista usa scroll da página principal
  - Ícones visuais para cada etapa do processo
- [x] **Espaçamento da página Plugin SOAP:**
  - Aumentado espaçamento entre seções (space-y-8)

### 2026-02-22 (Session 23 - Import Plugin Selection & Port Configuration)
- [x] **Seletor de Plugin na Importação:**
  - Adicionado combobox para selecionar o plugin que será vinculado aos servidores importados
  - Backend atualizado para aceitar `plugin_type` no endpoint `/api/v2/servers/import/nmap`
  - Modelo `NmapHostData` atualizado com campo opcional `plugin_type`
- [x] **Remoção de Badges de Serviço na Importação:**
  - Removidas as badges de tipo de serviço (SMB, MSSQL, etc.) da lista de servidores encontrados
  - Interface mais limpa e focada
- [x] **Configuração de Portas de Importação:**
  - Nova seção "Portas de Importação" na página de Configurações Gerais
  - Permite adicionar/remover portas que serão consideradas na importação via Nmap XML
  - Portas padrão: SMB (445), MSSQL (1433), MySQL (3306), PostgreSQL (5432), Oracle (1521), MongoDB (27017), Redis (6379), CouchDB (5984), Elasticsearch (9200)
  - Badges coloridas diferenciando SMB (azul) de bancos de dados (verde)
  - Link direto da página de importação para as configurações de portas

### 2026-02-22 (Session 24 - Manual Leak Identification & Auto PFX Detection)
- [x] **Identificação Manual de Credenciais:**
  - Novo botão "Identificar Credencial" no painel de visualização de arquivo
  - Modal com seleção de tipo: Senha, Token, API Key, Chave Privada, SSH Key, Certificado com Chave, String de Conexão, Outro
  - Campos: tipo, texto/padrão encontrado, número da linha, descrição
  - Endpoint `POST /api/v2/gitleaks/manual-leak` para registro
  - Endpoint `GET /api/v2/gitleaks/leak-types` para listar tipos disponíveis
  - Endpoint `DELETE /api/v2/gitleaks/findings/{fingerprint}` para remover leak
- [x] **Detecção Automática de PFX com Chave Privada:**
  - Ao parsear um arquivo PFX/P12 que contém chave privada, um leak é registrado automaticamente
  - Finding inclui: thumbprint do certificado, common name, severidade "critical"
  - Tag "Auto-PFX" para diferenciar de detecções manuais e do GitLeaks
  - Campo `leak_registered` adicionado à resposta do endpoint de certificado
- [x] **Melhorias na Página de Leaks:**
  - Nova tag "Manual" (amarelo) para leaks identificados manualmente
  - Nova tag "Auto-PFX" (laranja) para leaks de certificados detectados automaticamente
  - Campo `detection_source` utilizado para diferenciação visual

### 2026-02-22 (Session 25 - Auto SSH/RSA/PPK Detection & Custom Icon)
- [x] **Detecção Automática de Chaves Privadas SSH/RSA/PPK:**
  - Detecção automática ao visualizar conteúdo de arquivo
  - Tipos suportados: OpenSSH, RSA, DSA, EC, PKCS#8, PKCS#8 Criptografado, PuTTY PPK
  - Registro automático como leak sem duplicação (verifica fingerprint único)
  - Tag "Auto-Key" (vermelho) na página de Leaks
  - Campos adicionados à resposta: `private_key_detected`, `private_key_type`, `leak_registered`
- [x] **Novo Ícone ShieldKeyIcon:**
  - Ícone customizado SVG (escudo com cadeado e chave)
  - Substitui o ícone `Key` do lucide-react em todo o sistema
  - Componente reutilizável em `/components/icons/ShieldKeyIcon.jsx`
  - Implementado em: Dashboard, Leaks, Credentials, ServerBrowser, PluginDirectConfig

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
  - Agora mostra "ShadowIndex v1.0.0" e "© M4v3r1ck 2026"
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

### P0 - FIXED (Session 29)
- ✅ **Bug: Sync/Download usando plugin padrão:** Corrigido! Os endpoints de download agora usam `get_plugin_for_server()` em vez de `get_default_soap_service()` para respeitar a instância de plugin configurada no servidor.

### P2 - FIXED (Session 36)
- ✅ **Issue: Contador de Downloads Incorreto / Jobs Travados:** Resolvido com timeout automático (10 min) e loop de verificação periódica (60s) para jobs stale. Jobs travados são marcados como "failed" e UI é atualizada via WebSocket.

### User Verification Pending
- **Sync (Download) button:** Needs end-to-end testing after recent refactorings
- **SOCKS5 Proxy:** Needs testing with real SOCKS5 proxy server (implementation complete, waiting for test environment)
- **OCR with Tika:** Needs testing with real files when Tika service is running

### Completed (Session 43)
- ✅ **Bug de download de arquivos de 0 bytes:** Confirmado como corrigido pelo usuário

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
- **ServerItem:** `{id, server_guid, share_name, parent_path, item_type, name, full_path, size, modified_at, access_denied, error_message, has_children, children_fetched}`
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
