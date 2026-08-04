FROM python:3.12-slim

WORKDIR /app

# Instalar dependências do sistema
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Copiar requirements e instalar Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar código da aplicação
COPY . .

# Expor porta (Railway injeta PORT)
EXPOSE 8000

# Comando de startup
CMD ["uvicorn", "api.index:app", "--host", "0.0.0.0", "--port", "8000"]
