#!/usr/bin/env python3
"""
Script manual para rodar Auto-Index em todos os FileVersions já baixados.

Percorre todos os FileVersion que:
  - Possuem local_path existente no disco
  - NÃO possuem ocr_content preenchido (não sobrescreve OCR existente)
  - Atendem aos critérios de extensão/mimetype/tamanho do Auto-Index

Uso:
  cd backend
  python run_auto_index.py              # roda com as settings do banco
  python run_auto_index.py --dry-run    # apenas lista o que seria indexado, sem gravar
  python run_auto_index.py --force      # indexa mesmo arquivos que já têm ocr_content
"""

import asyncio
import argparse
import os
import sys
import fnmatch
import mimetypes
import re
from datetime import datetime, timezone

# Adicionar o diretório backend ao path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import select, func
from database import AsyncSessionLocal, FileVersion, AppSettings
from storage_utils import STORAGE_BASE_PATH


async def load_auto_index_settings(db):
    """Carrega as settings de auto-index do banco."""
    result = await db.execute(
        select(AppSettings).where(
            AppSettings.key.in_([
                'auto_index_enabled',
                'auto_index_max_size_mb',
                'auto_index_extensions',
                'auto_index_mimetypes'
            ])
        )
    )
    settings_map = {s.key: s.value for s in result.scalars().all()}
    return {
        'enabled': settings_map.get('auto_index_enabled', 'true') == 'true',
        'max_size_mb': float(settings_map.get('auto_index_max_size_mb', '10')),
        'extensions': [e.strip().lower() for e in settings_map.get('auto_index_extensions', '').split(',') if e.strip()],
        'mimetypes': [m.strip().lower() for m in settings_map.get('auto_index_mimetypes', '').split(',') if m.strip()],
    }


def matches_extension(file_name, allowed_extensions):
    """Verifica se o arquivo bate com alguma extensão (suporta wildcards)."""
    file_name_lower = file_name.lower()
    file_ext = os.path.splitext(file_name_lower)[1].lower()

    for pattern in allowed_extensions:
        if '*' in pattern or '?' in pattern:
            if fnmatch.fnmatch(file_name_lower, '*' + pattern if not pattern.startswith('*') else pattern):
                return True
        else:
            if file_ext == pattern:
                return True
    return False


def matches_mimetype(file_path, file_name, allowed_mimetypes):
    """Verifica se o mimetype do arquivo bate com algum padrão."""
    guessed, _ = mimetypes.guess_type(file_path or file_name or '')
    if not guessed:
        return False
    guessed_lower = guessed.lower()
    for allowed in allowed_mimetypes:
        if guessed_lower.startswith(allowed):
            return True
    return False


def read_file_content(file_path):
    try:
        with open(file_path, 'rb') as f:
            content = f.read().decode('utf-8', 'ignore')

        # remove \r
        content = content.replace('\r', '')

        # remove não-printáveis (exceto \n e \t)
        content = re.sub(r'[^\x20-\x7E\n\t]', '', content)

        # colapsa múltiplos \n em apenas um
        content = re.sub(r'\n+', '\n', content)

        return content

    except Exception:
        return None


