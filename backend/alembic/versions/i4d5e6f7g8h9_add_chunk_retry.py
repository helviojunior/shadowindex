"""Add retry_count to download_segments

Revision ID: i4d5e6f7g8h9
Revises: h3c4d5e6f7g8
Create Date: 2026-02-28

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'i4d5e6f7g8h9'
down_revision: Union[str, Sequence[str]] = 'h3c4d5e6f7g8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('download_segments', schema=None) as batch_op:
        batch_op.add_column(sa.Column('retry_count', sa.Integer(), nullable=True, server_default='0'))


def downgrade() -> None:
    with op.batch_alter_table('download_segments', schema=None) as batch_op:
        batch_op.drop_column('retry_count')
