"""Tiny online linear models — pure Python, JSON-persisted."""

from __future__ import annotations

import json
import logging
import math
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_DEFAULT_DIR = Path(__file__).resolve().parents[2] / "data" / "ml"


@dataclass
class LinearModel:
    """Online SGD linear regressor: y ≈ w·x."""

    name: str
    weights: list[float] = field(default_factory=list)
    lr: float = 0.05
    l2: float = 1e-4
    n_updates: int = 0
    last_trained_at: float | None = None
    metrics: dict[str, float] = field(default_factory=dict)

    def ensure_dim(self, n: int) -> None:
        if len(self.weights) < n:
            self.weights.extend([0.0] * (n - len(self.weights)))
        elif len(self.weights) > n:
            self.weights = self.weights[:n]

    def predict(self, x: list[float]) -> float:
        self.ensure_dim(len(x))
        return sum(w * xi for w, xi in zip(self.weights, x))

    def update(self, x: list[float], y: float) -> float:
        self.ensure_dim(len(x))
        pred = self.predict(x)
        err = pred - y
        for i, xi in enumerate(x):
            grad = err * xi + self.l2 * self.weights[i]
            self.weights[i] -= self.lr * grad
        self.n_updates += 1
        self.last_trained_at = time.time()
        return err

    def batch_fit(self, xs: list[list[float]], ys: list[float], epochs: int = 8) -> dict[str, float]:
        if not xs:
            return {"samples": 0, "mae": 0.0}
        for _ in range(epochs):
            for x, y in zip(xs, ys):
                self.update(x, y)
        errs = [abs(self.predict(x) - y) for x, y in zip(xs, ys)]
        mae = sum(errs) / len(errs)
        self.metrics = {"samples": float(len(xs)), "mae": round(mae, 4), "epochs": float(epochs)}
        return self.metrics

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "LinearModel":
        return cls(
            name=str(data.get("name") or "model"),
            weights=[float(w) for w in (data.get("weights") or [])],
            lr=float(data.get("lr", 0.05)),
            l2=float(data.get("l2", 1e-4)),
            n_updates=int(data.get("n_updates") or 0),
            last_trained_at=data.get("last_trained_at"),
            metrics=dict(data.get("metrics") or {}),
        )


@dataclass
class MatchWeights:
    """Learned SmartRouter weight vector (normalized)."""

    weights: dict[str, float] = field(
        default_factory=lambda: {
            "distance": 0.25,
            "eta": 0.20,
            "driver_rating": 0.15,
            "acceptance_rate": 0.10,
            "passenger_rating": 0.05,
            "vehicle_match": 0.10,
            "safety_score": 0.10,
            "preference_match": 0.05,
        }
    )
    n_updates: int = 0
    last_trained_at: float | None = None

    def normalized(self) -> dict[str, float]:
        total = sum(max(0.01, v) for v in self.weights.values()) or 1.0
        return {k: max(0.01, v) / total for k, v in self.weights.items()}

    def reinforce(self, factors: dict[str, float], success: bool, lr: float = 0.02) -> None:
        """Bump weights for factors that were high on successful matches."""
        sign = 1.0 if success else -0.5
        for k, v in factors.items():
            if k not in self.weights:
                continue
            self.weights[k] = max(0.01, self.weights[k] + sign * lr * float(v))
        # renormalize soft
        normed = self.normalized()
        self.weights = normed
        self.n_updates += 1
        self.last_trained_at = time.time()

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "MatchWeights":
        w = dict(data.get("weights") or {})
        if not w:
            return cls(
                n_updates=int(data.get("n_updates") or 0),
                last_trained_at=data.get("last_trained_at"),
            )
        return cls(
            weights=w,
            n_updates=int(data.get("n_updates") or 0),
            last_trained_at=data.get("last_trained_at"),
        )


class ModelStore:
    def __init__(self, root: Path | None = None) -> None:
        self.root = root or _DEFAULT_DIR
        self.root.mkdir(parents=True, exist_ok=True)
        self.surge = LinearModel(name="surge_residual")
        self.eta = LinearModel(name="eta_minutes")
        self.match = MatchWeights()
        self.load()

    def _path(self, name: str) -> Path:
        return self.root / f"{name}.json"

    def load(self) -> None:
        for attr, name, factory in (
            ("surge", "surge_residual", LinearModel.from_dict),
            ("eta", "eta_minutes", LinearModel.from_dict),
        ):
            path = self._path(name)
            if path.exists():
                try:
                    data = json.loads(path.read_text(encoding="utf-8"))
                    setattr(self, attr, factory(data))
                except Exception as exc:
                    logger.warning("ML load %s failed: %s", name, exc)
        mp = self._path("match_weights")
        if mp.exists():
            try:
                self.match = MatchWeights.from_dict(json.loads(mp.read_text(encoding="utf-8")))
            except Exception as exc:
                logger.warning("ML load match_weights failed: %s", exc)

    def save(self) -> None:
        self._path("surge_residual").write_text(json.dumps(self.surge.to_dict(), indent=2), encoding="utf-8")
        self._path("eta_minutes").write_text(json.dumps(self.eta.to_dict(), indent=2), encoding="utf-8")
        self._path("match_weights").write_text(json.dumps(self.match.to_dict(), indent=2), encoding="utf-8")

    def status(self) -> dict[str, Any]:
        return {
            "dir": str(self.root),
            "surge": {
                "updates": self.surge.n_updates,
                "metrics": self.surge.metrics,
                "last_trained_at": self.surge.last_trained_at,
            },
            "eta": {
                "updates": self.eta.n_updates,
                "metrics": self.eta.metrics,
                "last_trained_at": self.eta.last_trained_at,
            },
            "match": {
                "updates": self.match.n_updates,
                "weights": self.match.normalized(),
                "last_trained_at": self.match.last_trained_at,
            },
        }


_store: ModelStore | None = None


def get_model_store() -> ModelStore:
    global _store
    if _store is None:
        _store = ModelStore()
    return _store


def predict_surge_multiplier(
    *,
    base_surge: float,
    hour: int,
    dow: int,
    demand: int,
    supply: int,
    distance_km: float = 0.0,
) -> float:
    from app.ml.features import surge_features

    store = get_model_store()
    x = surge_features(hour=hour, dow=dow, demand=demand, supply=supply, distance_km=distance_km)
    residual = store.surge.predict(x)
    # residual is additive on surge (trained as surge - 1.0)
    surge = base_surge + residual
    return max(1.0, min(5.0, round(surge, 2)))


def predict_eta_seconds(distance_km: float, hour: int | None = None, dow_v: int | None = None) -> float:
    from app.ml.features import dow as dow_fn
    from app.ml.features import eta_features, hour_bucket

    h = hour if hour is not None else hour_bucket()
    d = dow_v if dow_v is not None else dow_fn()
    store = get_model_store()
    minutes = store.eta.predict(eta_features(distance_km=distance_km, hour=h, dow=d))
    if store.eta.n_updates < 5:
        # cold start heuristic
        traffic = 1.4 if h in (7, 8, 9, 16, 17, 18, 19) else 0.9
        speed = max(8.0, 30.0 / traffic)
        return max(60.0, (distance_km / speed) * 3600.0)
    return max(60.0, float(minutes) * 60.0)


def learned_match_weights() -> dict[str, float]:
    return get_model_store().match.normalized()
