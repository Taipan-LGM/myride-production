import threading
import time
from collections import defaultdict, deque


class RateLimiter:
    def __init__(self, limit=120, window_seconds=60, clock=None):
        self.limit = limit
        self.window_seconds = window_seconds
        self.clock = clock or time.monotonic
        self.requests = defaultdict(deque)
        self.lock = threading.Lock()

    def check(self, key):
        now = self.clock()
        cutoff = now - self.window_seconds
        with self.lock:
            history = self.requests[key]
            while history and history[0] <= cutoff:
                history.popleft()
            if len(history) >= self.limit:
                retry_after = max(1, int(self.window_seconds - (now - history[0]) + 0.999))
                return {"allowed": False, "remaining": 0, "retry_after": retry_after}
            history.append(now)
            return {"allowed": True, "remaining": self.limit - len(history), "retry_after": 0}