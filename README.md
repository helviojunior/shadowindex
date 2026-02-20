# Ops Integration Desk

Painel web de integração com WebService SOAP, desenvolvido com React + FastAPI + SQLite3.

## 🚀 Funcionalidades

- **Dashboard**: Visão geral do sistema com estatísticas
- **Gerenciamento de Credenciais**: Cadastro de domínio, usuário e senha
- **Conexões de Banco de Dados**: Armazenamento de connection strings
- **Proxy Servers**: Configuração de servidores proxy (com proxy padrão host-gateway)
- **SOAP APIs**: Gerenciamento de URLs de WebServices SOAP
- **Operações SOAP**: 
  - **Resolve**: Resolução DNS
  - **Shares**: Listar compartilhamentos de rede
  - **Exec**: Executar queries SQL
  - **Exec4**: Listar diretórios
  - **Exec5**: Download de arquivos (Base64)
- **Sistema de Cache**: Cache de 24 horas para consultas SOAP
- **Modo Offline**: Utiliza apenas dados em cache
- **Dark Mode**: Interface moderna com tema escuro

## 🛠️ Tecnologias

### Backend
- FastAPI
- SQLite3 (via SQLAlchemy + aiosqlite)
- Zeep (cliente SOAP)
- Python 3.11

### Frontend
- React 19
- Tailwind CSS
- Shadcn/UI
- Axios
- Lucide Icons

## 📦 Instalação e Execução

### Opção 1: Ambiente Atual (Kubernetes)

O sistema já está rodando no ambiente Kubernetes:

```bash
# Backend na porta 8001
# Frontend na porta 3000
```

Acesse: https://sql-studio-1.preview.emergentagent.com/

### Opção 2: Docker Compose (Porta 9090)

**Dependências necessárias:**
- fastapi==0.110.1
- uvicorn==0.25.0
- python-dotenv>=1.0.1
- pydantic>=2.6.4
- sqlalchemy>=2.0.0
- aiosqlite>=0.22.0
- zeep>=4.3.0

Para executar com docker-compose na porta 9090:

```bash
# Build e iniciar os containers
docker-compose up -d

# Acessar
# Backend: http://localhost:9090
# Frontend: http://localhost:3000
```

O docker-compose.yml está configurado com:
- Backend exposto na porta 9090
- Frontend na porta 3000
- Proxy host-gateway configurado automaticamente
- Volume persistente para o banco de dados SQLite

**Para instruções detalhadas, veja:** [DOCKER_COMPOSE_README.md](DOCKER_COMPOSE_README.md)

## 🗂️ Estrutura do Projeto

```
/app
├── backend/
│   ├── server.py           # FastAPI application
│   ├── database.py         # SQLAlchemy models e configuração
│   ├── soap_service.py     # Cliente SOAP com cache
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env
├── frontend/
│   ├── src/
│   │   ├── App.js
│   │   ├── components/
│   │   │   ├── Layout.js
│   │   │   └── ui/         # Shadcn components
│   │   └── pages/
│   │       ├── Dashboard.js
│   │       ├── Credentials.js
│   │       ├── DatabaseConnections.js
│   │       ├── ProxyServers.js
│   │       ├── SoapApis.js
│   │       └── SoapOperations.js
│   ├── package.json
│   ├── Dockerfile
│   └── .env
└── docker-compose.yml
```

## 🔧 Configurações Padrão

### Proxy Padrão
- **Nome**: Default Host Proxy
- **IP**: proxy.local (host-gateway)
- **Porta**: 8080

### SOAP API Padrão
- **Nome**: Default SOAP API
- **URL**: https://sdweb.suzanonet.com.br/dna/upload/api_tst.asmx?WSDL

## 📝 Como Usar

### 1. Cadastrar Credenciais
- Acesse "Credenciais" no menu
- Preencha domínio, usuário e senha
- Clique em "Adicionar Credencial"

### 2. Cadastrar Conexão de Banco
- Acesse "Conexões DB"
- Adicione um nome e a connection string
- Clique em "Adicionar Conexão"

