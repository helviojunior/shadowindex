"""add_share_scan_jobs

Revision ID: g2b3c4d5e6f7
Revises: f1a2b3c4d5e6
Create Date: 2026-02-25 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'g2b3c4d5e6f7'
down_revision: Union[str, Sequence[str], None] = 'f1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'share_scan_jobs',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('server_id', sa.Integer(), sa.ForeignKey('servers.id'), nullable=False),
        sa.Column('scan_pool_id', sa.Integer(), sa.ForeignKey('scan_pools.id'), nullable=False),
        sa.Column('status', sa.String(), server_default='pending'),
        sa.Column('shares_found', sa.Integer(), server_default='0'),
        sa.Column('error_message', sa.String(), nullable=True),
        sa.Column('priority', sa.Integer(), server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('idx_share_scan_jobs_status', 'share_scan_jobs', ['status'])
    op.create_index('idx_share_scan_jobs_server_id', 'share_scan_jobs', ['server_id'])
    op.create_index('idx_share_scan_jobs_scan_pool_id', 'share_scan_jobs', ['scan_pool_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('idx_share_scan_jobs_scan_pool_id', 'share_scan_jobs')
    op.drop_index('idx_share_scan_jobs_server_id', 'share_scan_jobs')
    op.drop_index('idx_share_scan_jobs_status', 'share_scan_jobs')
    op.drop_table('share_scan_jobs')
