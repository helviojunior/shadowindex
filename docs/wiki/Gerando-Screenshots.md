# Gerando Screenshots

Captura automatizada das telas do ShadowIndex com **Chromium headless**
(via [Playwright](https://playwright.dev/python/)), para o README e a Wiki.

## Fluxo completo

```bash
# 1) subir a stack
docker compose up -d

# 2) popular com dados de demonstração (ver "Dados de Demonstração")
./tests/seed-demo.sh

# 3) capturar os screenshots
./tests/capture-screenshots.sh
```

As imagens são salvas em `tests/screenshots/out/` (ex.: `01-dashboard.png`,
`02-servidores.png`, `03-servidor-browse.png`, ...).

> O wrapper cria um virtualenv isolado em `tests/screenshots/.venv/`, instala o
> Playwright e baixa o Chromium automaticamente na primeira execução.

## Opções

Via variáveis de ambiente no wrapper:

| Variável | Default | Descrição |
|----------|---------|-----------|
| `BASE_URL` | `http://localhost:3000` | URL da aplicação |
| `OUT_DIR` | `tests/screenshots/out` | Pasta de saída |
| `FULL_PAGE` | `0` | `1` captura a página inteira (com scroll) |
| `PYTHON` | `python3` | Interpretador para o venv |

```bash
FULL_PAGE=1 OUT_DIR=/tmp/shots ./tests/capture-screenshots.sh
```

Ou diretamente (com o venv ativo):

```bash
python tests/screenshots/capture_screenshots.py \
  --base-url http://localhost:3000 --out ./out \
  --theme dark --width 1792 --height 1120 --wait-ms 1800
```

## Telas capturadas

Dashboard · Servidores · **Browse de servidor** (expande `VOL_1` e abre um
arquivo) · Credenciais · Proxy Servers · AD Explorer (domínios) · **AD browse**
(expande a árvore e seleciona um objeto) · Leaks · SQL · Configurações.

Os IDs dinâmicos (servidor "featured" e domínio do AD) são resolvidos
automaticamente consultando a API — não é preciso editar o script.

## Dicas

- Se as telas aparecerem **vazias**, rode `./tests/seed-demo.sh` antes.
- Para tema claro: `--theme light`.
- Para imagens maiores/nítidas o script já usa `device_scale_factor=2` (retina).
- As interações de árvore são *best-effort*: se um seletor não for encontrado, o
  screenshot ainda é gerado (apenas sem a expansão).

## Veja também

- **[Dados de Demonstração](Dados-de-Demonstracao)**
- `tests/screenshots/README.md` no repositório
