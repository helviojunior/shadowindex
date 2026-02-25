"""add_proxy_id_to_plugin_instances

Revision ID: h3c4d5e6f7g8
Revises: g2b3c4d5e6f7
Create Date: 2026-02-25 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'h3c4d5e6f7g8'
down_revision: Union[str, Sequence[str], None] = 'g2b3c4d5e6f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add proxy_id column to plugin_instances
    op.add_column('plugin_instances', sa.Column('proxy_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_plugin_instances_proxy_id',
        'plugin_instances', 'proxy_servers',
        ['proxy_id'], ['id'],
        ondelete='SET NULL'
    )

    # Data migration: copy active_proxy_id value to all existing plugin instances
    conn = op.get_bind()
    result = conn.execute(
        sa.text("SELECT value FROM app_config WHERE key = 'active_proxy_id'")
    )
    row = result.fetchone()
    if row and row[0] and row[0] not in ('', 'null'):
        try:
            proxy_id = int(row[0])
            # Verify proxy exists
            proxy_exists = conn.execute(
                sa.text("SELECT id FROM proxy_servers WHERE id = :pid"),
                {"pid": proxy_id}
            ).fetchone()
            if proxy_exists:
                conn.execute(
                    sa.text("UPDATE plugin_instances SET proxy_id = :pid"),
                    {"pid": proxy_id}
                )
        except (ValueError, TypeError):
            pass


def downgrade() -> None:
    op.drop_constraint('fk_plugin_instances_proxy_id', 'plugin_instances', type_='foreignkey')
    op.drop_column('plugin_instances', 'proxy_id')
