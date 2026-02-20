#!/bin/bash

echo "🚀 Testando Ops Integration Desk via Docker Compose..."
echo ""

# Cores
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Verificar se docker-compose está instalado
if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}❌ Docker Compose não está instalado${NC}"
    exit 1
fi

echo -e "${YELLOW}1. Verificando status dos containers...${NC}"
docker-compose ps

echo ""
echo -e "${YELLOW}2. Testando Backend API...${NC}"
BACKEND_RESPONSE=$(curl -s http://localhost:9090/api/)

if [[ $BACKEND_RESPONSE == *"Ops Integration Desk API"* ]]; then
    echo -e "${GREEN}✅ Backend está funcionando!${NC}"
    echo "Resposta: $BACKEND_RESPONSE"
else
    echo -e "${RED}❌ Backend não está respondendo corretamente${NC}"
    echo "Resposta: $BACKEND_RESPONSE"
fi

echo ""
echo -e "${YELLOW}3. Testando Proxy Servers (deve ter 1 padrão)...${NC}"
PROXY_RESPONSE=$(curl -s http://localhost:9090/api/proxy-servers)
PROXY_COUNT=$(echo $PROXY_RESPONSE | grep -o '"id"' | wc -l)

if [ "$PROXY_COUNT" -ge 1 ]; then
    echo -e "${GREEN}✅ Proxy padrão criado com sucesso! ($PROXY_COUNT proxy)${NC}"
else
    echo -e "${RED}❌ Proxy padrão não foi criado${NC}"
fi

echo ""
echo -e "${YELLOW}4. Testando SOAP APIs (deve ter 1 padrão)...${NC}"
SOAP_RESPONSE=$(curl -s http://localhost:9090/api/soap-apis)
SOAP_COUNT=$(echo $SOAP_RESPONSE | grep -o '"id"' | wc -l)

if [ "$SOAP_COUNT" -ge 1 ]; then
    echo -e "${GREEN}✅ SOAP API padrão criada com sucesso! ($SOAP_COUNT API)${NC}"
else
    echo -e "${RED}❌ SOAP API padrão não foi criada${NC}"
fi

echo ""
echo -e "${YELLOW}5. Testando Frontend...${NC}"
FRONTEND_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000)

if [ "$FRONTEND_RESPONSE" -eq 200 ]; then
    echo -e "${GREEN}✅ Frontend está acessível!${NC}"
else
    echo -e "${RED}❌ Frontend não está respondendo (HTTP $FRONTEND_RESPONSE)${NC}"
fi

echo ""
echo "📊 Resumo dos Testes:"
echo "- Backend API: http://localhost:9090/api/"
echo "- Frontend: http://localhost:3000"
echo ""
echo "Para ver logs:"
echo "  docker-compose logs -f backend"
echo "  docker-compose logs -f frontend"
