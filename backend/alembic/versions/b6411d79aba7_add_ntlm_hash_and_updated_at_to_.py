"""add_ntlm_hash_and_updated_at_to_credentials

Revision ID: b6411d79aba7
Revises: f8e55baad7f2
Create Date: 2026-02-21 22:28:50.735033

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b6411d79aba7'
down_revision: Union[str, Sequence[str], None] = 'f8e55baad7f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Add NTLM hash and updated_at to credentials
    with op.batch_alter_table('credentials', schema=None) as batch_op:
        batch_op.add_column(sa.Column('ntlm_hash', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('updated_at', sa.DateTime(), nullable=True))
        batch_op.alter_column('password',
               existing_type=sa.VARCHAR(),
               nullable=True)

    # ### end Alembic commands ###


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('credentials', schema=None) as batch_op:
        batch_op.alter_column('password',
               existing_type=sa.VARCHAR(),
               nullable=False)
        batch_op.drop_column('updated_at')
        batch_op.drop_column('ntlm_hash')
