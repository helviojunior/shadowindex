#!/usr/bin/env python3
"""
Script de Migração SQLite -> PostgreSQL

Este script migra todos os dados do SQLite para PostgreSQL.

Uso:
    python migrate_sqlite_to_postgres.py --sqlite-path ./data/shadowindex.db --postgres-url postgresql://user:pass@host:5432/dbname

Ou usando variáveis de ambiente:
    SQLITE_PATH=./data/shadowindex.db POSTGRES_URL=postgresql://... python migrate_sqlite_to_postgres.py
"""

import os
import sys
import sqlite3
import argparse
from datetime import datetime

# Tentar importar psycopg2
try:
    import psycopg2
    from psycopg2.extras import execute_batch
except ImportError:
    print("ERRO: psycopg2 não instalado. Execute: pip install psycopg2-binary")
    sys.exit(1)


# Ordem de migração (respeitando foreign keys)
TABLES_ORDER = [
    'alembic_version',
    'servers',
    'credentials',
    'server_shares',
    'server_items',
    'downloaded_files',
    'file_versions',
    'download_jobs',
    'scan_jobs',
    'ocr_jobs',
    'app_settings',
    'proxy_servers',
    'db_connections',
    'soap_apis',
    'database_types',
    'plugin_instances',
    'pfx_passwords',
    'gitleaks_findings',
    'gitleaks_scan_jobs',
]


def get_sqlite_tables(sqlite_conn):
    """Retorna lista de tabelas no SQLite"""
    cursor = sqlite_conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    tables = [row[0] for row in cursor.fetchall()]
    cursor.close()
    return tables


def get_table_columns(sqlite_conn, table_name):
    """Retorna informações das colunas de uma tabela"""
    cursor = sqlite_conn.cursor()
    cursor.execute(f"PRAGMA table_info({table_name})")
    columns = []
    for row in cursor.fetchall():
        columns.append({
            'cid': row[0],
            'name': row[1],
            'type': row[2],
            'notnull': row[3],
            'default': row[4],
            'pk': row[5]
        })
    cursor.close()
    return columns


def get_table_data(sqlite_conn, table_name, columns):
    """Retorna todos os dados de uma tabela"""
    cursor = sqlite_conn.cursor()
    col_names = [c['name'] for c in columns]
    cursor.execute(f"SELECT {', '.join(col_names)} FROM {table_name}")
    rows = cursor.fetchall()
    cursor.close()
    return rows


def create_postgres_table_ddl(table_name, columns):
    """Gera DDL para criar tabela no PostgreSQL"""
    type_mapping = {
        'INTEGER': 'INTEGER',
        'TEXT': 'TEXT',
        'VARCHAR': 'VARCHAR',
        'BOOLEAN': 'BOOLEAN',
        'DATETIME': 'TIMESTAMP',
        'FLOAT': 'DOUBLE PRECISION',
        'REAL': 'DOUBLE PRECISION',
        'BLOB': 'BYTEA',
        'JSON': 'JSONB',
    }
    
    col_defs = []
    pk_cols = []
    
    for col in columns:
        col_name = col['name']
        col_type = col['type'].upper() if col['type'] else 'TEXT'
        
        # Mapear tipo
        pg_type = 'TEXT'
        for sqlite_type, postgres_type in type_mapping.items():
            if sqlite_type in col_type:
                pg_type = postgres_type
                break
        
        # Verificar se é VARCHAR com tamanho
        if 'VARCHAR' in col_type:
            import re
            match = re.search(r'VARCHAR\((\d+)\)', col_type)
            if match:
                pg_type = f'VARCHAR({match.group(1)})'
        
        # Primary key
        if col['pk']:
            pk_cols.append(col_name)
            if col_type == 'INTEGER' and col['pk'] == 1:
                pg_type = 'SERIAL'
        
        # NOT NULL
        not_null = ' NOT NULL' if col['notnull'] and not col['pk'] else ''
        
        # Default
        default = ''
        if col['default'] is not None:
            default = f" DEFAULT {col['default']}"
        
        col_defs.append(f'    "{col_name}" {pg_type}{not_null}{default}')
    
    # Primary key constraint
    if pk_cols:
        col_defs.append(f'    PRIMARY KEY ({", ".join(pk_cols)})')
    
    ddl = f'CREATE TABLE IF NOT EXISTS "{table_name}" (\n'
    ddl += ',\n'.join(col_defs)
    ddl += '\n);'
    
    return ddl


