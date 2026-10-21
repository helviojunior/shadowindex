"""add_kerberos_credential_fields

Adiciona suporte ao tipo de credencial Kerberos (ticket ccache) na tabela
credentials. Também atua como ponto de merge das duas heads divergentes do
histórico de migrations (i4d5e6f7g8h9 e c3d4e5f6a7b8), de forma que
`alembic upgrade head` volte a apontar para uma única revisão.

Revision ID: j5e6f7g8h9i0
Revises: i4d5e6f7g8h9, c3d4e5f6a7b8
Create Date: 2026-10-21

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'j5e6f7g8h9i0'
down_revision: Union[str, Sequence[str], None] = ('i4d5e6f7g8h9', 'c3d4e5f6a7b8')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(bind, table: str, column: str) -> bool:
    inspector = sa.inspect(bind)
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    with op.batch_alter_table('credentials', schema=None) as batch_op:
        if not _has_column(bind, 'credentials', 'kerberos_ccache'):
            batch_op.add_column(sa.Column('kerberos_ccache', sa.Text(), nullable=True))
        if not _has_column(bind, 'credentials', 'kdc_host'):
            batch_op.add_column(sa.Column('kdc_host', sa.String(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('credentials', schema=None) as batch_op:
        batch_op.drop_column('kdc_host')
        batch_op.drop_column('kerberos_ccache')
