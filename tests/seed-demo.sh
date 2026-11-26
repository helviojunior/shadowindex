#!/usr/bin/env bash
#
# Popula o banco do ShadowIndex com DADOS DE DEMONSTRAÇÃO fictícios para
# capturar screenshots do repositório público.
#
# Uso:
#   ./tests/seed-demo.sh                 # usa docker-compose.yml (prod)
#   COMPOSE_FILE=docker-compose.dev.yml ./tests/seed-demo.sh
#   ./tests/seed-demo.sh --keep          # não limpa dados antes de inserir
#
# Requisitos: stack no ar (docker compose up -d). Baixa a BRWordList na 1ª vez.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
SERVICE="${SERVICE:-backend}"
CACHE_DIR="$SCRIPT_DIR/demo_data/.cache"

cd "$ROOT_DIR"

echo "==> Verificando stack ($COMPOSE_FILE / serviço $SERVICE)..."
if ! docker compose -f "$COMPOSE_FILE" ps --status running "$SERVICE" | grep -q "$SERVICE"; then
  echo "ERRO: o serviço '$SERVICE' não está rodando. Suba a stack: docker compose -f $COMPOSE_FILE up -d" >&2
  exit 1
fi

# --- Baixa as listas de nomes no host (cache), para o container não precisar de internet ---
mkdir -p "$CACHE_DIR"
for pair in \
  "nomes.txt|https://raw.githubusercontent.com/helviojunior/BRWordList/master/Nomes/nomes.txt" \
  "sobrenomes.txt|https://raw.githubusercontent.com/helviojunior/BRWordList/master/Nomes/sobrenomes.txt"; do
  fname="${pair%%|*}"; url="${pair##*|}"
  if [ ! -s "$CACHE_DIR/$fname" ]; then
    echo "==> Baixando BRWordList/$fname ..."
    curl -fsSL "$url" -o "$CACHE_DIR/$fname" || echo "   (aviso: falha no download; o seed usará fallback embutido)"
  else
    echo "==> Cache encontrado: $fname"
  fi
done

# --- Copia o pacote de seed para dentro do container e executa ---
echo "==> Copiando scripts de seed para o container..."
docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE" rm -rf /app/demo_seed || true
docker compose -f "$COMPOSE_FILE" cp "$SCRIPT_DIR/demo_data" "$SERVICE:/app/demo_seed"

echo "==> Executando seed..."
docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE" python /app/demo_seed/seed_demo_data.py "$@"

echo "==> Limpando artefatos de seed do container..."
docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE" rm -rf /app/demo_seed || true

echo "==> Pronto. Acesse http://localhost:3000"
