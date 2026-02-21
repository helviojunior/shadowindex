"""Add SOCKS proxy support

Revision ID: dddf27ea63f7
Revises: bcd105662f15
Create Date: 2026-02-21 21:26:35.971539

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'dddf27ea63f7'
down_revision: Union[str, Sequence[str], None] = 'bcd105662f15'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Add SOCKS proxy support columns
    with op.batch_alter_table('proxy_servers', schema=None) as batch_op:
        batch_op.add_column(sa.Column('proxy_type', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('username', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('password', sa.String(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('proxy_servers', schema=None) as batch_op:
        batch_op.drop_column('password')
        batch_op.drop_column('username')
        batch_op.drop_column('proxy_type')
