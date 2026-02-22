"""
Credential Verification Service

This module provides functions to mark credentials as verified
after successful authentication/communication.
"""

import logging
from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


async def mark_credential_verified(db: AsyncSession, credential_id: int, context: str = None):
    """
    Mark a credential as verified after successful use.
    
    Args:
        db: Database session
        credential_id: ID of the credential to mark as verified
        context: Optional context describing where the credential was used (e.g., "SMB", "Proxy")
    """
    from database import Credential
    
    try:
        result = await db.execute(
            select(Credential).where(Credential.id == credential_id)
        )
        credential = result.scalar_one_or_none()
        
        if credential:
            credential.verified = True
            credential.last_verified_at = datetime.now(timezone.utc)
            credential.verification_error = None
            await db.commit()
            
            logger.info(f"Credential {credential_id} marked as verified (context: {context})")
            return True
        else:
            logger.warning(f"Credential {credential_id} not found for verification")
            return False
            
    except Exception as e:
        logger.error(f"Error marking credential {credential_id} as verified: {e}")
        await db.rollback()
        return False


async def mark_credential_failed(db: AsyncSession, credential_id: int, error_message: str, context: str = None):
    """
    Mark a credential verification as failed.
    
    Args:
        db: Database session
        credential_id: ID of the credential
        error_message: Error message from the failed attempt
        context: Optional context describing where the credential was used
    """
    from database import Credential
    
    try:
        result = await db.execute(
            select(Credential).where(Credential.id == credential_id)
        )
        credential = result.scalar_one_or_none()
        
        if credential:
            credential.verified = False
            credential.verification_error = error_message[:500] if error_message else None
            await db.commit()
            
            logger.info(f"Credential {credential_id} marked as failed (context: {context}): {error_message[:100]}")
            return True
        else:
            logger.warning(f"Credential {credential_id} not found for failure marking")
            return False
            
    except Exception as e:
        logger.error(f"Error marking credential {credential_id} as failed: {e}")
        await db.rollback()
        return False
