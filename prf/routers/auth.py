"""Auth router — registration, login, profile."""
from fastapi import APIRouter, HTTPException, Depends
from uuid import UUID

from prf.models.user import UserRegister, UserLogin, UserOut, TokenResponse
from prf.services.auth_service import hash_password, verify_password, create_token
from prf.routers.deps import get_repo, get_current_user_id
from prf.database.repository import PRFRepository

router = APIRouter()


@router.post("/register", response_model=TokenResponse)
async def register(body: UserRegister, repo: PRFRepository = Depends(get_repo)):
    existing = await repo.get_user_by_email(body.email)
    if existing:
        raise HTTPException(409, "Email already registered")

    pw_hash = hash_password(body.password)
    user = await repo.create_user(body.email, pw_hash, body.name)
    token = create_token(user["id"])

    return TokenResponse(
        access_token=token,
        user=UserOut(**user),
    )


@router.post("/login", response_model=TokenResponse)
async def login(body: UserLogin, repo: PRFRepository = Depends(get_repo)):
    user = await repo.get_user_by_email(body.email)
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(401, "Invalid credentials")

    await repo.update_last_login(user["id"])
    token = create_token(user["id"])

    return TokenResponse(
        access_token=token,
        user=UserOut(
            id=user["id"],
            email=user["email"],
            name=user["name"],
            created_at=user["created_at"],
            last_login_at=user.get("last_login_at"),
        ),
    )


@router.get("/me", response_model=UserOut)
async def get_me(
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    user = await repo.get_user_by_id(user_id)
    if not user:
        raise HTTPException(404, "User not found")
    return UserOut(
        id=user["id"],
        email=user["email"],
        name=user["name"],
        created_at=user["created_at"],
        last_login_at=user.get("last_login_at"),
    )
