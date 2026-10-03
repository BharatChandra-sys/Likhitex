"""
Storage backend interface for file storage.
Abstracts R2/S3 implementation.
"""
import hashlib
import logging
from abc import ABC, abstractmethod
from typing import Optional

import httpx
from app.config import settings

logger = logging.getLogger(__name__)


class StorageBackend(ABC):
    """Abstract storage interface."""
    
    @abstractmethod
    async def put(
        self,
        key: str,
        data: bytes,
        content_type: str = "application/octet-stream"
    ) -> str:
        """
        Store file and return storage key.
        
        Args:
            key: Storage key (path)
            data: File content
            content_type: MIME type
        
        Returns:
            Storage key
        """
        pass
    
    @abstractmethod
    async def get(self, key: str) -> bytes:
        """Retrieve file content."""
        pass
    
    @abstractmethod
    async def delete(self, key: str) -> None:
        """Delete file."""
        pass
    
    @abstractmethod
    async def get_presigned_url(
        self,
        key: str,
        expires: int = 3600
    ) -> str:
        """
        Get presigned URL for direct download.
        
        Args:
            key: Storage key
            expires: URL expiration in seconds
        
        Returns:
            Presigned URL
        """
        pass
    
    @staticmethod
    def compute_hash(data: bytes) -> str:
        """Compute SHA256 hash of data."""
        return hashlib.sha256(data).hexdigest()


class R2Storage(StorageBackend):
    """
    Cloudflare R2 storage backend.
    S3-compatible API.
    """
    
    def __init__(
        self,
        account_id: str,
        access_key_id: str,
        secret_access_key: str,
        bucket_name: str
    ):
        self.account_id = account_id
        self.access_key_id = access_key_id
        self.secret_access_key = secret_access_key
        self.bucket_name = bucket_name
        self.endpoint = f"https://{account_id}.r2.cloudflarestorage.com"
    
    async def put(
        self,
        key: str,
        data: bytes,
        content_type: str = "application/octet-stream"
    ) -> str:
        """Upload to R2."""
        # Use boto3-compatible client
        try:
            import aioboto3
            
            session = aioboto3.Session()
            async with session.client(
                's3',
                endpoint_url=self.endpoint,
                aws_access_key_id=self.access_key_id,
                aws_secret_access_key=self.secret_access_key
            ) as s3:
                await s3.put_object(
                    Bucket=self.bucket_name,
                    Key=key,
                    Body=data,
                    ContentType=content_type
                )
            
            logger.info(f"Uploaded {key} to R2 ({len(data)} bytes)")
            return key
        
        except ImportError:
            # Fallback: use httpx with S3 API (requires signing)
            logger.warning("aioboto3 not installed, using basic HTTP")
            # TODO: Implement S3 signature v4
            raise NotImplementedError("Install aioboto3 for R2 support")
    
    async def get(self, key: str) -> bytes:
        """Download from R2."""
        try:
            import aioboto3
            
            session = aioboto3.Session()
            async with session.client(
                's3',
                endpoint_url=self.endpoint,
                aws_access_key_id=self.access_key_id,
                aws_secret_access_key=self.secret_access_key
            ) as s3:
                response = await s3.get_object(
                    Bucket=self.bucket_name,
                    Key=key
                )
                data = await response['Body'].read()
                return data
        
        except ImportError:
            raise NotImplementedError("Install aioboto3 for R2 support")
    
    async def delete(self, key: str) -> None:
        """Delete from R2."""
        try:
            import aioboto3
            
            session = aioboto3.Session()
            async with session.client(
                's3',
                endpoint_url=self.endpoint,
                aws_access_key_id=self.access_key_id,
                aws_secret_access_key=self.secret_access_key
            ) as s3:
                await s3.delete_object(
                    Bucket=self.bucket_name,
                    Key=key
                )
            
            logger.info(f"Deleted {key} from R2")
        
        except ImportError:
            raise NotImplementedError("Install aioboto3 for R2 support")
    
    async def get_presigned_url(
        self,
        key: str,
        expires: int = 3600
    ) -> str:
        """Generate presigned URL."""
        try:
            import aioboto3
            
            session = aioboto3.Session()
            async with session.client(
                's3',
                endpoint_url=self.endpoint,
                aws_access_key_id=self.access_key_id,
                aws_secret_access_key=self.secret_access_key
            ) as s3:
                url = await s3.generate_presigned_url(
                    'get_object',
                    Params={
                        'Bucket': self.bucket_name,
                        'Key': key
                    },
                    ExpiresIn=expires
                )
                return url
        
        except ImportError:
            # Return public URL (works if bucket is public)
            return f"{self.endpoint}/{self.bucket_name}/{key}"


class LocalStorage(StorageBackend):
    """
    Local filesystem storage (development only).
    NOT for production use.
    """
    
    def __init__(self, base_path: str = "/tmp/likhitex_storage"):
        import os
        self.base_path = base_path
        os.makedirs(base_path, exist_ok=True)
    
    async def put(
        self,
        key: str,
        data: bytes,
        content_type: str = "application/octet-stream"
    ) -> str:
        """Save to local filesystem."""
        import os
        
        file_path = os.path.join(self.base_path, key)
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        
        with open(file_path, 'wb') as f:
            f.write(data)
        
        logger.info(f"Saved {key} to local storage ({len(data)} bytes)")
        return key
    
    async def get(self, key: str) -> bytes:
        """Read from local filesystem."""
        import os
        
        file_path = os.path.join(self.base_path, key)
        with open(file_path, 'rb') as f:
            return f.read()
    
    async def delete(self, key: str) -> None:
        """Delete from local filesystem."""
        import os
        
        file_path = os.path.join(self.base_path, key)
        if os.path.exists(file_path):
            os.remove(file_path)
            logger.info(f"Deleted {key} from local storage")
    
    async def get_presigned_url(
        self,
        key: str,
        expires: int = 3600
    ) -> str:
        """Return local file path (not a real URL)."""
        import os
        return f"file://{os.path.join(self.base_path, key)}"


def get_storage() -> StorageBackend:
    """
    Factory function to get storage backend.
    
    Returns:
        StorageBackend instance based on configuration
    """
    if settings.R2_ACCOUNT_ID and settings.R2_ACCESS_KEY_ID:
        return R2Storage(
            account_id=settings.R2_ACCOUNT_ID,
            access_key_id=settings.R2_ACCESS_KEY_ID,
            secret_access_key=settings.R2_SECRET_ACCESS_KEY,
            bucket_name=settings.R2_BUCKET_NAME
        )
    else:
        logger.warning("R2 not configured, using local storage (DEV ONLY)")
        return LocalStorage()
