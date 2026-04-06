'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const ipc = typeof window !== 'undefined' ? window.cortex : null;
    if (!ipc) {
      router.replace('/sources');
      return;
    }
    ipc.getConfig().then((config: Record<string, unknown>) => {
      if (config.welcomeCompleted) {
        router.replace('/sources');
      }
      // If not completed, Shell will show onboarding overlay
      setChecked(true);
    }).catch(() => {
      router.replace('/sources');
    });
  }, [router]);

  if (!checked) return null;
  // Render empty — Shell's onboarding overlay handles the rest
  return null;
}
