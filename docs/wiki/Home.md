# ShadowIndex

**Enterprise Data Discovery & Credential Intelligence Platform** — descoberta de
dados em shares SMB, OCR/indexação, detecção de *leaks*, exploração de Active
Directory e execução de queries em bancos de dados, com **armazenamento local
para visualização offline**.

🌐 **Idioma / Language:** **Português** · [English](#english)

---

## Português

Guia de uso, uma página por funcionalidade:

| Funcionalidade | Descrição |
|----------------|-----------|
| [Dashboard](Dashboard-PT) | Visão geral e métricas |
| [Servidores](Servidores-PT) | Inventário de servidores, risco, leaks, shares |
| [GIT](GIT-PT) | Buscar no GitHub, clonar, varrer e indexar repositórios |
| [Arquivos](Arquivos-PT) | Navegar shares, visualizar conteúdo, OCR e offline |
| [Credenciais](Credenciais-PT) | Usuário/senha, NTLM, Kerberos, token, SSH |
| [Proxy Servers](Proxy-Servers-PT) | SOCKS5 (Proxychains) e HTTP |
| [AD Explorer](AD-Explorer-PT) | Domínios e árvore do Active Directory |
| [Leaks](Leaks-PT) | Detecção de secrets/credenciais (GitLeaks) |
| [SQL](SQL-PT) | Conexões e enumeração de bancos de dados |
| [Configurações](Configuracoes-PT) | Aparência, downloads, OCR e mais |

### Começando

```bash
git clone https://github.com/helviojunior/shadowindex.git
cd shadowindex
docker compose up -d        # http://localhost:3000
```

---

## English

Usage guide, one page per feature:

| Feature | Description |
|---------|-------------|
| [Dashboard](Dashboard-EN) | Overview and metrics |
| [Servers](Servers-EN) | Server inventory, risk, leaks, shares |
| [GIT](GIT-EN) | Search GitHub, clone, scan and index repositories |
| [Files](Files-EN) | Browse shares, view content, OCR and offline |
| [Credentials](Credentials-EN) | User/password, NTLM, Kerberos, token, SSH |
| [Proxy Servers](Proxy-Servers-EN) | SOCKS5 (Proxychains) and HTTP |
| [AD Explorer](AD-Explorer-EN) | Active Directory domains and tree |
| [Leaks](Leaks-EN) | Secret/credential detection (GitLeaks) |
| [SQL](SQL-EN) | Database connections and enumeration |
| [Settings](Settings-EN) | Appearance, downloads, OCR and more |

### Getting started

```bash
git clone https://github.com/helviojunior/shadowindex.git
cd shadowindex
docker compose up -d        # http://localhost:3000
```

> As telas desta Wiki usam dados **fictícios** (domínio `tests.local`). /
> The screens in this Wiki use **fictitious** data (`tests.local` domain).
