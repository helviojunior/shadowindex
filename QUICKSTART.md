# 🚀 Início Rápido - Docker Compose

## Passos Simples

### 1️⃣ Iniciar
```bash
docker-compose up -d
```

### 2️⃣ Aguardar (~30 segundos)
Os containers precisam de tempo para inicializar o banco de dados e instalar dependências.

### 3️⃣ Verificar
```bash
./test-docker.sh
```

### 4️⃣ Acessar
- 🌐 Frontend: http://localhost:3000
- 🔧 Backend API: http://localhost:9090/api/

## ❓ Problemas?

### Erro "port already in use"
```bash
# Mude a porta no docker-compose.yml
# Linha: "9090:8001" → "OUTRA_PORTA:8001"
```

### Backend não inicia
```bash
# Ver logs
docker-compose logs backend

# Rebuild
docker-compose down
docker-compose build --no-cache backend
docker-compose up -d
```

### Frontend não conecta
```bash
# Verificar variável de ambiente
cat frontend/.env
# Deve ter: REACT_APP_BACKEND_URL=http://localhost:9090

# Se mudou a porta do backend, atualize aqui também
```

## 🛑 Parar

```bash
# Parar mas manter dados
docker-compose down

# Parar e apagar tudo (incluindo banco de dados)
docker-compose down -v
```

## 📝 Logs em Tempo Real

```bash
docker-compose logs -f
```

## ✅ Status

```bash
docker-compose ps
```

---

**Dúvidas?** Consulte [DOCKER_COMPOSE_README.md](DOCKER_COMPOSE_README.md)
