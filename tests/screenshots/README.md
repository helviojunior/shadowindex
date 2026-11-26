# Screenshots (Chromium headless)

Gera screenshots das telas do ShadowIndex com **Playwright + Chromium headless**,
para o README e a Wiki do repositório público.

## Como usar

1. Suba a stack e popule os dados de demonstração:
   ```bash
   docker compose up -d
   ./tests/seed-demo.sh
   ```
2. Gere os screenshots:
   ```bash
   ./tests/capture-screenshots.sh
   ```

O wrapper cria um virtualenv isolado em `.venv/`, instala o Playwright + Chromium
e roda a captura. As imagens vão para `tests/screenshots/out/`.

### Opções (variáveis de ambiente)

| Variável | Default | Descrição |
|----------|---------|-----------|
| `BASE_URL` | `http://localhost:3000` | URL da aplicação |
| `OUT_DIR` | `tests/screenshots/out` | Pasta de saída |
| `FULL_PAGE` | `0` | `1` captura a página inteira (com scroll) |
| `PYTHON` | `python3` | Interpretador usado no venv |

Execução direta (sem o wrapper), com o venv já ativo:

```bash
python tests/screenshots/capture_screenshots.py --base-url http://localhost:3000 --out ./out
# flags: --width --height --full-page --theme {dark,light} --wait-ms
```

## Telas capturadas

Dashboard, Servidores, **Browse de servidor** (árvore + arquivo aberto),
Credenciais, Proxy Servers, AD Explorer (domínios e **árvore**), Leaks, SQL e
Configurações. Os IDs de servidor/domínio são resolvidos automaticamente via API.

## Requisitos

- Python 3.9+ (o wrapper cria o venv automaticamente).
- A aplicação precisa estar **populada** (rode `./tests/seed-demo.sh` antes),
  senão as telas aparecem vazias.
