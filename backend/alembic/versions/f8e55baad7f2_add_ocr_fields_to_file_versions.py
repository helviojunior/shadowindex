"""Add OCR fields to file_versions

Revision ID: f8e55baad7f2
Revises: 203ed2f69329
Create Date: 2026-02-21 21:53:20.157523

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f8e55baad7f2'
down_revision: Union[str, Sequence[str], None] = '203ed2f69329'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Add OCR fields to file_versions table
    with op.batch_alter_table('file_versions', schema=None) as batch_op:
        batch_op.add_column(sa.Column('ocr_content', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('ocr_metadata', sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column('ocr_processed', sa.Boolean(), nullable=True))
        batch_op.add_column(sa.Column('ocr_processed_at', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('ocr_error', sa.String(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('file_versions', schema=None) as batch_op:
        batch_op.drop_column('ocr_error')
        batch_op.drop_column('ocr_processed_at')
        batch_op.drop_column('ocr_processed')
        batch_op.drop_column('ocr_metadata')
        batch_op.drop_column('ocr_content')
