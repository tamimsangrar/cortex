'use client';

import { useState, useRef } from 'react';

type ButtonState = 'idle' | 'pressing' | 'compiling' | 'queued';

export function CompileButton({ sourceType }: { sourceType?: string }) {
  const [buttonState, setButtonState] = useState<ButtonState>('idle');
  const [queuedCount, setQueuedCount] = useState<number | null>(null);
  const queueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ipc = typeof window !== 'undefined' ? window.cortex : null;

  const handleCompile = async () => {
    if (!ipc || !ipc.startCompiler || buttonState === 'compiling') return;

    // Trigger press animation
    setButtonState('pressing');
    await new Promise(r => setTimeout(r, 150));

    try {
      const result = await ipc.startCompiler(sourceType);

      if (result && (result as { queued?: boolean }).queued) {
        // Compilation was queued
        const count = (result as { queuedEntries?: number }).queuedEntries || 0;
        setQueuedCount(count);
        setButtonState('queued');

        // Reset after 2.5s
        if (queueTimerRef.current) clearTimeout(queueTimerRef.current);
        queueTimerRef.current = setTimeout(() => {
          setButtonState('idle');
          setQueuedCount(null);
        }, 2500);
      } else if (result && (result as { error?: string }).error) {
        setButtonState('idle');
      } else {
        setButtonState('compiling');
        // Poll until done
        const poll = setInterval(async () => {
          try {
            const state = await ipc.getCompilerState();
            if (state.status === 'idle' || state.status === 'error') {
              clearInterval(poll);
              setButtonState('idle');
            }
          } catch {
            clearInterval(poll);
            setButtonState('idle');
          }
        }, 2000);
      }
    } catch {
      setButtonState('idle');
    }
  };

  const isDisabled = buttonState === 'compiling';

  const getBackground = () => {
    switch (buttonState) {
      case 'pressing': return '#c4603f';
      case 'compiling': return '#e4e2e0';
      case 'queued': return '#006b5f';
      default: return '#d97757';
    }
  };

  const getColor = () => {
    switch (buttonState) {
      case 'compiling': return '#88726c';
      case 'queued': return '#ffffff';
      default: return '#ffffff';
    }
  };

  const getLabel = () => {
    switch (buttonState) {
      case 'compiling': return 'Compiling...';
      case 'queued': return `Queued${queuedCount ? ` +${queuedCount}` : ''} ✓`;
      default: return 'Compile Wiki';
    }
  };

  const getIcon = () => {
    switch (buttonState) {
      case 'queued': return 'playlist_add_check';
      default: return 'auto_awesome';
    }
  };

  return (
    <button
      onClick={handleCompile}
      disabled={isDisabled}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        background: getBackground(),
        color: getColor(),
        padding: '6px 14px', borderRadius: 6, fontWeight: 600, fontSize: 12,
        border: 'none',
        cursor: isDisabled ? 'default' : 'pointer',
        whiteSpace: 'nowrap' as const,
        transform: buttonState === 'pressing' ? 'scale(0.93)' : 'scale(1)',
        transition: 'transform 0.15s cubic-bezier(0.2, 0, 0, 1), background 0.2s ease',
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 16, fontVariationSettings: "'FILL' 1" }}>{getIcon()}</span>
      {getLabel()}
    </button>
  );
}