### 3. Executar Operações SOAP

#### Resolve (DNS)
- Acesse "Operações SOAP"
- Selecione a aba "Resolve"
- Digite o nome do host/domínio
- Clique em "Executar Resolve"

#### Shares (Compartilhamentos)
- Selecione a aba "Shares"
- Digite o nome do servidor/IP
- Clique em "Executar Shares"

#### Exec (Query SQL)
- Selecione a aba "Exec"
- Preencha a connection string
- Digite a query SQL
- Clique em "Executar Exec"

#### Exec4 (Listar Diretório)
- Selecione a aba "Exec4"
- Digite o caminho do diretório
- Clique em "Executar Exec4"

#### Exec5 (Download Arquivo)
- Selecione a aba "Exec5"
- Digite o caminho do arquivo
- Clique em "Executar Exec5"

### 4. Gerenciar Cache

- **Visualizar estatísticas**: Dashboard > Gerenciar Cache
- **Limpar cache**: Dashboard > Limpar Cache
- **Ignorar cache**: Operações SOAP > Ativar "Ignorar Cache"

### 5. Modo Offline

- Ative o switch "Modo Offline" no Dashboard
- O sistema utilizará apenas dados em cache
- Nenhuma requisição externa será feita

## 🔍 Sistema de Cache

- Todas as consultas SOAP são armazenadas em cache
- Validade: 24 horas
- Formato: RAW (request e response completos)
- Possibilidade de ignorar cache por operação
- Em modo offline, apenas cache é utilizado

## 🎨 Design

- Interface moderna com dark mode
- Sidebar à esquerda com menu
- Cards com gradientes coloridos
- Transições suaves
- Responsivo para mobile

## 📄 API Endpoints

### Credenciais
- `GET /api/credentials` - Listar
- `POST /api/credentials` - Criar
- `DELETE /api/credentials/{id}` - Deletar

### Conexões DB
- `GET /api/db-connections` - Listar
- `POST /api/db-connections` - Criar
- `DELETE /api/db-connections/{id}` - Deletar

### Proxy Servers
- `GET /api/proxy-servers` - Listar
- `POST /api/proxy-servers` - Criar
- `DELETE /api/proxy-servers/{id}` - Deletar

### SOAP APIs
- `GET /api/soap-apis` - Listar
- `POST /api/soap-apis` - Criar
- `DELETE /api/soap-apis/{id}` - Deletar

### Operações SOAP
- `POST /api/soap/resolve` - Resolução DNS
- `POST /api/soap/shares` - Compartilhamentos
- `POST /api/soap/exec` - Query SQL
- `POST /api/soap/exec4` - Listar diretório
- `POST /api/soap/exec5` - Download arquivo

### Configurações
- `GET /api/config` - Listar configurações
- `PUT /api/config` - Atualizar configuração

### Cache
- `GET /api/cache/stats` - Estatísticas
- `DELETE /api/cache/clear` - Limpar cache

## 🔐 Segurança

- Credenciais armazenadas no banco local
- Connection strings protegidas
- CORS configurado
- Modo offline para ambientes sem internet

## 📦 Banco de Dados

SQLite3 com as seguintes tabelas:
- `credentials` - Credenciais de acesso
- `database_connections` - Connection strings
- `proxy_servers` - Servidores proxy
- `soap_api_urls` - URLs de APIs SOAP
- `soap_cache` - Cache de consultas SOAP
- `app_config` - Configurações do sistema

## 🐳 Docker Compose

O arquivo `docker-compose.yml` inclui:

```yaml
services:
  backend:
    - Porta 9090 (mapeada para 8001 interno)
    - Volume persistente para banco de dados
    - extra_hosts com proxy.local:host-gateway
    
  frontend:
    - Porta 3000
    - Hot reload habilitado
```

## 📞 Suporte

Para mais informações, consulte a documentação do WSDL em:
https://sdweb.suzanonet.com.br/dna/upload/api_tst.asmx?WSDL

---

**Versão**: 1.0.0  
**Desenvolvido com**: FastAPI + React + SQLite3
