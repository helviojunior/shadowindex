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
      {/* Key head (oval) */}
      <ellipse cx="5.5" cy="6" rx="4.5" ry="5" />
      
      {/* Key hole */}
      <ellipse cx="5.5" cy="6" rx="1.2" ry="1.4" fill="var(--background, #1c1c1c)" />
      
      {/* Key shaft with zigzag teeth */}
      <path 
        d="M9.5 5h4l2 2.5-2 2.5h2l2-2.5 1.5 1.5v1l-1.5 1.5-2-2.5h-2l2 2.5-2 2.5h-4v-3z"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
        strokeLinejoin="round"
      />
      
      {/* Alternative simpler key shaft */}
      <path 
        d="M9 5.5h6l1.5 1.5-1.5 1.5 1.5 1.5-1.5 1.5h2l1-1v-1l1 1v1l-1 1h-9v-6z"
        fill="currentColor"
        style={{ display: 'none' }}
      />
      
      {/* Simplified key shaft */}
      <rect x="9" y="4.5" width="5" height="3" rx="0.3" />
      <polygon points="14,5 18,5 20,6 18,7 16,7 18,8 20,9 18,10 14,10 14,7.5" />
      
      {/* Password field (rectangle with asterisks) */}
      <rect x="2" y="16" width="20" height="6" rx="0.5" />
      
      {/* Asterisks - using 6-point stars */}
      <g fill="var(--background, #1c1c1c)">
        {/* Asterisk 1 */}
        <text x="4.5" y="21" fontSize="5" textAnchor="middle" fontFamily="sans-serif" fontWeight="bold">*</text>
        {/* Asterisk 2 */}
        <text x="9" y="21" fontSize="5" textAnchor="middle" fontFamily="sans-serif" fontWeight="bold">*</text>
        {/* Asterisk 3 */}
        <text x="13.5" y="21" fontSize="5" textAnchor="middle" fontFamily="sans-serif" fontWeight="bold">*</text>
        {/* Asterisk 4 */}
        <text x="18" y="21" fontSize="5" textAnchor="middle" fontFamily="sans-serif" fontWeight="bold">*</text>
      </g>
    </svg>
  );
};

export { CredentialKeyIcon };
export default CredentialKeyIcon;
