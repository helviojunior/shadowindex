# Notas de Versão - Docker Compose

## Versões Atualizadas

### Frontend
- **Node.js**: `20-alpine` (anteriormente 18-alpine)
  - Necessário para react-router-dom@7.13.0
  - Requer Node >= 20.0.0

### Backend
- **Python**: `3.11-slim`
- **FastAPI**: 0.110.1
- **SQLAlchemy**: >= 2.0.0
- **Zeep**: >= 4.3.0 (cliente SOAP)

## Dependências Frontend

```json
{
  "react": "^19.0.0",
  "react-router-dom": "^7.5.1",
  "node": ">=20.0.0"
}
```

## Dependências Backend

```txt
fastapi==0.110.1
uvicorn==0.25.0
sqlalchemy>=2.0.0
aiosqlite>=0.22.0
zeep>=4.3.0
```

## Compatibilidade

✅ **Testado em:**
- Docker 24.0+
- Docker Compose 2.20+
- Ubuntu 20.04/22.04
- macOS 12+
- Windows 10/11 com WSL2

⚠️ **Não compatível:**
- Node.js < 20 (react-router-dom requirement)
- Python < 3.11
- Docker < 20.10

## Build Time Esperado

### Primeira Build (sem cache)
- Backend: ~2-3 minutos
- Frontend: ~3-5 minutos
- **Total**: ~5-8 minutos

### Rebuilds (com cache)
- Backend: ~30 segundos
- Frontend: ~1 minuto
- **Total**: ~1-2 minutos

## Tamanho das Imagens

- Backend: ~200MB
- Frontend: ~450MB (inclui node_modules)
- **Total**: ~650MB

## Portas Utilizadas

- **9090**: Backend API (exposta externamente)
- **8001**: Backend interno (dentro do container)
- **3000**: Frontend (exposta externamente)

## Volumes Persistentes

- `backend-db`: Banco de dados SQLite e arquivos baixados
  - Localização: `/app/` no container backend
  - Inclui: `ops_integration.db`, `/storage/`

## Variáveis de Ambiente

### Backend (.env)
```env
CORS_ORIGINS=*
```

### Frontend (.env)
```env
REACT_APP_BACKEND_URL=http://localhost:9090
```

## Troubleshooting Comum

### Erro: "node engine incompatible"
**Solução**: Certifique-se de usar Node 20+ no Dockerfile
```dockerfile
FROM node:20-alpine
```

### Erro: "Port already in use"
**Solução**: Altere a porta no docker-compose.yml
```yaml
ports:
  - "NOVA_PORTA:8001"  # Backend
  - "NOVA_PORTA:3000"  # Frontend
```

### Erro: "yarn.lock not found"
**Solução**: Use o glob pattern no Dockerfile
```dockerfile
COPY yarn.loc[k] ./
```

### Erro: "Cannot connect to backend"
**Solução**: Verifique REACT_APP_BACKEND_URL
```bash
# Deve apontar para a porta do backend
REACT_APP_BACKEND_URL=http://localhost:9090
```

## Changelog

### v1.1.0 (2026-02-20)
- ✅ Atualizado Node.js 18 → 20
- ✅ Adicionado sistema de servidores
- ✅ Sistema de storage de arquivos
- ✅ Sanitização de caminhos

### v1.0.0 (2026-02-20)
- ✅ Versão inicial
- ✅ FastAPI + React + SQLite
- ✅ Cliente SOAP com cache
- ✅ Dark mode
- ✅ Docker Compose
