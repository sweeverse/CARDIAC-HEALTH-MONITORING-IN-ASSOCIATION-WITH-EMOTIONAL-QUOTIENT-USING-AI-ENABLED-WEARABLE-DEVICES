from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    MONGODB_URI: str = "mongodb://localhost:27017"
    MONGODB_DB_NAME: str = "CardioEQ"

    JWT_SECRET: str = "dev-secret-change-me"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440

    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:3000"

    ANTHROPIC_API_KEY: str = ""
    # Health Assistant chatbot — Gemini key. Real value lives in .env only
    # (gitignored), never in source. Falls back to template-mode responses
    # when unset (see assistant_service.py).
    GEMINI_API_KEY: str = ""
    GROQ_API_KEY: str = ""
    AIR_QUALITY_API_KEY: str = ""

    # Hardcoded administrator account. Separate from normal signup — never
    # created via /api/auth/signup, only bootstrapped on server startup
    # (see db.ensure_admin_account). Override via .env in real deployments.
    ADMIN_FULL_NAME: str = "System Administrator"
    ADMIN_EMAIL: str = "admin@cardioeq.ai"
    ADMIN_PASSWORD: str = "CardioEQ-Admin-2026!"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


settings = Settings()

# Fixed email -> Subject ID mapping (spec section A.1.1). Whenever one of
# these emails signs up, they are linked to this exact subject_id instead of
# being assigned the next auto-incrementing number. Keys are lower-cased to
# match the normalized email comparison used everywhere else in auth.py.
EMAIL_SUBJECT_MAP: dict[str, str] = {
    "shrutidas458@gmail.com": "S01",
    "mukherjeetuneer@gmail.com": "S15",
    "kirtikadharaiml@gmail.com": "S10",
    "sweekritibiswas@gmail.com": "S02",
    "eshaa.exe@gmail.com": "S03",
}
