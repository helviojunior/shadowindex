import React from 'react';

/**
 * CredentialKeyIcon - Custom icon for credentials/passwords
 * Key with zigzag teeth (outline style) + password field with asterisks
 */
const CredentialKeyIcon = ({ className = '', size = 24, ...props }) => {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      width={size}
      height={size}
      className={className}
      {...props}
    >
      <defs>
        {/* Clip to prevent lines inside the key head */}
        <clipPath id="cutHead">
          <rect width="512" height="512"/>
          <circle cx="120" cy="170" r="95"/>
        </clipPath>
      </defs>

      {/* KEY HEAD */}
      <circle cx="120" cy="170" r="85" fill="currentColor"/>
      <circle cx="95" cy="170" r="18" fill="var(--background, #1a1a1a)"/>

      {/* KEY BODY (outline) */}
      <g 
        clipPath="url(#cutHead)"
        fill="none"
        stroke="currentColor"
        strokeWidth="18"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        {/* Body */}
        <path d="M200 140 H410 V200 H200 Z"/>

        {/* Teeth */}
        <path d="
          M410 140
          H470
          L500 170
          L470 200
          H445
          L430 185
          L410 200
          H390
          L370 180
          L350 200
          H320
          V180
          L350 140
          Z"
        />
      </g>

      {/* PASSWORD BOX */}
      <rect x="35" y="300" width="465" height="90" fill="currentColor"/>

      {/* ASTERISKS */}
      <g stroke="var(--background, #1a1a1a)" strokeWidth="8" strokeLinecap="round">
        <g transform="translate(110,345)">
          <line x1="-14" y1="0" x2="14" y2="0"/>
          <line x1="0" y1="-14" x2="0" y2="14"/>
          <line x1="-10" y1="-10" x2="10" y2="10"/>
          <line x1="-10" y1="10" x2="10" y2="-10"/>
        </g>

        <g transform="translate(185,345)">
          <line x1="-14" y1="0" x2="14" y2="0"/>
          <line x1="0" y1="-14" x2="0" y2="14"/>
          <line x1="-10" y1="-10" x2="10" y2="10"/>
          <line x1="-10" y1="10" x2="10" y2="-10"/>
        </g>

        <g transform="translate(260,345)">
          <line x1="-14" y1="0" x2="14" y2="0"/>
          <line x1="0" y1="-14" x2="0" y2="14"/>
          <line x1="-10" y1="-10" x2="10" y2="10"/>
          <line x1="-10" y1="10" x2="10" y2="-10"/>
        </g>

        <g transform="translate(335,345)">
          <line x1="-14" y1="0" x2="14" y2="0"/>
          <line x1="0" y1="-14" x2="0" y2="14"/>
          <line x1="-10" y1="-10" x2="10" y2="10"/>
          <line x1="-10" y1="10" x2="10" y2="-10"/>
        </g>

        <g transform="translate(410,345)">
          <line x1="-14" y1="0" x2="14" y2="0"/>
          <line x1="0" y1="-14" x2="0" y2="14"/>
          <line x1="-10" y1="-10" x2="10" y2="10"/>
          <line x1="-10" y1="10" x2="10" y2="-10"/>
        </g>
      </g>
    </svg>
  );
};

// Export with both names for compatibility
const ShieldKeyIcon = CredentialKeyIcon;

export { CredentialKeyIcon, ShieldKeyIcon };
export default CredentialKeyIcon;
