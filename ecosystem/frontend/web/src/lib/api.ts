// API client for MyRide backend
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8001';

export interface HealthResponse {
  status: string;
  version: string;
  services: Record<string, string>;
}

export interface LoginResponse {
  access_token: string;
  user: Record<string, unknown>;
}

export interface LoginRequest {
  identifier: string;
  password: string;
  role: 'rider' | 'driver' | 'admin';
}

// Health check endpoint
export async function healthCheck(): Promise<HealthResponse> {
  const response = await fetch(`${API_BASE_URL}/health`);
  if (!response.ok) {
    throw new Error('Health check failed');
  }
  return response.json();
}

// Login endpoint
export async function login(data: LoginRequest): Promise<LoginResponse> {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
  
  if (!response.ok) {
    throw new Error('Login failed');
  }
  return response.json();
}

// WebSocket connection helper
export function createWebSocket(path: string = '/ws/ops'): WebSocket {
  const wsUrl = API_BASE_URL.replace('http', 'ws').replace('https', 'wss') + path;
  return new WebSocket(wsUrl);
}