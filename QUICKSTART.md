# 🚀 Início Rápido - Docker Compose

## Opção 1: Build Simples (Recomendado)

Use o `docker-compose.prod.yml` para um build limpo sem volumes de desenvolvimento:

```bash
# 1. Build e iniciar
docker-compose -f docker-compose.prod.yml up -d

# 2. Aguardar (~2 minutos na primeira vez)

# 3. Acessar
# Frontend: http://localhost:3000
# Backend: http://localhost:9090/api/
```

## Opção 2: Com Hot Reload (Desenvolvimento)

Use o `docker-compose.yml` padrão para desenvolvimento com hot reload:

```bash
# 1. Build e iniciar
docker-compose up -d

# 2. Aguardar (~2 minutos na primeira vez)

# 3. Acessar
# Frontend: http://localhost:3000
# Backend: http://localhost:9090/api/
```

## 🧪 Testar Instalação

```bash
# Aguardar containers iniciarem
sleep 30

# Testar backend
curl http://localhost:9090/api/

# Deve retornar:
# {"message":"Ops Integration Desk API","version":"1.0.0"}
```

## ❓ Problemas Comuns

### 1. Erro "yarn.lock not found"
```bash
# Use a versão de produção
docker-compose -f docker-compose.prod.yml up -d
```

### 2. Erro "port already in use"
```bash
# Mude a porta no arquivo docker-compose
# Linha: "9090:8001" → "OUTRA_PORTA:8001"
```

### 3. Build muito lento
```bash
# Primeira vez demora ~2-5 minutos
# Builds seguintes são mais rápidos (cache)
```

### 4. Frontend não carrega
```bash
# Ver logs
docker-compose logs frontend

# Ou para versão prod
docker-compose -f docker-compose.prod.yml logs frontend

# Aguardar mais tempo (pode demorar)
```

### 5. Backend não conecta ao banco
```bash
# Remover volumes e recriar
docker-compose down -v
docker-compose -f docker-compose.prod.yml up -d
```

## 🔍 Ver Logs

```bash
# Todos os logs
docker-compose logs -f

# Apenas backend
docker-compose logs -f backend

# Apenas frontend
docker-compose logs -f frontend
```

## 🛑 Parar

```bash
# Parar (mantém dados)
docker-compose down

# Ou versão prod
docker-compose -f docker-compose.prod.yml down

# Parar e apagar tudo
docker-compose down -v
```

## ✅ Verificar Status

```bash
docker-compose ps

# Deve mostrar:
# - ops-integration-backend (Up)
# - ops-integration-frontend (Up)
```

## 🔄 Rebuild

Se fez mudanças no código:

```bash
# Rebuild tudo
docker-compose build --no-cache

# Rebuild apenas backend
docker-compose build --no-cache backend

# Rebuild apenas frontend
docker-compose build --no-cache frontend
```

## 🔄 Recriar Imagem e Container

Para forçar a recriação completa da imagem e container (útil quando há mudanças em dependências ou Dockerfile):

```bash
# Recriar um serviço específico (build + force recreate)
docker compose up --build --force-recreate backend

# Recriar frontend
docker compose up --build --force-recreate frontend

# Recriar ambos os serviços
docker compose up --build --force-recreate

# Em modo detached (background)
docker compose up --build --force-recreate -d backend
docker compose up --build --force-recreate -d frontend
docker compose up --build --force-recreate -d
```

> **Nota:** Use `--force-recreate` quando precisar garantir que o container seja recriado do zero, mesmo que a imagem não tenha mudado.

## 📦 Primeira Execução

Na primeira vez, o Docker vai:
1. ✅ Baixar imagens base (~500MB)
   - Python 3.11 para backend
   - Node 20 para frontend
2. ✅ Instalar dependências Python (~1 minuto)
3. ✅ Instalar dependências Node (~2 minutos)
4. ✅ Criar banco de dados SQLite
5. ✅ Inserir dados padrão (proxy + SOAP API)

**Total: ~3-5 minutos**

## 🎯 Acesso Rápido

Após tudo iniciar:

- 🌐 **Aplicação**: http://localhost:3000
- 🔧 **API Docs**: http://localhost:9090/docs
- 📊 **API**: http://localhost:9090/api/

---

**Problemas?** Consulte [DOCKER_COMPOSE_README.md](DOCKER_COMPOSE_README.md) para documentação completa.
