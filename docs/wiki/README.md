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

## Publicação automática (GitHub Actions)

O workflow [`.github/workflows/publish-wiki.yml`](../../.github/workflows/publish-wiki.yml)
publica esta pasta na Wiki **automaticamente** a cada push na `main` que altere
`docs/wiki/**`. Ele espelha o conteúdo (exceto este `README.md`) para
`<owner>/<repo>.wiki.git`, removendo páginas que não existem mais aqui.

**Pré-requisito (uma única vez):** a Wiki precisa estar **habilitada** em
*Settings → Features → Wikis* e ter **ao menos uma página** criada pela interface
web — isso inicializa o repositório `.wiki.git`. Sem isso, o workflow falha com
uma mensagem explicando o passo. Também é possível rodar manualmente pela aba
**Actions → Publish Wiki → Run workflow**.

O push usa o `GITHUB_TOKEN` padrão (com `permissions: contents: write`), então
não é preciso configurar segredos.

## Publicação manual (alternativa)

```bash
gh repo clone helviojunior/shadowindex.wiki /tmp/si-wiki
rsync -a --delete --exclude='.git/' --exclude='README.md' docs/wiki/ /tmp/si-wiki/
cd /tmp/si-wiki && git add -A && git commit -m "Atualiza Wiki" && git push
```
