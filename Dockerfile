# Dockerfile (Files in root)
FROM python:3.12-slim AS builder

WORKDIR /build

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy and install requirements
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ========== RUNTIME STAGE ==========
FROM python:3.12-slim AS runtime

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /install /install

# Add the installed packages to Python path
ENV PYTHONPATH=/install/lib/python3.12/site-packages:$PYTHONPATH
ENV PATH="/install/bin:$PATH"

# Copy application code
COPY app.py run.py ./
COPY services ./services
COPY static ./static
RUN mkdir -p /app/data

# Create a non-root user
RUN useradd --create-home --uid 10001 appuser \
    && chown -R appuser:appuser /app

USER appuser

ENV MYRIDE_DATABASE_PATH=/app/data/myride.db
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')"]

# Default command
CMD ["python", "run.py"]
