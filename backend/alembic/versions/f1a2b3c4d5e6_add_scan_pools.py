"""add_scan_pools

Revision ID: f1a2b3c4d5e6
Revises: e2f3a4b5c6d7
Create Date: 2026-02-25 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f1a2b3c4d5e6'
down_revision: Union[str, Sequence[str], None] = 'e2f3a4b5c6d7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'scan_pools',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('simultaneous_scanners', sa.Integer(), server_default='3'),
        sa.Column('request_delay_min', sa.Integer(), server_default='100'),
        sa.Column('request_delay_max', sa.Integer(), server_default='500'),
        sa.Column('include_servers', sa.String(), server_default=''),
        sa.Column('exclude_servers', sa.String(), server_default=''),
        sa.Column('include_ips', sa.String(), server_default=''),
        sa.Column('exclude_ips', sa.String(), server_default=''),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('scan_pools')