def migrate_table(sqlite_conn, pg_conn, table_name, batch_size=1000):
    """Migra uma tabela do SQLite para PostgreSQL"""
    columns = get_table_columns(sqlite_conn, table_name)
    if not columns:
        print(f"  ⚠️  Tabela {table_name} não tem colunas, pulando...")
        return 0
    
    col_names = [c['name'] for c in columns]
    
    # Buscar dados do SQLite
    rows = get_table_data(sqlite_conn, table_name, columns)
    
    if not rows:
        print(f"  ⚠️  Tabela {table_name} está vazia")
        return 0
    
    # Preparar INSERT para PostgreSQL
    placeholders = ', '.join(['%s'] * len(col_names))
    col_names_quoted = ', '.join([f'"{c}"' for c in col_names])
    insert_sql = f'INSERT INTO "{table_name}" ({col_names_quoted}) VALUES ({placeholders}) ON CONFLICT DO NOTHING'
    
    # Inserir em batches
    pg_cursor = pg_conn.cursor()
    
    total_inserted = 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i + batch_size]
        
        # Converter valores None e tipos especiais
        converted_batch = []
        for row in batch:
            converted_row = []
            for idx, val in enumerate(row):
                col_type = columns[idx]['type'].upper() if columns[idx]['type'] else ''
                
                # Converter booleanos
                if 'BOOLEAN' in col_type:
                    if val is not None:
                        val = bool(val)
                
                converted_row.append(val)
            converted_batch.append(tuple(converted_row))
        
        try:
            execute_batch(pg_cursor, insert_sql, converted_batch)
            total_inserted += len(batch)
        except Exception as e:
            print(f"  ❌ Erro inserindo batch em {table_name}: {e}")
            pg_conn.rollback()
            # Tentar inserir um por um para identificar o problema
            for row in converted_batch:
                try:
                    pg_cursor.execute(insert_sql, row)
                    total_inserted += 1
                except Exception as row_err:
                    print(f"    ⚠️  Erro na linha: {row_err}")
            pg_conn.commit()
            continue
    
    pg_conn.commit()
    pg_cursor.close()
    
    return total_inserted


def reset_sequences(pg_conn, table_name):
    """Reseta sequences do PostgreSQL para o valor máximo da coluna id"""
    try:
        cursor = pg_conn.cursor()
        
        # Verificar se a tabela tem coluna id
        cursor.execute(f"""
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = '{table_name}' AND column_name = 'id'
        """)
        
        if cursor.fetchone():
            # Buscar valor máximo
            cursor.execute(f'SELECT COALESCE(MAX(id), 0) FROM "{table_name}"')
            max_id = cursor.fetchone()[0]
            
            # Resetar sequence
            seq_name = f"{table_name}_id_seq"
            cursor.execute(f"SELECT setval('{seq_name}', {max_id + 1}, false)")
            
        cursor.close()
        pg_conn.commit()
    except Exception:
        # Sequence pode não existir para algumas tabelas
        pass


