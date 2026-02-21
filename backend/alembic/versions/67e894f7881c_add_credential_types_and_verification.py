"""add_credential_types_and_verification

Revision ID: 67e894f7881c
Revises: b6411d79aba7
Create Date: 2026-02-21 22:42:02.561685

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '67e894f7881c'
down_revision: Union[str, Sequence[str], None] = 'b6411d79aba7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('credentials', schema=None) as batch_op:
        batch_op.add_column(sa.Column('name', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('credential_type', sa.String(), nullable=True, server_default='user_password'))
        batch_op.add_column(sa.Column('token', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('token_type', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('ssh_private_key', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('ssh_passphrase', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('ssh_public_key', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('verified', sa.Boolean(), nullable=True, server_default='0'))
        batch_op.add_column(sa.Column('last_verified_at', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('verification_error', sa.String(), nullable=True))

    # ### end Alembic commands ###


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('credentials', schema=None) as batch_op:
        batch_op.drop_column('verification_error')
        batch_op.drop_column('last_verified_at')
        batch_op.drop_column('verified')
        batch_op.drop_column('ssh_public_key')
        batch_op.drop_column('ssh_passphrase')
        batch_op.drop_column('ssh_private_key')
        batch_op.drop_column('token_type')
        batch_op.drop_column('token')
        batch_op.drop_column('credential_type')
        batch_op.drop_column('name')

    # ### end Alembic commands ###
