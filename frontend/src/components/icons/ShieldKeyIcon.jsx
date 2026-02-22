import React from 'react';

/**
 * CredentialKeyIcon - Custom icon for credentials/passwords
 * Key with zigzag teeth + password field with asterisks
 */
const CredentialKeyIcon = ({ className = '', size = 24, ...props }) => {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
      {...props}
    >
      {/* KEY HEAD */}
      <circle cx="120" cy="170" r="85" />

      {/* KEY HOLE */}
      <circle cx="95" cy="170" r="18" fill="var(--background, #1a1a1a)" />

      {/* KEY SHAFT */}
      <rect x="200" y="150" width="210" height="40" />

      {/* KEY TEETH */}
      <polygon 
        points="
          410,150
          470,150
          500,180
          470,210
          445,210
          430,195
          410,210
          390,210
          370,190
          350,210
          320,210
          320,190
          350,150
        "
      />

      {/* PASSWORD BOX */}
      <rect x="35" y="300" width="465" height="90" />

      {/* ASTERISKS */}
      <g stroke="var(--background, #1a1a1a)" strokeWidth="8" strokeLinecap="round">
        <g transform="translate(150,345)">
          <line x1="-16" y1="0" x2="16" y2="0"/>
          <line x1="0" y1="-16" x2="0" y2="16"/>
          <line x1="-12" y1="-12" x2="12" y2="12"/>
          <line x1="-12" y1="12" x2="12" y2="-12"/>
        </g>

        <g transform="translate(230,345)">
          <line x1="-16" y1="0" x2="16" y2="0"/>
          <line x1="0" y1="-16" x2="0" y2="16"/>
          <line x1="-12" y1="-12" x2="12" y2="12"/>
          <line x1="-12" y1="12" x2="12" y2="-12"/>
        </g>

        <g transform="translate(310,345)">
          <line x1="-16" y1="0" x2="16" y2="0"/>
          <line x1="0" y1="-16" x2="0" y2="16"/>
          <line x1="-12" y1="-12" x2="12" y2="12"/>
          <line x1="-12" y1="12" x2="12" y2="-12"/>
        </g>

        <g transform="translate(390,345)">
          <line x1="-16" y1="0" x2="16" y2="0"/>
          <line x1="0" y1="-16" x2="0" y2="16"/>
          <line x1="-12" y1="-12" x2="12" y2="12"/>
          <line x1="-12" y1="12" x2="12" y2="-12"/>
        </g>
      </g>
    </svg>
  );
};

// Export with both names for compatibility
const ShieldKeyIcon = CredentialKeyIcon;

export { CredentialKeyIcon, ShieldKeyIcon };
export default CredentialKeyIcon;
