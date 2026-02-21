"""Add plugin fields to database_connections

Revision ID: 203ed2f69329
Revises: dddf27ea63f7
Create Date: 2026-02-21 21:34:09.871723

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '203ed2f69329'
down_revision: Union[str, Sequence[str], None] = 'dddf27ea63f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Add plugin columns to database_connections table
    with op.batch_alter_table('database_connections', schema=None) as batch_op:
        batch_op.add_column(sa.Column('plugin_type', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('plugin_config', sa.JSON(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('database_connections', schema=None) as batch_op:
        batch_op.drop_column('plugin_config')
        batch_op.drop_column('plugin_type')
