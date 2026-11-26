"""
Gerador de nomes fictícios e utilitários de anonimização para os dados de
demonstração do ShadowIndex.

- Baixa (e cacheia) as listas de nomes brasileiros do projeto BRWordList
  (https://github.com/helviojunior/BRWordList) na primeira execução.
- Caso não haja internet/cache, usa uma lista embutida reduzida como fallback.
- Fornece helpers determinísticos (seed fixo) para que uma mesma execução
  gere sempre o mesmo conjunto de dados — bom para screenshots reproduzíveis.

IMPORTANTE (anonimização): nenhum dado real de cliente é utilizado. Todos os
nomes de usuário, servidores e domínios são sintéticos. As constantes abaixo
também permitem "limpar" qualquer string que porventura contenha marcas reais.
"""

from __future__ import annotations

import os
import random
import urllib.request
from pathlib import Path

# ---------------------------------------------------------------------------
# Anonimização — substituições aplicadas a qualquer string de origem.
# ---------------------------------------------------------------------------
# Domínio/tenant fictício usado em todo o dataset de demonstração.
DEMO_DOMAIN = "tests.local"
DEMO_DOMAIN_UPPER = "TESTS.LOCAL"
DEMO_NETBIOS = "TESTS"

# Mapa de substituição (case-insensitive) de marcas reais -> fictícias.
ANONYMIZE_MAP = {
    "sbsp.corp": DEMO_DOMAIN,
    "sbsp": DEMO_NETBIOS,
    "sabesp": "tests",
}

CACHE_DIR = Path(__file__).resolve().parent / ".cache"
NOMES_URL = "https://raw.githubusercontent.com/helviojunior/BRWordList/master/Nomes/nomes.txt"
SOBRENOMES_URL = "https://raw.githubusercontent.com/helviojunior/BRWordList/master/Nomes/sobrenomes.txt"

# Fallback reduzido (usado apenas se o download/cache falhar).
_FALLBACK_NOMES = [
    "adriano", "ana", "bruno", "carla", "daniel", "eduardo", "fabiana",
    "gustavo", "helena", "igor", "juliana", "leandro", "mariana", "nelson",
    "otavio", "patricia", "rafael", "sandra", "thiago", "vanessa", "wagner",
    "amanda", "felipe", "larissa", "marcelo", "renata", "ricardo", "camila",
]
_FALLBACK_SOBRENOMES = [
    "silva", "santos", "oliveira", "souza", "pereira", "costa", "rodrigues",
    "almeida", "nascimento", "lima", "araujo", "fernandes", "carvalho",
    "gomes", "martins", "rocha", "ribeiro", "alves", "monteiro", "barbosa",
]


def anonymize(text: str) -> str:
    """Aplica o mapa de anonimização (case-insensitive) a uma string."""
    if not text:
        return text
    out = text
    for real, fake in ANONYMIZE_MAP.items():
        # Substituição case-insensitive preservando nada do original.
        lowered = out.lower()
        if real in lowered:
            start = 0
            result = []
            while True:
                idx = lowered.find(real, start)
                if idx == -1:
                    result.append(out[start:])
                    break
                result.append(out[start:idx])
                result.append(fake)
                start = idx + len(real)
            out = "".join(result)
            lowered = out.lower()
    return out


