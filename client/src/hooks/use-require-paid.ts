import { useEffect } from 'react';

export function useRequirePaid() {
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/me');
        if (!res.ok) {
          window.location.href = '/pricing';
          return;
        }
        const data = await res.json();
        if (!data || data.plan === 'FREE') {
          window.location.href = '/pricing';
        }
      } catch (e) {
        window.location.href = '/pricing';
      }
    })();
  }, []);
}