async def run_auto_index(dry_run=False, force=False):
    """Executa o auto-index em todos os FileVersions elegíveis."""

    async with AsyncSessionLocal() as db:
        # 1. Carregar settings
        settings = await load_auto_index_settings(db)

        if not settings['enabled']:
            print("[AVISO] Auto-Index está DESABILITADO nas configurações.")
            print("        Continuando mesmo assim para este script manual...\n")

        print("=" * 70)
        print("  AUTO-INDEX - Indexação em massa de arquivos baixados")
        print("=" * 70)
        print(f"  Modo:           {'DRY-RUN (sem gravar)' if dry_run else 'EXECUÇÃO REAL'}")
        print(f"  Force:          {'SIM (sobrescreve ocr_content existente)' if force else 'NÃO (pula arquivos já indexados)'}")
        print(f"  Max size:       {settings['max_size_mb']} MB")
        print(f"  Extensões:      {len(settings['extensions'])} padrões")
        print(f"  MIME types:     {', '.join(settings['mimetypes']) or '(nenhum)'}")
        print("=" * 70)

        # 2. Contar total de FileVersions
        count_result = await db.execute(select(func.count(FileVersion.id)))
        total_versions = count_result.scalar()
        print(f"\n  Total de FileVersions no banco: {total_versions}")

        # 3. Buscar FileVersions candidatos
        query = select(FileVersion)
        if not force:
            # Pular os que já têm conteúdo OCR
            query = query.where(
                (FileVersion.ocr_content == None) | (FileVersion.ocr_content == '')  # noqa: E711
            )

        result = await db.execute(query)
        versions = result.scalars().all()
        print(f"  FileVersions candidatos (sem ocr_content): {len(versions)}")

        # 4. Processar cada FileVersion
        max_size_bytes = settings['max_size_mb'] * 1024 * 1024
        stats = {
            'total_checked': 0,
            'skipped_no_file': 0,
            'skipped_too_large': 0,
            'skipped_no_match': 0,
            'skipped_empty': 0,
            'skipped_read_error': 0,
            'indexed': 0,
            'total_chars': 0,
        }

        print(f"\n  Processando {len(versions)} FileVersions...\n")

        batch_size = 100
        batch_count = 0

        for version in versions:
            stats['total_checked'] += 1

            # 4a. Verificar se arquivo existe
            if not version.local_path:
                stats['skipped_no_file'] += 1
                continue

            # Resolver caminho absoluto: local_path pode ser relativo ao STORAGE_BASE_PATH
            resolved_path = version.local_path
            if not os.path.isabs(resolved_path):
                resolved_path = os.path.join(STORAGE_BASE_PATH, resolved_path)

            if not os.path.exists(resolved_path):
                stats['skipped_no_file'] += 1
                continue

            # 4b. Verificar tamanho
            try:
                file_size = os.path.getsize(resolved_path)
            except OSError:
                stats['skipped_no_file'] += 1
                continue

            if file_size > max_size_bytes:
                stats['skipped_too_large'] += 1
                continue

            # 4c. Extrair nome do arquivo
            file_name = os.path.basename(version.file_path or version.local_path or '')

            # 4d. Verificar extensão OU mimetype
            ext_ok = matches_extension(file_name, settings['extensions'])
            mime_ok = matches_mimetype(resolved_path, file_name, settings['mimetypes'])

            if not ext_ok and not mime_ok:
                stats['skipped_no_match'] += 1
                continue

            # 4e. Ler conteúdo
            content = read_file_content(resolved_path)
            if content is None:
                stats['skipped_read_error'] += 1
                continue
            if not content.strip():
                stats['skipped_empty'] += 1
                continue

            # 4f. Indexar
            match_type = 'ext' if ext_ok else 'mime'
            size_kb = file_size / 1024

            if dry_run:
                print(f"  [DRY-RUN] {file_name} ({size_kb:.1f} KB, {len(content)} chars, match: {match_type})")
            else:
                version.ocr_content = content
                version.ocr_processed = True
                version.ocr_processed_at = datetime.now(timezone.utc)
                batch_count += 1

                if batch_count % 10 == 0:
                    print(f"  [OK] {file_name} ({size_kb:.1f} KB, {len(content)} chars, match: {match_type})")

                # Commit em batches para não sobrecarregar
                if batch_count >= batch_size:
                    await db.commit()
                    batch_count = 0

            stats['indexed'] += 1
            stats['total_chars'] += len(content)

            # Progress a cada 500
            if stats['total_checked'] % 500 == 0:
                print(f"  ... {stats['total_checked']}/{len(versions)} verificados, {stats['indexed']} indexados")

        # Commit final
        if not dry_run and batch_count > 0:
            await db.commit()

        # 5. Relatório
        print("\n" + "=" * 70)
        print("  RELATÓRIO FINAL")
        print("=" * 70)
        print(f"  Total verificados:         {stats['total_checked']}")
        print(f"  Indexados:                  {stats['indexed']}")
        print(f"  Total de chars indexados:   {stats['total_chars']:,}")
        print(f"  ---")
        print(f"  Arquivo não encontrado:     {stats['skipped_no_file']}")
        print(f"  Arquivo muito grande:       {stats['skipped_too_large']}")
        print(f"  Extensão/MIME não bate:     {stats['skipped_no_match']}")
        print(f"  Conteúdo vazio:             {stats['skipped_empty']}")
        print(f"  Erro de leitura:            {stats['skipped_read_error']}")
        print("=" * 70)

        if dry_run:
            print("\n  [DRY-RUN] Nenhuma alteração foi gravada no banco.")
        else:
            print(f"\n  {stats['indexed']} FileVersions indexados com sucesso!")


def main():
    parser = argparse.ArgumentParser(
        description='Roda Auto-Index manualmente em todos os FileVersions já baixados.'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Apenas lista o que seria indexado, sem gravar no banco'
    )
    parser.add_argument(
        '--force',
        action='store_true',
        help='Indexa mesmo arquivos que já possuem ocr_content (sobrescreve)'
    )
    args = parser.parse_args()

    asyncio.run(run_auto_index(dry_run=args.dry_run, force=args.force))


if __name__ == '__main__':
    main()
