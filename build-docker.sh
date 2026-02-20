#!/bin/bash

echo "🐳 Ops Integration Desk - Docker Build"
echo ""

# Cores
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Verificar se docker-compose está instalado
if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}❌ Docker Compose não está instalado${NC}"
    exit 1
fi

echo -e "${BLUE}Selecione a opção de build:${NC}"
echo "1) Build Produção (Simples, sem hot reload)"
echo "2) Build Desenvolvimento (Com hot reload)"
echo "3) Rebuild do zero (limpa cache)"
echo ""
read -p "Opção [1-3]: " option

case $option in
    1)
        echo -e "${YELLOW}🏗️  Build de Produção...${NC}"
        docker-compose -f docker-compose.prod.yml down
        docker-compose -f docker-compose.prod.yml build
        docker-compose -f docker-compose.prod.yml up -d
        ;;
    2)
        echo -e "${YELLOW}🏗️  Build de Desenvolvimento...${NC}"
        docker-compose down
        docker-compose build
        docker-compose up -d
        ;;
    3)
        echo -e "${YELLOW}🏗️  Rebuild Completo (sem cache)...${NC}"
        echo -e "${RED}⚠️  Isso vai apagar todos os dados!${NC}"
        read -p "Tem certeza? [s/N]: " confirm
        if [[ $confirm == [sS] ]]; then
            docker-compose down -v
            docker-compose build --no-cache
            docker-compose up -d
        else
            echo "Operação cancelada"
            exit 0
        fi
        ;;
    *)
        echo -e "${RED}❌ Opção inválida${NC}"
        exit 1
        ;;
esac

echo ""
echo -e "${GREEN}✅ Build concluído!${NC}"
echo ""
echo -e "${YELLOW}Aguarde ~30 segundos para os serviços iniciarem...${NC}"
echo ""

# Aguardar serviços
sleep 5

echo -e "${BLUE}📊 Status dos containers:${NC}"
docker-compose ps

echo ""
echo -e "${GREEN}🌐 Acesse a aplicação:${NC}"
echo "   Frontend: http://localhost:3000"
echo "   Backend:  http://localhost:9090/api/"
echo ""
echo -e "${BLUE}📝 Ver logs:${NC}"
echo "   docker-compose logs -f"
