import React from 'react';

/**
 * CredentialKeyIcon - Custom icon for credentials/passwords
 * Key with zigzag teeth + password field with asterisks
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
      <ellipse cx="5" cy="5.5" rx="4" ry="4.5" />
      
      {/* Key hole (cutout) */}
      <ellipse cx="5" cy="5.5" rx="1" ry="1.2" fill="var(--background, #1a1a1a)" />
      
      {/* Key shaft - rectangle part */}
      <rect x="8" y="4" width="4" height="3" />
      
      {/* Key teeth - zigzag pattern */}
      <path 
        d="M12 4 L15 4 L15 5 L17 5 L17 4 L19 4 L21 5.5 L19 7 L17 7 L17 6 L15 6 L15 7 L12 7 Z"
      />
      
      {/* Password field bar */}
      <rect x="1" y="16" width="22" height="7" rx="0.5" />
      
      {/* Asterisks as star shapes */}
      <g fill="var(--background, #1a1a1a)">
        {/* Star 1 */}
        <path d="M4.5 19.5 L4.5 17.5 M3.3 18.2 L5.7 20.8 M5.7 18.2 L3.3 20.8" stroke="var(--background, #1a1a1a)" strokeWidth="0.8" strokeLinecap="round"/>
        {/* Star 2 */}
        <path d="M9 19.5 L9 17.5 M7.8 18.2 L10.2 20.8 M10.2 18.2 L7.8 20.8" stroke="var(--background, #1a1a1a)" strokeWidth="0.8" strokeLinecap="round"/>
        {/* Star 3 */}
        <path d="M13.5 19.5 L13.5 17.5 M12.3 18.2 L14.7 20.8 M14.7 18.2 L12.3 20.8" stroke="var(--background, #1a1a1a)" strokeWidth="0.8" strokeLinecap="round"/>
        {/* Star 4 */}
        <path d="M18 19.5 L18 17.5 M16.8 18.2 L19.2 20.8 M19.2 18.2 L16.8 20.8" stroke="var(--background, #1a1a1a)" strokeWidth="0.8" strokeLinecap="round"/>
      </g>
    </svg>
  );
};

// Export with both names for compatibility
const ShieldKeyIcon = CredentialKeyIcon;

export { CredentialKeyIcon, ShieldKeyIcon };
export default CredentialKeyIcon;
