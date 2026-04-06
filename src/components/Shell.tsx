'use client';

import { useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { SearchOverlay } from './SearchOverlay';
import { OnboardingFlow } from './OnboardingFlow';
import { CompilerBar } from './CompilerBar';

export function Shell({ children }: { children: React.ReactNode }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Check welcome
  useEffect(() => {
    const ipc = typeof window !== 'undefined' ? window.cortex : null;
    if (!ipc) return;
    ipc.getConfig().then((config: Record<string, unknown>) => {
      if (!config.welcomeCompleted) {
        setShowWelcome(true);
      }
    }).catch(() => {});
  }, []);

  const handleWelcomeComplete = () => {
    setShowWelcome(false);
  };

  return (
    <div style={{ height: '100vh', background: '#fbf9f7' }}>
      {showWelcome && <OnboardingFlow onComplete={handleWelcomeComplete} />}

      {/* Titlebar drag region */}
      <div className="titlebar-drag" style={{ position: 'fixed', top: 0, left: 264, right: 0, height: 32, zIndex: 40 }} />

      {/* Sidebar */}
      <Sidebar />

      {/* Settings panel */}

      {/* Search overlay */}
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />

      {/* Main content */}
      <main style={{
        marginLeft: 264,
        paddingTop: 48,
        height: '100vh',
        overflow: 'hidden',
        backgroundImage: 'radial-gradient(circle, #dbc1b9 0.5px, transparent 0.5px)',
        backgroundSize: '24px 24px',
      }}>
        {children}
      </main>

      {/* Global compiler progress bar */}
      <CompilerBar />
    </div>
  );
}
