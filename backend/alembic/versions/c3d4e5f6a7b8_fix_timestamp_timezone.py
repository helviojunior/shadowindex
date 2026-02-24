"""fix_timestamp_timezone

Revision ID: c3d4e5f6a7b8
Revises: 496484aaac92
Create Date: 2026-02-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, None] = '496484aaac92'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# List of (table_name, column_name) pairs for all DateTime columns
TIMESTAMP_COLUMNS = [
    ("credentials", "last_verified_at"),
    ("credentials", "created_at"),
    ("credentials", "updated_at"),
    ("database_types", "created_at"),
    ("database_connections", "last_verified_at"),
    ("database_connections", "created_at"),
    ("sql_presets", "created_at"),
    ("sql_presets", "updated_at"),
    ("sql_query_history", "executed_at"),
    ("proxy_servers", "created_at"),
    ("soap_api_urls", "created_at"),
    ("soap_cache", "timestamp"),
    ("app_config", "updated_at"),
    ("plugin_instances", "created_at"),
    ("plugin_instances", "updated_at"),
    ("servers", "last_verified_at"),
    ("servers", "created_at"),
    ("server_shares", "discovered_at"),
    ("downloaded_files", "downloaded_at"),
    ("file_versions", "created_at"),
    ("file_versions", "ocr_processed_at"),
    ("server_items", "modified_at"),
    ("server_items", "created_at"),
    ("server_items", "updated_at"),
    ("server_items", "discovered_at"),
    ("pfx_passwords", "created_at"),
    ("download_jobs", "created_at"),
    ("download_jobs", "started_at"),
    ("download_jobs", "completed_at"),
    ("scan_jobs", "created_at"),
    ("scan_jobs", "started_at"),
    ("scan_jobs", "completed_at"),
    ("gitleaks_findings", "scanned_at"),
    ("gitleaks_findings", "created_at"),
    ("gitleaks_findings", "updated_at"),
    ("ocr_jobs", "created_at"),
    ("ocr_jobs", "started_at"),
    ("ocr_jobs", "completed_at"),
    ("ocr_jobs", "updated_at"),
    ("app_settings", "updated_at"),
]


def upgrade() -> None:
    if op.get_context().dialect.name != 'postgresql':
        return

    for table, col in TIMESTAMP_COLUMNS:
        op.execute(
            f"ALTER TABLE {table} "
            f"ALTER COLUMN {col} TYPE TIMESTAMP WITH TIME ZONE "
            f"USING {col} AT TIME ZONE 'UTC';"
        )


def downgrade() -> None:
    if op.get_context().dialect.name != 'postgresql':
        return

    for table, col in TIMESTAMP_COLUMNS:
        op.execute(
            f"ALTER TABLE {table} "
            f"ALTER COLUMN {col} TYPE TIMESTAMP WITHOUT TIME ZONE "
            f"USING {col} AT TIME ZONE 'UTC';"
        )