def _download(url: str, dest: Path) -> bool:
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(url, headers={"User-Agent": "shadowindex-demo-seed"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = resp.read()
        dest.write_bytes(data)
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"[namegen] aviso: falha ao baixar {url}: {exc}")
        return False


def _load_wordlist(url: str, filename: str, fallback: list[str]) -> list[str]:
    cache_file = CACHE_DIR / filename
    if not cache_file.exists():
        _download(url, cache_file)
    if cache_file.exists():
        try:
            words = [
                w.strip().lower()
                for w in cache_file.read_text(encoding="utf-8", errors="ignore").splitlines()
                if w.strip() and w.strip().isascii() and w.strip().isalpha()
            ]
            # Dedup preservando ordem.
            seen = set()
            uniq = []
            for w in words:
                if w not in seen:
                    seen.add(w)
                    uniq.append(w)
            if len(uniq) >= 50:
                return uniq
        except Exception as exc:  # noqa: BLE001
            print(f"[namegen] aviso: falha ao ler {cache_file}: {exc}")
    print(f"[namegen] usando fallback embutido para {filename}")
    return list(fallback)


class NameGenerator:
    """Gera nomes/usuários/servidores fictícios de forma determinística."""

    def __init__(self, seed: int = 1337):
        self.rnd = random.Random(seed)
        self.nomes = _load_wordlist(NOMES_URL, "nomes.txt", _FALLBACK_NOMES)
        self.sobrenomes = _load_wordlist(SOBRENOMES_URL, "sobrenomes.txt", _FALLBACK_SOBRENOMES)
        self._used_usernames: set[str] = set()

    # -- pessoas -----------------------------------------------------------
    def first(self) -> str:
        return self.rnd.choice(self.nomes)

    def last(self) -> str:
        return self.rnd.choice(self.sobrenomes)

    def full_name(self) -> str:
        """'Fulano Beltrano Silva' (display name, Title Case)."""
        parts = [self.first(), self.last()]
        if self.rnd.random() < 0.4:
            parts.insert(1, self.last())
        return " ".join(p.capitalize() for p in parts)

    def username(self, prefix: str = "") -> str:
        """Gera samAccountName único no estilo 't.nome.sobrenome' ou 'nome.sobrenome'."""
        for _ in range(100):
            n, s = self.first(), self.last()
            style = self.rnd.random()
            if style < 0.5:
                u = f"{n}.{s}"
            elif style < 0.8:
                u = f"{n[0]}{s}"
            else:
                u = f"{n}{self.rnd.randint(1, 99)}"
            u = f"{prefix}{u}"
            if u not in self._used_usernames:
                self._used_usernames.add(u)
                return u
        # fallback
        u = f"{prefix}{self.first()}{self.rnd.randint(100, 9999)}"
        self._used_usernames.add(u)
        return u

    # -- infraestrutura ----------------------------------------------------
    def server_name(self) -> str:
        """Nome de host no estilo corporativo (ex.: spo-file0012, vmwapp003)."""
        prefixes = ["spo", "rio", "bhz", "vmw", "srv", "fs", "app", "web"]
        roles = ["file", "info", "app", "sql", "web", "data", "dc", "desoper", "adsp", "ctfxp"]
        p = self.rnd.choice(prefixes)
        r = self.rnd.choice(roles)
        n = self.rnd.randint(1, 9999)
        style = self.rnd.random()
        if style < 0.5:
            return f"{p}-{r}{n:05d}"
        if style < 0.8:
            return f"{p}{r}{n:03d}"
        return f"{p}-{r}{n}"

    def ip(self, octet2_choices=(7, 10, 20, 99)) -> str:
        a = self.rnd.choice(octet2_choices)
        b = self.rnd.randint(1, 240)
        c = self.rnd.randint(2, 254)
        return f"10.{a}.{b}.{c}"

    def choice(self, seq):
        return self.rnd.choice(seq)

    def randint(self, a, b):
        return self.rnd.randint(a, b)

    def random(self):
        return self.rnd.random()

    def sample(self, seq, k):
        return self.rnd.sample(list(seq), k)


if __name__ == "__main__":  # teste rápido
    g = NameGenerator()
    print("Domínio:", DEMO_DOMAIN)
    for _ in range(5):
        print(" usuário:", g.username(), "| display:", g.full_name(),
              "| host:", g.server_name(), "| ip:", g.ip())
    print("anonymize('spo-info10027.sbsp.corp') ->", anonymize("spo-info10027.sbsp.corp"))
    print("anonymize('wildcard_sabesp_com_br.pfx') ->", anonymize("wildcard_sabesp_com_br.pfx"))
