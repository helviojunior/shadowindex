import React from 'react';

/**
 * ShieldKey Icon - Custom icon for credentials/security
 * Replaces lucide-react Key icon
 */
const ShieldKeyIcon = ({ className = '', size = 24, ...props }) => {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round"
      width={size}
      height={size}
      className={className}
      {...props}
    >
      {/* Shield outline */}
      <path d="M12 2L4 6v5c0 5.25 3.4 10.15 8 12 4.6-1.85 8-6.75 8-12V6l-8-4z" />
      
      {/* Padlock body */}
      <rect x="8" y="9" width="5" height="4" rx="0.5" fill="currentColor" stroke="none" />
      
      {/* Padlock shackle */}
      <path d="M9 9V7.5a1.5 1.5 0 0 1 3 0V9" strokeWidth="1.5" />
      
      {/* Keyhole */}
      <circle cx="10.5" cy="10.5" r="0.5" fill="none" stroke="currentColor" strokeWidth="0.5" />
      <line x1="10.5" y1="11" x2="10.5" y2="12" strokeWidth="0.5" />
      
      {/* Key */}
      <circle cx="17" cy="10" r="2" fill="currentColor" stroke="none" />
      <circle cx="17" cy="10" r="0.7" fill="none" stroke="currentColor" strokeWidth="0.3" style={{ stroke: 'var(--background, #1a1a1a)' }} />
      <path d="M15.5 11.5L14 13l0.5 0.5M14.5 12.5L14 13" fill="none" strokeWidth="1.5" />
      <line x1="15" y1="11" x2="13" y2="16" strokeWidth="1.5" />
      
      {/* Key teeth */}
      <path d="M13.5 14.5l-1 0.3M14 13l-1 0.3" strokeWidth="1" />
    </svg>
  );
};

export default ShieldKeyIcon;
