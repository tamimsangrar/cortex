import React from 'react';

interface IconProps {
  size?: number;
}

export function IMessageIcon({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="imessage-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#5AC8FA" />
          <stop offset="100%" stopColor="#34C759" />
        </linearGradient>
      </defs>
      <path
        d="M12 2C6.477 2 2 5.82 2 10.5c0 2.47 1.33 4.68 3.42 6.22-.18 1.68-.96 3.12-.97 3.13a.5.5 0 00.44.75c2.1-.05 3.84-.89 4.9-1.63.71.2 1.45.33 2.21.33 5.523 0 10-3.82 10-8.5S17.523 2 12 2z"
        fill="url(#imessage-gradient)"
      />
    </svg>
  );
}

export function WhatsAppIcon({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91C21.95 6.45 17.5 2 12.04 2zm5.82 14.01c-.24.68-1.41 1.3-1.95 1.38-.5.07-1.13.1-1.82-.11-.42-.13-.96-.31-1.65-.61-2.9-1.24-4.79-4.15-4.94-4.34-.14-.19-1.18-1.57-1.18-3 0-1.43.75-2.14 1.01-2.43.27-.29.58-.37.78-.37.19 0 .39 0 .56.01.18.01.42-.07.66.5.24.58.82 2.01.89 2.15.07.15.12.32.02.51-.1.19-.15.31-.29.48-.15.17-.31.38-.44.51-.15.15-.3.31-.13.6.17.3.78 1.28 1.67 2.07 1.15.82 2.12 1.07 2.42 1.19.29.12.47.1.64-.06.17-.17.74-.86.94-1.15.2-.3.4-.25.67-.15.27.1 1.72.81 2.01.96.3.15.49.22.56.34.07.12.07.68-.17 1.36z"
        fill="#25D366"
      />
    </svg>
  );
}

export function ObsidianIcon({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 2L3 7.5V16.5L12 22L21 16.5V7.5L12 2Z"
        fill="#7C3AED"
        opacity="0.15"
      />
      <path
        d="M12 2L3 7.5V16.5L12 22L21 16.5V7.5L12 2Z"
        stroke="#7C3AED"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M12 2L8 10L12 22L16 10L12 2Z"
        fill="#7C3AED"
        opacity="0.4"
      />
      <path
        d="M3 7.5L8 10M21 7.5L16 10M8 10L12 22M16 10L12 22M8 10L16 10"
        stroke="#7C3AED"
        strokeWidth="1.2"
        strokeLinejoin="round"
        opacity="0.6"
      />
    </svg>
  );
}

export function NotionIcon({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="3" width="18" height="18" rx="4" fill="#000000" />
      <path
        d="M7.5 7h2.8l3.4 5.6V7H16v10h-2.6L9.9 11.2V17H7.5V7z"
        fill="#ffffff"
      />
    </svg>
  );
}

export function AppleNotesIcon({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="2" width="16" height="20" rx="3" fill="#FDD835" />
      <rect x="4" y="2" width="16" height="5" rx="2" fill="#F9A825" />
      <line x1="7.5" y1="10.5" x2="16.5" y2="10.5" stroke="#A67B00" strokeWidth="1" strokeLinecap="round" />
      <line x1="7.5" y1="13.5" x2="16.5" y2="13.5" stroke="#A67B00" strokeWidth="1" strokeLinecap="round" />
      <line x1="7.5" y1="16.5" x2="13" y2="16.5" stroke="#A67B00" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

export function WebClipIcon({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="9" stroke="#88726c" strokeWidth="1.5" />
      <ellipse cx="12" cy="12" rx="4" ry="9" stroke="#88726c" strokeWidth="1.2" />
      <line x1="3" y1="12" x2="21" y2="12" stroke="#88726c" strokeWidth="1.2" />
      <line x1="5" y1="7.5" x2="19" y2="7.5" stroke="#88726c" strokeWidth="0.8" />
      <line x1="5" y1="16.5" x2="19" y2="16.5" stroke="#88726c" strokeWidth="0.8" />
      <path
        d="M17 17L20 20"
        stroke="#88726c"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
