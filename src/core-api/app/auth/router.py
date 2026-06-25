import pyotp
import uuid
import secrets
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.auth.security import (
    CurrentUser, create_access_token, create_refresh_token,
    get_current_user, hash_password, require_any_auth, verify_password,
)
from app.config import get_settings
from app.utils.logging import get_logger
from db.session import get_db

router = APIRouter(prefix="/auth", tags=["Authentication"])
settings = get_settings()
log = get_logger(__name__)

@router.post("/signup", status_code=201)
async def signup(payload: dict, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(
        text("SELECT id FROM core.users WHERE email = :email"),
        {"email": payload["email"]},
    )
    if existing.fetchone():
        raise HTTPException(status_code=409, detail="Email already registered")

    password = payload.get("password", "")
    if len(password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")
    if not any(c.isupper() for c in password):
        raise HTTPException(status_code=422, detail="Password must contain an uppercase letter")
    if not any(c.isdigit() for c in password):
        raise HTTPException(status_code=422, detail="Password must contain a digit")

    hashed = hash_password(password)
    user_id = uuid.uuid4()

    await db.execute(
        text("""
            INSERT INTO core.users
                (id, email, full_name, hashed_password, phone, country_code, preferred_currency)
            VALUES (:id, :email, :full_name, :pw, :phone, :country, :currency)
        """),
        {
            "id": user_id, "email": payload["email"],
            "full_name": payload["full_name"], "pw": hashed,
            "phone": payload.get("phone"), "country": payload.get("country_code", "IN"),
            "currency": payload.get("preferred_currency", "INR"),
        },
    )

    await db.execute(
        text("""
            INSERT INTO core.wallets (user_id, currency, balance)
            VALUES (:uid, :currency, 0.0) ON CONFLICT DO NOTHING
        """),
        {"uid": user_id, "currency": payload.get("preferred_currency", "INR")},
    )

    upi_handle = f"{payload['email'].split('@')[0]}@paygw"
    await db.execute(
        text("""
            INSERT INTO core.upi_handles (user_id, handle, is_primary)
            VALUES (:uid, :handle, TRUE) ON CONFLICT DO NOTHING
        """),
        {"uid": user_id, "handle": upi_handle},
    )

    await db.commit()
    log.info("user_registered", user_id=str(user_id), email=payload["email"])

    row = await db.execute(text("SELECT * FROM core.users WHERE id = :id"), {"id": user_id})
    user = row.fetchone()
    u = dict(user._mapping)
    u.pop("hashed_password", None)
    u.pop("mfa_secret", None)
    return u

@router.post("/login")
async def login(payload: dict, db: AsyncSession = Depends(get_db)):
    row = await db.execute(
        text("SELECT * FROM core.users WHERE email = :email AND is_active = TRUE"),
        {"email": payload["email"]},
    )
    user = row.fetchone()
    if not user or not verify_password(payload["password"], user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if user.mfa_enabled:
        if not payload.get("totp_code"):
            raise HTTPException(status_code=403, detail="MFA code required",
                                headers={"X-MFA-Required": "true"})
        totp = pyotp.TOTP(user.mfa_secret)
        if not totp.verify(payload["totp_code"], valid_window=1):
            raise HTTPException(status_code=401, detail="Invalid MFA code")

    access_token = create_access_token(user.id, user.role)
    refresh_token, expires_at = create_refresh_token()

    await db.execute(
        text("INSERT INTO core.sessions (user_id, refresh_token, expires_at) VALUES (:uid, :rt, :exp)"),
        {"uid": user.id, "rt": refresh_token, "exp": expires_at},
    )
    await db.commit()

    log.info("user_login", user_id=str(user.id), role=user.role)
    return {
        "access_token": access_token, "refresh_token": refresh_token,
        "token_type": "bearer", "expires_in": settings.jwt_expire_minutes * 60,
        "role": user.role, "user_id": str(user.id),
    }

@router.post("/refresh")
async def refresh_token(payload: dict, db: AsyncSession = Depends(get_db)):
    row = await db.execute(
        text("""
            SELECT s.*, u.role, u.is_active FROM core.sessions s
            JOIN core.users u ON u.id = s.user_id
            WHERE s.refresh_token = :rt AND s.expires_at > NOW()
        """),
        {"rt": payload["refresh_token"]},
    )
    session = row.fetchone()
    if not session or not session.is_active:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    new_access = create_access_token(session.user_id, session.role)
    new_refresh, new_expires = create_refresh_token()

    await db.execute(
        text("DELETE FROM core.sessions WHERE refresh_token = :rt"),
        {"rt": payload["refresh_token"]},
    )
    await db.execute(
        text("INSERT INTO core.sessions (user_id, refresh_token, expires_at) VALUES (:uid, :rt, :exp)"),
        {"uid": session.user_id, "rt": new_refresh, "exp": new_expires},
    )
    await db.commit()
    return {
        "access_token": new_access, "refresh_token": new_refresh,
        "token_type": "bearer", "expires_in": settings.jwt_expire_minutes * 60,
        "role": session.role, "user_id": str(session.user_id),
    }

@router.post("/logout")
async def logout(payload: dict, current_user: CurrentUser = Depends(require_any_auth),
                 db: AsyncSession = Depends(get_db)):
    await db.execute(
        text("DELETE FROM core.sessions WHERE refresh_token = :rt AND user_id = :uid"),
        {"rt": payload.get("refresh_token", ""), "uid": current_user.user_id},
    )
    await db.commit()
    return {"message": "Logged out successfully"}

@router.post("/forgot-password")
async def forgot_password(payload: dict, db: AsyncSession = Depends(get_db)):
    row = await db.execute(
        text("SELECT id, email FROM core.users WHERE email = :email"),
        {"email": payload["email"]},
    )
    user = row.fetchone()
    if not user:
        return {"message": "If email exists, a reset link has been sent"}

    reset_token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=1)

    await db.execute(
        text("""
            UPDATE core.users
            SET password_reset_token = :token, password_reset_expires = :exp
            WHERE id = :uid
        """),
        {"token": reset_token, "exp": expires_at, "uid": user.id},
    )
    await db.commit()
    log.info("password_reset_requested", user_id=str(user.id))
    return {
        "message": "Password reset token generated",
        "reset_token": reset_token,
        "note": "In production this would be emailed. Use this token at /auth/reset-password"
    }

@router.post("/reset-password")
async def reset_password(payload: dict, db: AsyncSession = Depends(get_db)):
    row = await db.execute(
        text("""
            SELECT id FROM core.users
            WHERE password_reset_token = :token
            AND password_reset_expires > NOW()
        """),
        {"token": payload["reset_token"]},
    )
    user = row.fetchone()
    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    new_password = payload.get("new_password", "")
    if len(new_password) < 8:
        raise HTTPException(status_code=422, detail="Password too short")

    hashed = hash_password(new_password)
    await db.execute(
        text("""
            UPDATE core.users
            SET hashed_password = :pw, password_reset_token = NULL,
                password_reset_expires = NULL, updated_at = NOW()
            WHERE id = :uid
        """),
        {"pw": hashed, "uid": user.id},
    )
    await db.commit()
    log.info("password_reset_complete", user_id=str(user.id))
    return {"message": "Password reset successfully. Please login."}

@router.post("/mfa/setup")
async def setup_mfa(current_user: CurrentUser = Depends(require_any_auth),
                    db: AsyncSession = Depends(get_db)):
    row = await db.execute(
        text("SELECT email, mfa_enabled FROM core.users WHERE id = :uid"),
        {"uid": current_user.user_id},
    )
    user = row.fetchone()
    if user.mfa_enabled:
        raise HTTPException(status_code=400, detail="MFA already enabled")

    secret = pyotp.random_base32()
    totp = pyotp.TOTP(secret)
    uri = totp.provisioning_uri(name=user.email, issuer_name=settings.totp_issuer)

    await db.execute(
        text("UPDATE core.users SET mfa_secret = :secret WHERE id = :uid"),
        {"secret": secret, "uid": current_user.user_id},
    )
    await db.commit()
    backup_codes = [secrets.token_hex(4).upper() for _ in range(8)]
    return {"secret": secret, "qr_uri": uri, "backup_codes": backup_codes}

@router.post("/mfa/verify")
async def verify_mfa(payload: dict, current_user: CurrentUser = Depends(require_any_auth),
                     db: AsyncSession = Depends(get_db)):
    row = await db.execute(
        text("SELECT mfa_secret FROM core.users WHERE id = :uid"),
        {"uid": current_user.user_id},
    )
    user = row.fetchone()
    if not user or not user.mfa_secret:
        raise HTTPException(status_code=400, detail="MFA setup not initiated")

    totp = pyotp.TOTP(user.mfa_secret)
    if not totp.verify(payload["totp_code"], valid_window=1):
        raise HTTPException(status_code=400, detail="Invalid TOTP code")

    await db.execute(
        text("UPDATE core.users SET mfa_enabled = TRUE WHERE id = :uid"),
        {"uid": current_user.user_id},
    )
    await db.commit()
    return {"message": "MFA enabled successfully"}

@router.get("/me")
async def me(current_user: CurrentUser = Depends(require_any_auth),
             db: AsyncSession = Depends(get_db)):
    row = await db.execute(
        text("SELECT * FROM core.users WHERE id = :uid"),
        {"uid": current_user.user_id},
    )
    user = row.fetchone()
    u = dict(user._mapping)
    u.pop("hashed_password", None)
    u.pop("mfa_secret", None)
    u.pop("password_reset_token", None)
    return u
