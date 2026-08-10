import { logger } from "./logger.js";

class MemoryCache {
  constructor(options = {}) {
    this.cache = new Map();
    this.maxSize = options.maxSize ?? (Number(process.env.CACHE_MAX_SIZE) || 1000);
    this.defaultTTL =
      options.defaultTTL ?? (Number(process.env.CACHE_TTL_NEARBY) || 5000);
    this.hits = 0;
    this.misses = 0;

    this._cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    if (this._cleanupTimer.unref) this._cleanupTimer.unref();
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }
    if (entry.expires && entry.expires < Date.now()) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }
    this.hits++;
    return entry.value;
  }

  set(key, value, ttlMs = null) {
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }
    this.cache.set(key, {
      value,
      expires: Date.now() + (ttlMs ?? this.defaultTTL),
      createdAt: Date.now(),
    });
  }

  delete(key) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  getStats() {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? `${((this.hits / total) * 100).toFixed(2)}%` : "N/A",
    };
  }

  cleanup() {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, entry] of this.cache) {
      if (entry.expires && entry.expires < now) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      logger.debug(`Cache cleanup: removed ${cleaned} expired entries`);
    }
  }

  evictOldest() {
    let oldestKey = null;
    let oldestTime = Infinity;
    for (const [key, entry] of this.cache) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      this.cache.delete(oldestKey);
      logger.debug(`Cache evicted oldest entry: ${oldestKey}`);
    }
  }
}

const cache = new MemoryCache();

export function isNearbyCacheEnabled() {
  const flag = process.env.ENABLE_NEARBY_CACHE;
  if (flag === "0" || flag === "false") return false;
  if (process.env.CACHE_ENABLED === "0" || process.env.CACHE_ENABLED === "false") {
    return false;
  }
  return true;
}

export function nearbyCacheKey({ lat, lng, radiusM, vehicleType, limit }) {
  const rLat = Number(lat).toFixed(4);
  const rLng = Number(lng).toFixed(4);
  return `nearby:${rLat}:${rLng}:${radiusM}:${vehicleType || "all"}:${limit}`;
}

export default cache;
