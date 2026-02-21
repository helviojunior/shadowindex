"""fix_nullable_domain_username_in_credentials

Revision ID: a1b2c3d4e5f6
Revises: 67e894f7881c
Create Date: 2026-02-21 22:55:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = '67e894f7881c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Make domain and username nullable for credential types other than user_password."""
    # SQLite requires batch mode for ALTER COLUMN
    with op.batch_alter_table('credentials', schema=None) as batch_op:
        batch_op.alter_column('domain',
                              existing_type=sa.String(),
                              nullable=True)
        batch_op.alter_column('username',
                              existing_type=sa.String(),
                              nullable=True)


def downgrade() -> None:
    """Revert domain and username to NOT NULL."""
    with op.batch_alter_table('credentials', schema=None) as batch_op:
        batch_op.alter_column('domain',
                              existing_type=sa.String(),
                              nullable=False)
        batch_op.alter_column('username',
                              existing_type=sa.String(),
                              nullable=False)
