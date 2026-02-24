"""alter_server_items_modified_to_timestamptz

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-02-24 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if op.get_context().dialect.name != 'postgresql':
        return

    # Normaliza os valores: mantém apenas os 19 primeiros caracteres (YYYY-MM-DD HH24:MI:SS)
    # eliminando sufixos como 'Z', offset de timezone ou espaços extras
    op.execute(
        """
        UPDATE server_items
        SET modified = LEFT(modified, 19)
        WHERE modified IS NOT NULL
          AND trim(modified) <> '';
        """
    )

    op.execute(
        """
        ALTER TABLE server_items
        ALTER COLUMN modified TYPE TIMESTAMP WITH TIME ZONE
        USING CASE
            WHEN modified IS NULL OR trim(modified) = '' THEN NULL
            ELSE modified::TIMESTAMP WITH TIME ZONE
        END;
        """
    )


def downgrade() -> None:
    if op.get_context().dialect.name != 'postgresql':
        return

    op.execute(
        """
        ALTER TABLE server_items
        ALTER COLUMN modified TYPE VARCHAR
        USING CASE
            WHEN modified IS NULL THEN NULL
            ELSE to_char(modified AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
        END;
        """
    )
