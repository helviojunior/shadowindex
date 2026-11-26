# Dados de Demonstração

O ShadowIndex inclui um *seed* que popula o banco com dados **fictícios** para
testes, demonstrações e para capturar screenshots do repositório público.

> ⚠️ **Nenhum dado real de cliente é utilizado.** Tudo é sintético: o domínio é
> sempre `tests.local` e os nomes de usuário/servidor são gerados a partir da
> [BRWordList](https://github.com/helviojunior/BRWordList).

## Pré-requisitos

- Stack no ar: `docker compose up -d`
- Acesso à internet na **primeira** execução (para baixar as listas de nomes,
  depois ficam em cache).

## Executando

```bash
# produção (docker-compose.yml)
./tests/seed-demo.sh

# ambiente de desenvolvimento (docker-compose.dev.yml)
COMPOSE_FILE=docker-compose.dev.yml ./tests/seed-demo.sh

# acumular sem limpar os dados anteriores
./tests/seed-demo.sh --keep
```

Ao final, acesse **http://localhost:3000**.

## O que é gerado

| Área | Conteúdo |
|------|----------|
| **Servidores** | ~30 servidores `*.tests.local` com índice de risco, leaks, shares e downloads. 1 servidor "featured" tem o share `VOL_1` com árvore de pastas e **arquivos reais** (abrem em *View* e têm *OCR*). |
| **Credenciais** | usuário/senha · **NTLM (hash, sem senha em claro)** · **Kerberos (ccache)** — um ticket expirado e um válido · token *bearer* · chave SSH. |
| **Proxy Servers** | **SOCKS5 (Proxychains)** e HTTP. |
| **AD Explorer** | domínio `tests.local` com ~123 objetos (OUs `ADMIN/TIER 0`, `USER ACCOUNTS`, `DEVICES`, `DOMAIN CONTROLLERS`, `GROUPS`...) no padrão **BloodHound v6**, além de um job de importação concluído. |
| **Leaks** | ~7 findings do GitLeaks (certificados PFX, senhas identificadas manualmente, segredos de scan) com o cálculo de risco por tipo de regra. |
| **SQL** | 4 conexões (MS-SQL, MySQL, PostgreSQL, Oracle) e um histórico de **enumerações** (listar bancos, usuários/logins e tabelas). |

## Como funciona

1. `tests/seed-demo.sh` baixa e cacheia as listas de nomes em
   `tests/demo_data/.cache/`.
2. Copia o pacote `tests/demo_data/` para dentro do container `backend`.
3. Executa `seed_demo_data.py`, que importa os *models* do backend e insere os
   registros diretamente no Postgres (e grava os arquivos de exemplo no storage
   em `shadowindex_data/storage/`).

O seed é **determinístico** (semente fixa): duas execuções produzem o mesmo
conjunto de dados. Por padrão ele **limpa** os dados de demonstração antes de
inserir — use `--keep` para acumular.

## Reset completo

Para começar de um banco vazio:

```bash
docker compose down -v        # remove o volume do Postgres
docker compose up -d
./tests/seed-demo.sh
```

## Anonimização de dados de origem

Caso algum dia se queira derivar a demonstração a partir de dados reais, o
módulo `tests/demo_data/namegen.py` expõe:

- `anonymize(texto)` — aplica um mapa de substituição case-insensitive;
- `ANONYMIZE_MAP` — `sbsp.corp → tests.local`, `sabesp → tests`, etc.;
- `NameGenerator` — gera usuários, nomes e hosts fictícios.

Assim, qualquer string contendo marcas reais é trocada por equivalentes
fictícios antes de ser persistida.

## Veja também

- **[Gerando Screenshots](Gerando-Screenshots)**
- `tests/demo_data/README.md` no repositório
