FROM python:3.11-slim

WORKDIR /app

# Instalar dependências do sistema (incluindo libmagic para python-magic e curl/wget para downloads)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libmagic1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Download e instalação do GitLeaks v8.29.1
RUN curl -sSL https://github.com/gitleaks/gitleaks/releases/download/v8.29.1/gitleaks_8.29.1_linux_x64.tar.gz -o /tmp/gitleaks.tar.gz \
    && tar -xzf /tmp/gitleaks.tar.gz -C /tmp \
    && mv /tmp/gitleaks /usr/sbin/gitleaks \
    && chmod +x /usr/sbin/gitleaks \
    && rm -rf /tmp/gitleaks.tar.gz /tmp/LICENSE /tmp/README.md \
    && gitleaks version

COPY requirements.txt .
RUN grep -v '^emergentintegrations' requirements.txt | pip install --no-cache-dir -r /dev/stdin

COPY . .

EXPOSE 8001

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8001", "--reload"]