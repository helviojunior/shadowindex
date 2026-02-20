# Docker Compose - Ops Integration Desk

## 🐳 Como Executar

### Pré-requisitos
- Docker
- Docker Compose

### Instruções

1. **Clone ou copie o projeto**

2. **Build e iniciar os containers**
```bash
docker-compose up -d
```

3. **Verificar logs**
```bash
# Ver logs do backend
docker-compose logs -f backend

# Ver logs do frontend
docker-compose logs -f frontend
```

4. **Acessar a aplicação**
- Backend: http://localhost:9090
- Frontend: http://localhost:3000

5. **Parar os containers**
```bash
docker-compose down
```

6. **Parar e remover volumes (apaga o banco de dados)**
```bash
docker-compose down -v
```

## 🔧 Configuração

### Proxy Host Gateway
O docker-compose já está configurado com:
```yaml
extra_hosts:
  - "proxy.local:host-gateway"
```

Isso permite que o container acesse o host através do IP `proxy.local`.

### Porta do Backend
Por padrão, o backend é exposto na porta **9090**. Para alterar:

```yaml
services:
  backend:
    ports:
      - "SUA_PORTA:8001"  # Altere SUA_PORTA
```

### Variáveis de Ambiente

**Backend** (backend/.env):
```env
CORS_ORIGINS=*
```

**Frontend** (frontend/.env):
```env
REACT_APP_BACKEND_URL=http://localhost:9090
```

⚠️ **Importante**: Se alterar a porta do backend, atualize `REACT_APP_BACKEND_URL` no frontend.

## 📦 Volumes

O docker-compose cria um volume persistente para o banco de dados SQLite:

```yaml
volumes:
  backend-db:
```

Isso garante que seus dados não sejam perdidos ao parar os containers.

## 🔍 Troubleshooting

### Problema: "Port already in use"
```bash
# Altere a porta no docker-compose.yml ou pare o processo usando a porta
lsof -ti:9090 | xargs kill
```

### Problema: "Build failed"
```bash
# Rebuild sem cache
docker-compose build --no-cache
docker-compose up -d
```

### Problema: Frontend não conecta ao backend
- Verifique se `REACT_APP_BACKEND_URL` aponta para a porta correta
- Verifique se o backend está rodando: `docker-compose logs backend`

### Problema: Dados não persistem
- Certifique-se de não usar `docker-compose down -v` (isso apaga os volumes)
- Use apenas `docker-compose down` para manter os dados

## 🚀 Desenvolvimento

Para desenvolvimento com hot reload:

```bash
# O hot reload já está habilitado
docker-compose up
```

Os arquivos são sincronizados via volumes:
- Backend: `./backend:/app`
- Frontend: `./frontend:/app`

## 📝 Estrutura dos Containers

### Backend
- **Porta interna**: 8001
- **Porta externa**: 9090
- **Banco de dados**: SQLite em `/app/data`
- **Framework**: FastAPI + Uvicorn

### Frontend
- **Porta**: 3000
- **Framework**: React com hot reload
- **Build tool**: Yarn

## ✅ Verificação

Para verificar se tudo está funcionando:

```bash
# Status dos containers
docker-compose ps

# Testar backend
curl http://localhost:9090/api/

# Deve retornar:
# {"message":"Ops Integration Desk API","version":"1.0.0"}
```

## 🛑 Comandos Úteis

```bash
# Iniciar
docker-compose up -d

# Parar
docker-compose down

# Rebuild
docker-compose build

# Ver logs em tempo real
docker-compose logs -f

# Executar comando no container
docker-compose exec backend bash
docker-compose exec frontend sh

# Remover tudo (containers, volumes, networks)
docker-compose down -v --rmi all
```

## 📊 Monitoramento

```bash
# Ver uso de recursos
docker stats

# Ver logs específicos
docker-compose logs backend --tail=100
docker-compose logs frontend --tail=100
```

## ⚙️ Requisitos de Sistema

- **Docker**: 20.10 ou superior
- **Docker Compose**: 2.0 ou superior
- **Node.js** (imagem Docker): 20.x (Alpine)
- **Python** (imagem Docker): 3.11 (Slim)

## 🔄 Atualizações

Quando houver mudanças no código:

```bash
# Parar containers
docker-compose down

# Rebuild com mudanças
docker-compose build

# Iniciar novamente
docker-compose up -d
```
