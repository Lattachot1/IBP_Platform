import { AlertTriangle } from 'lucide-react';

import { API_BASE_URL } from '@/lib/apiClient';

// The figures beside it were not computed by the backend (yet)
export function NotLiveNotice({ backendOnline }: { backendOnline: boolean | null }) {
  return (
    <div className="rounded-xl px-4 py-3 border border-amber-300 bg-amber-50 text-amber-900 text-xs flex items-start gap-2">
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
      <span>
        {backendOnline === false
          ? `Backend offline (${API_BASE_URL}): the figures below are the illustrative starting case, not a live result. Start the backend to run or save simulations.`
          : 'Connecting to the simulation engine: the figures below are the illustrative starting case until it answers.'}
      </span>
    </div>
  );
}
