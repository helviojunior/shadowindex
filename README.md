# ShadowIndex

Plataforma de análise de segurança de arquivos com varredura de leaks, OCR e gerenciamento de servidores.

## 🚀 Funcionalidades

- **Dashboard**: Visão geral com estatísticas e monitoramento de jobs
- **Gerenciamento de Servidores**: Cadastro e organização de servidores
- **Navegação de Arquivos**: Explorador de arquivos com Tree View
- **Sistema de Downloads**: Download em batch com fila de processamento
- **OCR de Arquivos**: Extração de texto de PDFs, imagens e certificados
- **Detecção de Leaks**: Integração com GitLeaks + Critical Search
- **Certificados PFX**: Visualização e extração de chaves privadas
- **Importação Nmap**: Importação de servidores a partir de XML do Nmap

## 🛠️ Tecnologias

### Backend
- FastAPI
- SQLite3 (via SQLAlchemy + aiosqlite)
- Apache Tika (OCR)
- GitLeaks (varredura de segredos)
- Python 3.11

### Frontend
- React 19
- Tailwind CSS
- Shadcn/UI
- Axios
- Lucide Icons

## 📦 Instalação com Docker Compose

### Requisitos
- Docker
- Docker Compose

### Execução Básica

```bash
# Clone o repositório
git clone <repo-url>
cd shadowindex

# Iniciar os containers
docker compose up -d --build

# Acessar
# Frontend: http://localhost:3000
# Backend API: http://localhost:9090
```

### Configuração do Endereço do Backend

Por padrão, o frontend se conecta ao backend em `http://localhost:9090`. Para alterar (ex: acessar de outra máquina na rede):

#### Opção 1: Variável de ambiente na linha de comando

```bash
REACT_APP_BACKEND_URL=http://SEU_IP:9090 docker compose up -d --build --force-recreate
```

Exemplo:
```bash
REACT_APP_BACKEND_URL=http://192.168.1.100:9090 docker compose up -d --build --force-recreate
```

#### Opção 2: Arquivo .env na raiz do projeto

Crie um arquivo `.env` na raiz do projeto:

```bash
echo "REACT_APP_BACKEND_URL=http://192.168.1.100:9090" > .env
docker compose up -d --build --force-recreate
```

#### Opção 3: Editar docker-compose.yml diretamente

```yaml
frontend:
  build:
    args:
      REACT_APP_BACKEND_URL: "http://192.168.1.100:9090"
  environment:
    REACT_APP_BACKEND_URL: "http://192.168.1.100:9090"
```

> **Nota**: É necessário fazer `--build` após alterar a variável, pois ela é injetada em tempo de build do React.

### Portas Utilizadas

| Serviço | Porta | Descrição |
|---------|-------|-----------|
| Frontend | 3000 | Interface web React |
| Backend | 9090 | API FastAPI |
| Tika | 9998 | Servidor OCR (interno) |

### Volumes

- `./shadowindex_data:/app/data` - Dados persistentes (banco de dados e arquivos baixados)

## 🗂️ Estrutura do Projeto

```
/app
├── backend/
│   ├── server.py              # FastAPI principal
│   ├── routes_v2.py           # Rotas API v2
│   ├── database.py            # Models SQLAlchemy
│   ├── leaks_service.py       # Serviço GitLeaks + Critical Search
│   ├── ocr_worker.py          # Worker de OCR
│   ├── download_worker.py     # Worker de downloads
│   ├── storage_utils.py       # Utilitários de storage
│   ├── directory_scanner.py   # Scanner de diretórios
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── pages/             # Páginas da aplicação
│   │   └── components/        # Componentes React
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml         # Produção
├── docker-compose.dev.yml     # Desenvolvimento (com SOAP mock)
└── tika-config.xml            # Configuração do Apache Tika
```

## 🔧 Ambiente de Desenvolvimento

Para desenvolvimento com hot reload e servidor SOAP mock:

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

## 📝 Funcionalidades Principais

### Gerenciamento de Servidores
- Cadastro de servidores com IP e nome
- Validação de IP duplicado
- Associação com plugins de comunicação

### Sistema de Downloads
- Fila de downloads em background
- Download em batch
- Suporte a arquivos grandes com chunks
- Estatísticas em tempo real

### OCR de Arquivos
- Extração de texto de PDFs, DOCs, imagens
- Processamento de certificados PFX/P12
- Detecção automática de chaves privadas
- Integração com Apache Tika

### Detecção de Leaks
- Integração com GitLeaks
- Critical Search (regras customizáveis)
- Detecção automática de:
  - Chaves privadas SSH (id_rsa, id_ed25519, etc.)
  - Certificados PFX com chave privada
  - Arquivos de configuração sensíveis
  - Senhas e tokens em arquivos

### Critical Search
Regras configuráveis para detectar arquivos sensíveis:
- **Keywords**: senha, password, secret, config, backup...
- **Extensões**: .pfx, .pem, .env, .yml, .kdbx...
- **Nomes exatos**: .env, id_rsa, credentials.json...

## 🔐 Segurança

- Dados armazenados localmente em SQLite
- Credenciais protegidas no banco
- CORS configurável
- Detecção automática de dados sensíveis

## 📄 API Endpoints Principais

### Servidores
- `GET /api/v2/servers` - Listar servidores
- `POST /api/v2/servers` - Criar servidor
- `DELETE /api/v2/servers/{id}` - Deletar servidor

### Downloads
- `GET /api/downloads/stats` - Estatísticas
- `POST /api/downloads/clear-finished` - Limpar concluídos

### OCR
- `GET /api/v2/ocr/stats` - Estatísticas OCR
- `GET /api/v2/ocr/jobs` - Listar jobs
- `POST /api/v2/ocr/jobs/{id}/retry` - Reexecutar job

### Leaks (GitLeaks + Critical Search)
- `GET /api/v2/gitleaks/findings` - Listar findings
- `POST /api/v2/gitleaks/scan-all-servers` - Escanear todos
- `POST /api/v2/gitleaks/scan-server/{id}` - Escanear servidor

## 🐳 Docker Compose Services

```yaml
services:
  tika:        # Apache Tika OCR Server
  backend:     # FastAPI Backend
  frontend:    # React Frontend
```

## 📞 Troubleshooting

### Erro: "no such column: gitleaks_findings.extracted_server_guid"
Execute a migração do banco:
```bash
docker compose exec shadowindex-backend alembic upgrade head
```

### Frontend não conecta ao backend
Verifique se a variável `REACT_APP_BACKEND_URL` está correta e faça rebuild:
```bash
REACT_APP_BACKEND_URL=http://SEU_IP:9090 docker compose up -d --build --force-recreate
```

### OCR não funciona
Verifique se o Tika está online:
```bash
docker compose logs shadowindex-tika
```

---

**Versão**: 2.0.0  
**Desenvolvido com**: FastAPI + React + SQLite3 + Apache Tika + GitLeaks
