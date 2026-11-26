# Conteúdo da Wiki do projeto

Esta pasta contém as páginas da **Wiki do GitHub** versionadas junto do código,
para facilitar revisão em Pull Requests. No GitHub, a Wiki é um repositório git
separado (`<repo>.wiki.git`); cada arquivo `.md` aqui vira uma página.

## Páginas

| Arquivo | Página na Wiki |
|---------|----------------|
| `Home.md` | Página inicial |
| `Dados-de-Demonstracao.md` | Dados de Demonstração |
| `Gerando-Screenshots.md` | Gerando Screenshots |
| `_Sidebar.md` | Barra lateral de navegação |

> Convenção de nomes do GitHub Wiki: hífens no nome do arquivo viram espaços no
> título da página, e os links usam o nome **sem** a extensão `.md`
> (ex.: `[Dados de Demonstração](Dados-de-Demonstracao)`).

## Publicando na Wiki do GitHub

A Wiki precisa estar habilitada no repositório (Settings → Features → Wikis) e
ter pelo menos uma página criada pela interface web (isso inicializa o repo da
wiki).

```bash
# clone o repositório da wiki (separado do código)
git clone https://github.com/helviojunior/shadowindex.wiki.git
cd shadowindex.wiki

# copie as páginas desta pasta
cp /caminho/para/shadowindex/docs/wiki/*.md .

git add .
git commit -m "Atualiza Wiki: dados de demonstração e screenshots"
git push
```

Alternativa com `gh` e um checkout temporário:

```bash
gh repo clone helviojunior/shadowindex.wiki /tmp/si-wiki
cp docs/wiki/*.md /tmp/si-wiki/
cd /tmp/si-wiki && git add . && git commit -m "Atualiza Wiki" && git push
```
