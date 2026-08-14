import { useState, useEffect } from 'react';
import { healthCheck } from '@/lib/api';

interface HealthData {
  status: string;
  version: string;
  services: Record<string, string>;
}

export default function Home() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    healthCheck()
      .then(setHealth)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="max-w-md w-full">
        <h1 className="text-3xl font-bold mb-6 text-center">My Ride Platform</h1>
        
        {loading && <p className="text-center">Loading...</p>}
        
        {health && (
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold mb-4">Backend Status</h2>
            
            <div className="mb-4">
              <p><strong>Status:</strong> {health.status}</p>
              <p><strong>Version:</strong> {health.version}</p>
            </div>
            
            <div>
              <h3 className="font-medium mb-2">Services:</h3>
              <ul className="list-disc list-inside">
                {Object.entries(health.services).map(([name, status]) => (
                  <li key={name} className="flex justify-between">
                    <span>{name}</span>
                    <span className="text-gray-600">{status}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
        
        <div className="mt-6 p-4 bg-gray-50 rounded-lg">
          <h3 className="font-medium mb-2">Quick Links:</h3>
          <ul className="space-y-2 text-sm">
            <li>• <a href="/api/health" className="text-blue-600 hover:underline">Health API</a></li>
          </ul>
        </div>
      </div>
    </main>
  );
}