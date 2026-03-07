"""Auth Router — /api/auth"""
from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel
from database.db import Database
from services.auth_service import hash_password, verify_password, create_access_token, decode_token

router = APIRouter()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


# ── Shared DB instance (module-level pool, safe) ──────────────────────────────
def get_db() -> Database:
    return Database()


class RegisterRequest(BaseModel):
    name: str
    email: str
    password: str


async def get_current_user(token: str = Depends(oauth2_scheme)):
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Token inválido ou expirado")
    user = await get_db().get_user_by_id(payload["sub"])
    if not user:
        raise HTTPException(status_code=401, detail="Usuário não encontrado")
    return user


def _safe_user(user: dict) -> dict:
    return {k: v for k, v in user.items() if k != "password_hash"}


@router.post("/register")
async def register(req: RegisterRequest):
    db = get_db()
    # Basic validation
    if not req.name or len(req.name.strip()) < 2:
        raise HTTPException(400, "Nome deve ter pelo menos 2 caracteres")
    if not req.email or "@" not in req.email:
        raise HTTPException(400, "Email inválido")
    if not req.password or len(req.password) < 6:
        raise HTTPException(400, "Senha deve ter pelo menos 6 caracteres")

    existing = await db.get_user_by_email(req.email.lower().strip())
    if existing:
        raise HTTPException(400, "Email já cadastrado")

    pw_hash = await hash_password(req.password)
    user = await db.create_user(
        name=req.name.strip(),
        email=req.email.lower().strip(),
        password_hash=pw_hash
    )
    token = create_access_token(user["id"], user["email"])
    return {"access_token": token, "token_type": "bearer", "user": _safe_user(user)}


@router.post("/login")
async def login(form: OAuth2PasswordRequestForm = Depends()):
    db = get_db()
    user = await db.get_user_by_email(form.username.lower().strip())
    if not user:
        raise HTTPException(401, "Email ou senha incorretos")
    ok = await verify_password(form.password, user["password_hash"])
    if not ok:
        raise HTTPException(401, "Email ou senha incorretos")
    token = create_access_token(user["id"], user["email"])
    return {"access_token": token, "token_type": "bearer", "user": _safe_user(user)}


@router.get("/me")
async def me(current_user: dict = Depends(get_current_user)):
    return _safe_user(current_user)


@router.post("/logout")
async def logout():
    return {"message": "ok"}