def main():
    parser = argparse.ArgumentParser(description='Migra dados do SQLite para PostgreSQL')
    parser.add_argument('--sqlite-path', default=os.environ.get('SQLITE_PATH', './data/shadowindex.db'),
                        help='Caminho do arquivo SQLite')
    parser.add_argument('--postgres-url', default=os.environ.get('POSTGRES_URL'),
                        help='URL de conexão PostgreSQL')
    parser.add_argument('--drop-tables', action='store_true',
                        help='Apagar tabelas existentes antes de migrar')
    parser.add_argument('--tables', nargs='*',
                        help='Migrar apenas tabelas específicas')
    
    args = parser.parse_args()
    
    if not args.postgres_url:
        print("ERRO: POSTGRES_URL não definido. Use --postgres-url ou defina a variável de ambiente.")
        sys.exit(1)
    
    if not os.path.exists(args.sqlite_path):
        print(f"ERRO: Arquivo SQLite não encontrado: {args.sqlite_path}")
        sys.exit(1)
    
    print("=" * 60)
    print("MIGRAÇÃO SQLite -> PostgreSQL")
    print("=" * 60)
    print(f"SQLite: {args.sqlite_path}")
    print(f"PostgreSQL: {args.postgres_url.split('@')[1] if '@' in args.postgres_url else args.postgres_url}")
    print("=" * 60)
    
    # Conectar ao SQLite
    print("\n🔌 Conectando ao SQLite...")
    sqlite_conn = sqlite3.connect(args.sqlite_path)
    
    # Conectar ao PostgreSQL
    print("🔌 Conectando ao PostgreSQL...")
    pg_conn = psycopg2.connect(args.postgres_url)
    pg_conn.autocommit = False
    
    # Obter tabelas do SQLite
    sqlite_tables = get_sqlite_tables(sqlite_conn)
    print(f"\n📋 Tabelas encontradas no SQLite: {len(sqlite_tables)}")
    
    # Filtrar tabelas se especificado
    if args.tables:
        tables_to_migrate = [t for t in args.tables if t in sqlite_tables]
    else:
        # Usar ordem definida, depois adicionar as que não estão na lista
        tables_to_migrate = [t for t in TABLES_ORDER if t in sqlite_tables]
        for t in sqlite_tables:
            if t not in tables_to_migrate:
                tables_to_migrate.append(t)
    
    print(f"📋 Tabelas a migrar: {len(tables_to_migrate)}")
    
    # Criar tabelas no PostgreSQL
    print("\n🔧 Criando estrutura no PostgreSQL...")
    pg_cursor = pg_conn.cursor()
    
    for table_name in tables_to_migrate:
        columns = get_table_columns(sqlite_conn, table_name)
        if not columns:
            continue
        
        if args.drop_tables:
            pg_cursor.execute(f'DROP TABLE IF EXISTS "{table_name}" CASCADE')
        
        ddl = create_postgres_table_ddl(table_name, columns)
        try:
            pg_cursor.execute(ddl)
            print(f"  ✅ Tabela {table_name} criada")
        except Exception as e:
            if 'already exists' in str(e):
                print(f"  ⏭️  Tabela {table_name} já existe")
            else:
                print(f"  ❌ Erro criando {table_name}: {e}")
    
    pg_conn.commit()
    pg_cursor.close()
    
    # Migrar dados
    print("\n📦 Migrando dados...")
    total_rows = 0
    start_time = datetime.now()
    
    for table_name in tables_to_migrate:
        print(f"\n  📤 Migrando {table_name}...")
        try:
            count = migrate_table(sqlite_conn, pg_conn, table_name)
            if count > 0:
                print(f"  ✅ {count} registros migrados")
                total_rows += count
                
                # Resetar sequence
                reset_sequences(pg_conn, table_name)
        except Exception as e:
            print(f"  ❌ Erro: {e}")
    
    elapsed = datetime.now() - start_time
    
    # Fechar conexões
    sqlite_conn.close()
    pg_conn.close()
    
    print("\n" + "=" * 60)
    print("✅ MIGRAÇÃO CONCLUÍDA")
    print("=" * 60)
    print(f"Total de registros migrados: {total_rows}")
    print(f"Tempo total: {elapsed}")
    print("=" * 60)
    
    print("\n⚠️  PRÓXIMOS PASSOS:")
    print("1. Configure POSTGRES_URL no backend/.env")
    print("2. Reinicie o backend")
    print("3. Verifique se a aplicação está funcionando")
    print("4. Execute: alembic upgrade head (se necessário)")


if __name__ == '__main__':
    main()
