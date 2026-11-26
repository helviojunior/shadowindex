# Dados de demonstração (seed)

Popula o banco do ShadowIndex com dados **fictícios** para capturar screenshots
do repositório público. **Nenhum dado real de cliente é utilizado.**

## Como usar

Com a stack no ar (`docker compose up -d`):

```bash
./tests/seed-demo.sh                 # docker-compose.yml (produção)
COMPOSE_FILE=docker-compose.dev.yml ./tests/seed-demo.sh   # ambiente dev
./tests/seed-demo.sh --keep          # não limpa antes de inserir
```

O wrapper:
1. baixa (e cacheia em `.cache/`) as listas de nomes da
   [BRWordList](https://github.com/helviojunior/BRWordList);
2. copia este pacote para dentro do container `backend`;
3. executa `seed_demo_data.py` (que usa os models do backend e o Postgres).

## O que é gerado

| Área | Conteúdo |
|------|----------|
| Servidores | ~30 servidores (`*.tests.local`) com risco/leaks/shares/downloads; 1 "featured" com share `VOL_1`, árvore de pastas e arquivos reais (view/OCR) |
| Credenciais | usuário/senha, **NTLM (hash)**, **Kerberos (ccache)** expirado e válido, token, chave SSH |
| Proxy | **SOCKS5 (Proxychains)** e HTTP |
| AD Explorer | domínio `tests.local` + ~123 objetos (OUs, usuários, computadores, grupos) no padrão BloodHound v6 + job concluído |
| Leaks | ~7 findings do GitLeaks (PFX, senha manual, segredos de scan) |
| SQL | 4 conexões (MS-SQL/MySQL/PostgreSQL/Oracle) + histórico de enumerações |

## Anonimização

Todos os nomes são sintéticos (domínio `tests.local`, usuários da BRWordList).
O helper [`namegen.py`](namegen.py) também expõe `anonymize()` e um
`ANONYMIZE_MAP` que troca marcas reais (`sbsp.corp` → `tests.local`,
`sabesp` → `tests`) caso algum dado de origem venha a ser reaproveitado.

## Arquivos

- `seed_demo_data.py` — seed principal (roda dentro do container).
- `namegen.py` — download/cache das listas de nomes + geradores determinísticos.
- `.cache/` — listas baixadas (ignorado pelo git).

> O seed é **determinístico** (seed fixo), então duas execuções geram o mesmo
> conjunto — bom para screenshots reproduzíveis. Por padrão ele **limpa** os
> dados de demonstração antes de inserir (use `--keep` para acumular).
