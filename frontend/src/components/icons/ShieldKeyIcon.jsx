import React from 'react';

/**
 * ShieldKey Icon - Custom icon for credentials/security
 * Shield with padlock and key - replaces lucide-react Key icon
 */
const ShieldKeyIcon = ({ className = '', size = 24, ...props }) => {
  const scale = size / 24;
  
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
      {/* Shield outline */}
      <path 
        d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 1.8l7 3.11v5.09c0 4.63-3.21 8.96-7 10.09-3.79-1.13-7-5.46-7-10.09V5.91l7-3.11z"
        fillRule="evenodd"
      />
      
      {/* Padlock */}
      <g transform="translate(6.5, 6)">
        {/* Padlock body */}
        <rect x="0.5" y="3.5" width="5" height="4" rx="0.5" />
        {/* Padlock shackle */}
        <path 
          d="M1.5 3.5V2.5a1.5 1.5 0 0 1 3 0v1" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="1.2"
        />
        {/* Keyhole */}
        <circle cx="3" cy="5" r="0.6" fill="var(--background, #1c1c1c)" />
        <rect x="2.7" y="5.3" width="0.6" height="1.2" fill="var(--background, #1c1c1c)" />
      </g>
      
      {/* Key */}
      <g transform="translate(13, 8)">
        {/* Key head (circle) */}
        <circle cx="3" cy="2" r="2.5" />
        <circle cx="3" cy="2" r="1" fill="var(--background, #1c1c1c)" />
        {/* Key shaft */}
        <rect x="0.5" y="3.5" width="1.5" height="6" rx="0.3" />
        {/* Key teeth */}
        <rect x="-0.8" y="7" width="1.3" height="0.8" rx="0.2" />
        <rect x="-0.5" y="8.5" width="1" height="0.8" rx="0.2" />
      </g>
    </svg>
  );
};

export { ShieldKeyIcon };
export default ShieldKeyIcon;
