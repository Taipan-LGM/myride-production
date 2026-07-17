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
COPY app ./app
COPY run.py .

# Create a non-root user
RUN useradd --create-home --uid 10001 appuser \
    && chown -R appuser:appuser /app

USER appuser

# Default command
CMD ["python", "run.py"]
