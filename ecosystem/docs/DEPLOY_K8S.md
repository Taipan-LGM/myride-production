# My Ride SA — Kubernetes deploy sketch (Part 13)

Path A ships Docker Compose first. This sketch is the next step for multi-region K8s.

## Prerequisites

- Container image of `ecosystem/backend` (see `backend/Dockerfile`)
- Postgres + Redis managed services (or in-cluster)
- Secrets: `JWT_SECRET`, `DATABASE_URL`, Stripe + Twilio live keys

## Example Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myride-api
spec:
  replicas: 2
  selector:
    matchLabels: { app: myride-api }
  template:
    metadata:
      labels: { app: myride-api }
    spec:
      containers:
        - name: api
          image: ghcr.io/YOUR_ORG/myride-api:latest
          ports: [{ containerPort: 8000 }]
          envFrom:
            - secretRef: { name: myride-secrets }
          env:
            - name: ENVIRONMENT
              value: production
            - name: DEBUG
              value: "false"
            - name: USE_POSTGRES_PRIMARY
              value: "true"
          readinessProbe:
            httpGet: { path: /health, port: 8000 }
            initialDelaySeconds: 5
            periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: myride-api
spec:
  selector: { app: myride-api }
  ports: [{ port: 80, targetPort: 8000 }]
```

## Secrets checklist

| Key | Required |
|-----|----------|
| `JWT_SECRET` | yes |
| `DATABASE_URL` | yes (primary) |
| `STRIPE_LIVE_SECRET_KEY` | yes for live pay |
| `STRIPE_WEBHOOK_SECRET` | yes |
| `TWILIO_ACCOUNT_SID` / `AUTH_TOKEN` / phone | voice/WhatsApp |
| `OPENAI_API_KEY` | optional (heuristics work without) |
| `CORS_ORIGINS` | your app domains (not `*`) |

## Local compose (still the Path A default)

```bash
cd ecosystem/backend
docker compose up -d postgres redis
DEBUG=true .venv/bin/python run.py
```
