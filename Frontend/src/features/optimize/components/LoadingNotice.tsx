import { API_BASE_URL } from '@/lib/apiClient';

// Shown until the first solve answers
export function LoadingNotice() {
  return (
    <div className="opt-loading">
      <div className="opt-panel">
        <h2 className="opt-ph">Loading</h2>
        Calling <span className="mono">POST {API_BASE_URL}/api/v1/optimize</span> …
        (if the backend is not running, the page falls back to the built-in sample plan automatically)
      </div>
    </div>
  );
}
