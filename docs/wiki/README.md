# Conteúdo da Wiki do projeto

Esta pasta contém as páginas da **Wiki do GitHub** versionadas junto do código.
No GitHub, a Wiki é um repositório git separado (`<repo>.wiki.git`); cada arquivo
`.md` aqui vira uma página e a pasta `images/` guarda as imagens.

A Wiki é um **guia de uso da ferramenta**, com uma página por funcionalidade, em
**Português** e **Inglês**.

## Estrutura

| Arquivo | Página |
|---------|--------|
| `Home.md` | Página inicial (seletor de idioma) |
| `_Sidebar.md` | Navegação lateral (PT + EN) |
| `images/` | Screenshots usados nas páginas |
| `Dashboard-PT.md` / `Dashboard-EN.md` | Dashboard |
| `Servidores-PT.md` / `Servers-EN.md` | Servidores / Servers |
| `GIT-PT.md` / `GIT-EN.md` | GIT (busca, clone, varredura e indexação de repos) |
| `Arquivos-PT.md` / `Files-EN.md` | Arquivos (browse, OCR, offline) |
| `Credenciais-PT.md` / `Credentials-EN.md` | Credenciais |
| `Proxy-Servers-PT.md` / `Proxy-Servers-EN.md` | Proxy Servers |
| `AD-Explorer-PT.md` / `AD-Explorer-EN.md` | AD Explorer |
| `Leaks-PT.md` / `Leaks-EN.md` | Leaks (GitLeaks) |
| `SQL-PT.md` / `SQL-EN.md` | SQL |
| `Configuracoes-PT.md` / `Settings-EN.md` | Configurações / Settings |

> Convenção de nomes do GitHub Wiki: hífens no nome do arquivo viram espaços no
> título, e os links usam o nome **sem** a extensão `.md`
> (ex.: `[Servidores](Servidores-PT)`). As imagens são referenciadas como
> `images/arquivo.png`.

## Publicação automática (GitHub Actions)

O workflow [`.github/workflows/publish-wiki.yml`](../../.github/workflows/publish-wiki.yml)
publica esta pasta na Wiki **automaticamente** a cada push na `main` que altere
`docs/wiki/**` (incluindo as imagens). Ele espelha o conteúdo (exceto este
`README.md`) para `<owner>/<repo>.wiki.git`, removendo páginas que não existem
mais aqui.

**Pré-requisito (uma única vez):** habilite a Wiki em *Settings → Features →
Wikis* e crie **uma primeira página** pela interface web (isso inicializa o
repositório `.wiki.git`). Também é possível rodar manualmente em **Actions →
Publish Wiki → Run workflow**.

## Atualizando os screenshots

As imagens em `images/` são geradas pelos scripts de demonstração do repositório
(veja `tests/demo_data/` e `tests/screenshots/`). Para regenerá-las:

```bash
docker compose up -d
./tests/seed-demo.sh
./tests/capture-screenshots.sh
# copie os PNGs de tests/screenshots/out/ para docs/wiki/images/
```

## Publicação manual (alternativa)

```bash
gh repo clone helviojunior/shadowindex.wiki /tmp/si-wiki
rsync -a --delete --exclude='.git/' --exclude='README.md' docs/wiki/ /tmp/si-wiki/
cd /tmp/si-wiki && git add -A && git commit -m "Atualiza Wiki" && git push
```
