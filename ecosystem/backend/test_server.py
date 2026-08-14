
import subprocess
import time
import urllib.request
import json
import os

print("=== PHASE 2 VERIFICATION ===\n")

# Set environment variables
env = os.environ.copy()
env['API_PORT'] = '8001'
env['API_HOST'] = '0.0.0.0'
env['DEBUG'] = 'true'

print("1. Starting server...")

# Run the server
proc = subprocess.Popen(
    ['.venv/Scripts/python.exe', 'run.py'],
    cwd=r'C:\Users\taipa\OneDrive\Desktop\myride-production\ecosystem\backend',
    env=env,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True
)

# Wait for startup
time.sleep(5)

# Check health
try:
    with urllib.request.urlopen('http://localhost:8001/health', timeout=5) as response:
        health = json.loads(response.read().decode())
        print("2. Health check:", json.dumps(health, indent=2))
except Exception as e:
    print("2. Health check error:", e)

# Test rider login
try:
    data = json.dumps({"identifier":"rider@myride.co.za","password":"ride123","role":"rider"}).encode()
    req = urllib.request.Request('http://localhost:8001/auth/login', data=data, headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(req, timeout=5) as response:
        result = json.loads(response.read().decode())
        print("3. Rider login:", "SUCCESS" if result.get("access_token") else "FAILED")
except Exception as e:
    print("3. Rider login error:", e)

# Cleanup
proc.terminate()
proc.wait(timeout=5)
print("\nServer stopped.")
