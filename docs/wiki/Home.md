# ShadowIndex — Wiki

**ShadowIndex** — *Enterprise Data Discovery & Credential Intelligence Platform.*
Descoberta de dados, navegação de shares SMB, OCR/indexação, detecção de
*leaks* (GitLeaks), exploração de Active Directory (BloodHound/LDAP) e execução
de queries em bancos de dados — tudo em uma interface única.

> Esta wiki cobre **como subir, demonstrar e documentar** o projeto. Para o
> passo a passo de instalação com Docker, veja também o `README.md` e o
> `DOCKER_COMPOSE_README.md` no repositório.

## Armazenamento local e visualização offline

Todos os dados coletados dos servidores — **arquivos baixados, seu conteúdo e o
texto extraído por OCR** — ficam **armazenados localmente** (no volume de dados
da aplicação, em `shadowindex_data/`). Isso permite **visualizar, pesquisar e
navegar por tudo offline**, sem depender de acesso contínuo ao servidor de
origem. Depois de indexado, um arquivo pode ser aberto, lido e ter seu OCR
consultado mesmo que o servidor original esteja indisponível.

## Primeiros passos

```bash
git clone https://github.com/helviojunior/shadowindex.git
cd shadowindex
docker compose up -d           # sobe backend, Postgres, Tika e nginx
# Aplicação disponível em http://localhost:3000
```

## Índice

- **[Dados de Demonstração](Dados-de-Demonstracao)** — popular o banco com dados
  fictícios (servidores, credenciais, AD, leaks, SQL) para testes e demonstração.
- **[Gerando Screenshots](Gerando-Screenshots)** — capturar screenshots das telas
  com Chromium headless para o README/Wiki.

## Principais telas

| Tela | Rota | O que mostra |
|------|------|--------------|
| Dashboard | `/` | Visão geral e métricas |
| Servidores | `/servers` | Inventário com risco, leaks, shares e downloads |
| Browse de servidor | `/servers/:id/browse` | Árvore de shares/arquivos, view e OCR |
| Credenciais | `/credentials` | Usuário/senha, NTLM, Kerberos (ccache), token, SSH |
| Proxy Servers | `/proxy-servers` | SOCKS5 (Proxychains) e HTTP |
| AD Explorer | `/ad` | Domínios e árvore de objetos (BloodHound v6) |
| Leaks | `/leaks` | Findings do GitLeaks |
| SQL | `/sql` | Conexões e enumerações em bancos de dados |

## Convenções

- Os dados de demonstração usam **exclusivamente** o domínio fictício
  `tests.local` e nomes gerados a partir da
  [BRWordList](https://github.com/helviojunior/BRWordList). Nenhum dado real de
  cliente é versionado ou publicado.
