import uuid
from datetime import datetime, timedelta, timezone
from fastapi import Depends, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.config import get_settings
from app.utils.logging import get_logger
from db.session import get_db

settings = get_settings()
log = get_logger(__name__)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer()

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)

def create_access_token(user_id: uuid.UUID, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {
        "sub": str(user_id), "role": role,
        "exp": expire, "iat": datetime.now(timezone.utc),
        "jti": str(uuid.uuid4()),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)

def create_refresh_token() -> tuple[str, datetime]:
    token = str(uuid.uuid4())
    expires = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days)
    return token, expires

def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Invalid or expired token",
                            headers={"WWW-Authenticate": "Bearer"}) from exc

class CurrentUser:
    def __init__(self, user_id: uuid.UUID, role: str, email: str):
        self.user_id = user_id
        self.role = role
        self.email = email

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> CurrentUser:
    payload = decode_token(credentials.credentials)
    user_id_str = payload.get("sub")
    role_str = payload.get("role")
    if not user_id_str or not role_str:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    try:
        user_id = uuid.UUID(user_id_str)
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    row = await db.execute(
        text("SELECT id, role, email, is_active FROM core.users WHERE id = :uid"),
        {"uid": user_id},
    )
    user = row.fetchone()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return CurrentUser(user_id=user_id, role=user.role, email=user.email)

def require_roles(*roles: str):
    async def _guard(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if current_user.role not in roles:
            raise HTTPException(status_code=403,
                                detail=f"Access denied. Required: {list(roles)}")
        return current_user
    return _guard

require_customer = require_roles("customer")
require_merchant = require_roles("merchant")
require_admin    = require_roles("admin")
require_any_auth = require_roles("customer", "merchant", "admin")
require_ops      = require_roles("merchant", "admin")
