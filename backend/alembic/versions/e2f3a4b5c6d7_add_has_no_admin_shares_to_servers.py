"""add_has_no_admin_shares_to_servers

Revision ID: e2f3a4b5c6d7
Revises: d1e2f3a4b5c6
Create Date: 2026-02-25 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e2f3a4b5c6d7'
down_revision: Union[str, Sequence[str], None] = 'd1e2f3a4b5c6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('servers', schema=None) as batch_op:
        batch_op.add_column(sa.Column('has_no_admin_shares', sa.Boolean(), nullable=True, server_default='0'))

    # Preencher a flag para servidores existentes baseado nas shares atuais
    conn = op.get_bind()
    conn.execute(sa.text("""
        UPDATE servers SET has_no_admin_shares = 1
        WHERE guid IN (
            SELECT DISTINCT server_guid FROM server_shares
            WHERE share_name NOT LIKE '%$'
        )
    """))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('servers', schema=None) as batch_op:
        batch_op.drop_column('has_no_admin_shares')
