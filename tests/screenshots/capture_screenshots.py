#!/usr/bin/env python3
"""
Captura screenshots do ShadowIndex usando Chromium headless (Playwright).

Pré-requisitos:
  - Stack no ar com DADOS DE DEMONSTRAÇÃO já populados (tests/seed-demo.sh).
  - Playwright + Chromium instalados (veja tests/capture-screenshots.sh).

Uso:
  python capture_screenshots.py \
      --base-url http://localhost:3000 \
      --out ./out

Gera um PNG por tela em --out, nomeados 01-dashboard.png, 02-servidores.png, ...
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

# Telas com rota fixa. (slug, rota, descrição)
STATIC_PAGES = [
    ("01-dashboard", "/", "Dashboard"),
    ("02-servidores", "/servers", "Lista de servidores"),
    ("05-credenciais", "/credentials", "Credenciais (user/senha, NTLM, Kerberos, token, SSH)"),
    ("06-proxy-servers", "/proxy-servers", "Proxy Servers (SOCKS5/Proxychains e HTTP)"),
    ("07-ad-explorer", "/ad", "AD Explorer - domínios"),
    ("09-leaks", "/leaks", "Leaks (GitLeaks)"),
    ("10-sql", "/sql", "SQL - conexões e enumerações"),
    ("11-configuracoes", "/settings", "Configurações Gerais"),
    ("14-git-repos", "/git", "GIT - repositórios clonados"),
    ("16-git-clone-jobs", "/jobs/git", "GIT - fila de clones"),
    ("17-git-advanced-search", "/search?q=acme&tab=git",
     "Busca avançada - aba Git (conteúdo indexado)"),
]


def _try_click(page, text, exact=False, timeout=2500):
    """Clica no 1º elemento com o texto, ignorando falhas (best-effort)."""
    try:
        page.get_by_text(text, exact=exact).first.click(timeout=timeout)
        page.wait_for_timeout(500)
        return True
    except Exception:  # noqa: BLE001
        return False


def _content_visible(page):
    """True se a aba View já renderizou conteúdo (texto ou PDF)."""
    for sel in ("text=Raw Content", "canvas", ".react-pdf__Page", "text=Página 1"):
        try:
            if page.locator(sel).first.is_visible(timeout=400):
                return True
        except Exception:  # noqa: BLE001
            pass
    return False


def _open_file_view(page, filename):
    """Expande VOL_1, abre o arquivo e garante a aba 'View' com o CONTEÚDO.

    Lida com a condição de corrida: no 1º clique a lista de arquivos baixados
    ainda pode não ter carregado (a aba View só abre quando o arquivo é
    reconhecido como baixado). Por isso reabre e clica em 'View' até o conteúdo
    aparecer.
    """
    _try_click(page, "VOL_1", exact=True)
    page.wait_for_timeout(700)

    for attempt in range(4):
        if not _try_click(page, filename):
            return False
        page.wait_for_timeout(1000)
        # tenta ir para a aba de conteúdo (pode já estar aberta automaticamente)
        _try_click(page, "View", exact=True)
        page.wait_for_timeout(1200)
        if _content_visible(page):
            page.wait_for_timeout(600)
            return True
        print(f"    (retry {attempt + 1}: conteúdo ainda não visível para {filename})")

    return True  # segue mesmo assim; o screenshot mostrará o que houver


def act_server_browse(page):
    """Abre o arquivo de senhas em TEXTO mostrando o conteúdo (aba View)."""
    for fname in ("Senhas Servidores.txt", "robocopy.txt", "conexao.php"):
        if _open_file_view(page, fname):
            break


def act_server_browse_pdf(page):
    """Abre o arquivo de senhas em PDF no visualizador (aba View)."""
    _open_file_view(page, "Credenciais VPN.pdf")
    page.wait_for_timeout(1000)  # tempo extra p/ o pdf.js renderizar


def act_ad_browse(page):
    """Expande algumas OUs da árvore do AD."""
    for ou in ("ADMIN", "USER ACCOUNTS", "GROUPS"):
        _try_click(page, ou, exact=True)
    page.wait_for_timeout(600)


def act_sql_wizard(page):
    """Abre o formulário de nova conexão SQL e preenche o assistente (wizard),
    mostrando a connection string montada no backend."""
    try:
        page.get_by_test_id("toggle-add-form-btn").click(timeout=5000)
        page.wait_for_timeout(500)
        page.get_by_test_id("db-type-select").click(timeout=4000)
        page.wait_for_timeout(300)
        page.get_by_role("option", name="Microsoft SQL Server").click(timeout=4000)
        page.wait_for_timeout(300)
        page.get_by_test_id("db-connection-name-input").fill("SQLPROD01 - Faturamento")
        page.get_by_test_id("wiz-host").fill("10.20.53.62")
        page.get_by_test_id("wiz-database").fill("faturamento")
        page.get_by_test_id("wiz-username").fill("app_reader")
        page.get_by_test_id("wiz-password").fill("S3cr3t!2026")
        page.wait_for_timeout(1400)  # espera o build no backend atualizar o preview
    except Exception as exc:  # noqa: BLE001
        print(f"    (aviso: interação do wizard SQL falhou: {exc})")


def act_git_search(page):
    """Digita um termo de busca (vira um chip ao pressionar Enter)."""
    try:
        box = page.get_by_placeholder("Digite um termo e pressione Enter")
        if not box.count():
            box = page.locator("input[type='text']").first
        box.first.fill("acme")
        box.first.press("Enter")
        page.wait_for_timeout(600)
    except Exception as exc:  # noqa: BLE001
        print(f"    (aviso: interação da busca Git falhou: {exc})")


def act_git_browse(page):
    """Expande uma pasta da árvore e abre um arquivo (abas Info/View)."""
    try:
        folder = page.get_by_test_id("git-tree-folder").first
        folder.click(timeout=4000)
        page.wait_for_timeout(600)
    except Exception as exc:  # noqa: BLE001
        print(f"    (aviso: expandir pasta Git falhou: {exc})")
    try:
        page.get_by_test_id("git-file-row").first.click(timeout=4000)
        page.wait_for_timeout(1000)
        _try_click(page, "Info", exact=True)
        page.wait_for_timeout(800)
    except Exception as exc:  # noqa: BLE001
        print(f"    (aviso: abrir arquivo Git falhou: {exc})")


def _api(base_url: str, path: str):
    url = base_url.rstrip("/") + "/api" + path
    req = urllib.request.Request(url, headers={"User-Agent": "shadowindex-shots"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode())


def resolve_pages(base_url: str):
    """Monta a lista final de páginas, resolvendo IDs dinâmicos (servidor
    featured e domínio AD) via API."""
    pages = list(STATIC_PAGES)

    # Servidor "featured": favorito com mais shares (fallback: 1º da lista).
    try:
        servers = _api(base_url, "/servers")
        favs = [s for s in servers if s.get("favorite") and s.get("shares_count", 0) >= 10]
        chosen = (favs or sorted(servers, key=lambda s: -s.get("shares_count", 0)) or servers)[0]
        pages.append(("03-servidor-browse-txt", f"/servers/{chosen['id']}/browse",
                      f"Browse — arquivo de senhas .txt ({chosen['name']})", act_server_browse))
        pages.append(("04-servidor-browse-pdf", f"/servers/{chosen['id']}/browse",
                      f"Browse — arquivo de senhas .pdf ({chosen['name']})", act_server_browse_pdf))
    except Exception as exc:  # noqa: BLE001
        print(f"(aviso: não foi possível resolver servidor featured: {exc})")

    # Domínio AD (1º).
    try:
        domains = _api(base_url, "/ad/domains")
        domains = domains if isinstance(domains, list) else domains.get("domains", [])
        if domains:
            d = domains[0]
            pages.append(("08-ad-browse", f"/ad/{d['id']}/browse",
                          f"Árvore do domínio {d['name']}", act_ad_browse))
    except Exception as exc:  # noqa: BLE001
        print(f"(aviso: não foi possível resolver domínio AD: {exc})")

    # Assistente (wizard) de conexão SQL
    pages.append(("12-sql-wizard", "/db-connections",
                  "SQL — assistente de conexão (wizard)", act_sql_wizard))

    # GIT — busca no Github (chip de termo)
    pages.append(("13-git-search", "/git/search",
                  "GIT — busca no Github", act_git_search))

    # GIT — navegação no repositório (árvore + abas Info/View). Repo com arquivos.
    try:
        data = _api(base_url, "/git/repos?limit=50")
        repos = data.get("repos", data) if isinstance(data, dict) else data
        repos = repos if isinstance(repos, list) else []
        with_files = [r for r in repos if r.get("files_count", 0) > 0]
        chosen = (with_files or repos or [None])[0]
        if chosen and chosen.get("guid"):
            pages.append(("15-git-browse", f"/git/{chosen['guid']}",
                          f"GIT — navegação no repositório ({chosen.get('full_name', '')})",
                          act_git_browse))
    except Exception as exc:  # noqa: BLE001
        print(f"(aviso: não foi possível resolver repositório Git: {exc})")

    # normaliza para 4-tuplas (slug, rota, desc, action|None)
    norm = [(p + (None,))[:4] for p in pages]
    norm.sort(key=lambda t: t[0])
    return norm


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def capture(base_url: str, out_dir: Path, width: int, height: int,
            full_page: bool, theme: str, wait_ms: int, lang: str = "pt"):
    out_dir.mkdir(parents=True, exist_ok=True)
    results = []
    pages = resolve_pages(base_url)

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
        context = browser.new_context(
            viewport={"width": width, "height": height},
            device_scale_factor=2,  # retina — imagens nítidas
            color_scheme="dark" if theme == "dark" else "light",
            locale="en-US" if lang == "en" else "pt-BR",
        )
        # Força o idioma da aplicação (persistido em localStorage pelo app).
        context.add_init_script(
            f"try {{ localStorage.setItem('shadowindex_lang', '{lang}'); }} catch (e) {{}}"
        )
        page = context.new_page()

        for slug, route, desc, action in pages:
            url = base_url.rstrip("/") + route
            print(f"==> {desc}: {url}")
            try:
                page.goto(url, wait_until="networkidle", timeout=30000)
            except Exception as exc:  # noqa: BLE001
                print(f"    (aviso: networkidle falhou, seguindo: {exc})")
                page.goto(url, wait_until="domcontentloaded", timeout=30000)
            # dá tempo para animações/requests tardios
            page.wait_for_timeout(wait_ms)
            # interação opcional (expandir árvore, abrir arquivo, etc.)
            if action:
                try:
                    action(page)
                except Exception as exc:  # noqa: BLE001
                    print(f"    (aviso: interação falhou: {exc})")
            dest = out_dir / f"{slug}.png"
            page.screenshot(path=str(dest), full_page=full_page)
            print(f"    salvo: {dest}")
            results.append(dest)

        browser.close()

    return results


def main():
    ap = argparse.ArgumentParser(description="Captura screenshots do ShadowIndex (Playwright).")
    ap.add_argument("--base-url", default="http://localhost:3000")
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent / "out"))
    ap.add_argument("--width", type=int, default=1792)
    ap.add_argument("--height", type=int, default=1120)
    ap.add_argument("--full-page", action="store_true", help="Captura a página inteira (scroll).")
    ap.add_argument("--theme", choices=["dark", "light"], default="dark")
    ap.add_argument("--wait-ms", type=int, default=1800, help="Espera extra por página (ms).")
    ap.add_argument("--lang", choices=["en", "pt"], default="pt",
                    help="Idioma da interface nos screenshots (força via localStorage).")
    args = ap.parse_args()

    out_dir = Path(args.out)
    t0 = time.time()
    results = capture(args.base_url, out_dir, args.width, args.height,
                      args.full_page, args.theme, args.wait_ms, args.lang)
    print(f"\n✅ {len(results)} screenshots em {out_dir} ({time.time()-t0:.1f}s)")


if __name__ == "__main__":
    sys.exit(main())
