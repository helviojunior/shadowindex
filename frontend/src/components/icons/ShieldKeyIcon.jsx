import React from 'react';

/**
 * CredentialKeyIcon - Custom icon for credentials/passwords
 * Key with zigzag teeth + password field with asterisks
 * Based on reference image
 */
const CredentialKeyIcon = ({ className = '', size = 24, ...props }) => {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      viewBox="0 0 24 24" 
      width={size}
      height={size}
      className={className}
      fill="currentColor"
      {...props}
    >
      {/* Key head (oval filled) */}
      <ellipse cx="4.5" cy="5" rx="3.5" ry="4" />
      
      {/* Key hole (cutout) */}
      <circle cx="4.5" cy="5" r="1" fill="var(--background, #1a1a1a)" />
      
      {/* Key shaft base */}
      <rect x="7.5" y="3.5" width="3.5" height="3" />
      
      {/* Key teeth - zigzag shape pointing right */}
      <polygon points="11,3.5 14,3.5 14,4.5 16,4.5 16,3.5 18,3.5 20,5 18,6.5 16,6.5 16,5.5 14,5.5 14,6.5 11,6.5" />
      
      {/* Password field bar (bottom rectangle) */}
      <rect x="1" y="15" width="22" height="8" rx="0.8" />
      
      {/* Asterisks as 6-line stars */}
      <g stroke="var(--background, #1a1a1a)" strokeWidth="1.2" strokeLinecap="round">
        {/* Asterisk 1 */}
        <line x1="5" y1="17" x2="5" y2="21" />
        <line x1="3" y1="18" x2="7" y2="20" />
        <line x1="7" y1="18" x2="3" y2="20" />
        
        {/* Asterisk 2 */}
        <line x1="10" y1="17" x2="10" y2="21" />
        <line x1="8" y1="18" x2="12" y2="20" />
        <line x1="12" y1="18" x2="8" y2="20" />
        
        {/* Asterisk 3 */}
        <line x1="15" y1="17" x2="15" y2="21" />
        <line x1="13" y1="18" x2="17" y2="20" />
        <line x1="17" y1="18" x2="13" y2="20" />
        
        {/* Asterisk 4 */}
        <line x1="20" y1="17" x2="20" y2="21" />
        <line x1="18" y1="18" x2="22" y2="20" />
        <line x1="22" y1="18" x2="18" y2="20" />
      </g>
    </svg>
  );
};

// Export with both names for compatibility
const ShieldKeyIcon = CredentialKeyIcon;

export { CredentialKeyIcon, ShieldKeyIcon };
export default CredentialKeyIcon;
