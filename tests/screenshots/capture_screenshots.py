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
]


def _try_click(page, text, exact=False, timeout=2500):
    """Clica no 1º elemento com o texto, ignorando falhas (best-effort)."""
    try:
        page.get_by_text(text, exact=exact).first.click(timeout=timeout)
        page.wait_for_timeout(500)
        return True
    except Exception:  # noqa: BLE001
        return False


def act_server_browse(page):
    """Expande o share VOL_1 e abre um arquivo para mostrar o conteúdo."""
    _try_click(page, "VOL_1", exact=True)
    page.wait_for_timeout(600)
    for fname in ("robocopy.txt", "conexao.php", "Senha Cluster.txt"):
        if _try_click(page, fname):
            break
    page.wait_for_timeout(800)


def act_ad_browse(page):
    """Expande algumas OUs da árvore do AD."""
    for ou in ("ADMIN", "USER ACCOUNTS", "GROUPS"):
        _try_click(page, ou, exact=True)
    page.wait_for_timeout(600)


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
        pages.append(("03-servidor-browse", f"/servers/{chosen['id']}/browse",
                      f"Browse do servidor {chosen['name']}", act_server_browse))
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

    # normaliza para 4-tuplas (slug, rota, desc, action|None)
    norm = [(p + (None,))[:4] for p in pages]
    norm.sort(key=lambda t: t[0])
    return norm


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def capture(base_url: str, out_dir: Path, width: int, height: int,
            full_page: bool, theme: str, wait_ms: int):
    out_dir.mkdir(parents=True, exist_ok=True)
    results = []
    pages = resolve_pages(base_url)

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
        context = browser.new_context(
            viewport={"width": width, "height": height},
            device_scale_factor=2,  # retina — imagens nítidas
            color_scheme="dark" if theme == "dark" else "light",
            locale="pt-BR",
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
    args = ap.parse_args()

    out_dir = Path(args.out)
    t0 = time.time()
    results = capture(args.base_url, out_dir, args.width, args.height,
                      args.full_page, args.theme, args.wait_ms)
    print(f"\n✅ {len(results)} screenshots em {out_dir} ({time.time()-t0:.1f}s)")


if __name__ == "__main__":
    sys.exit(main())
