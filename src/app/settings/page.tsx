'use client';

import { SettingsPanel } from '@/components/SettingsPanel';

export default function SettingsPage() {
  return (
    <div className="page-transition" style={{ height: '100%', overflow: 'hidden' }}>
      <SettingsPanel open={true} onClose={() => {}} inline={true} />
    </div>
  );
}
