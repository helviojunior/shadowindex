#!/usr/bin/env bash
#
# Gera os screenshots do ShadowIndex com Chromium headless (Playwright).
#
# Fluxo completo (recomendado):
#   ./tests/seed-demo.sh            # popula o banco com dados fictícios
#   ./tests/capture-screenshots.sh  # captura as telas
#
# Cria um virtualenv isolado em tests/screenshots/.venv na primeira execução,
# instala o Playwright + Chromium e roda a captura.
#
# Variáveis:
#   BASE_URL   (default http://localhost:3000)
#   OUT_DIR    (default tests/screenshots/out)
#   FULL_PAGE  (set para 1 para capturar a página inteira com scroll)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHOTS_DIR="$SCRIPT_DIR/screenshots"
VENV="$SHOTS_DIR/.venv"
BASE_URL="${BASE_URL:-http://localhost:3000}"
OUT_DIR="${OUT_DIR:-$SHOTS_DIR/out}"

PY="${PYTHON:-python3}"

echo "==> Verificando a aplicação em $BASE_URL ..."
if ! curl -fsS -o /dev/null "$BASE_URL/api/"; then
  echo "ERRO: $BASE_URL/api/ não respondeu. Suba a stack e rode ./tests/seed-demo.sh antes." >&2
  exit 1
fi

if [ ! -d "$VENV" ]; then
  echo "==> Criando virtualenv em $VENV ..."
  "$PY" -m venv "$VENV"
fi
# shellcheck disable=SC1091
source "$VENV/bin/activate"

echo "==> Instalando dependências (Playwright) ..."
pip install --quiet --upgrade pip
pip install --quiet -r "$SHOTS_DIR/requirements.txt"

echo "==> Instalando Chromium para o Playwright ..."
python -m playwright install chromium

ARGS=(--base-url "$BASE_URL" --out "$OUT_DIR" --lang "${LANG_UI:-pt}")
if [ "${FULL_PAGE:-0}" = "1" ]; then
  ARGS+=(--full-page)
fi

echo "==> Capturando screenshots ..."
python "$SHOTS_DIR/capture_screenshots.py" "${ARGS[@]}"

echo "==> Screenshots em: $OUT_DIR"
