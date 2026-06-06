// App wordmark for chrome headers: the brand mark (++ tile) plus the styled name.
// The mark's colors are fixed brand artwork (mirrors src-tauri/icons/icon.svg), deliberately
// not theme tokens — the dark tile is the logo on both themes. The name text follows the theme.
export function Wordmark() {
  return (
    <div className="flex items-center gap-2 text-sm font-semibold">
      <svg viewBox="0 0 1024 1024" className="h-5 w-5 shrink-0" aria-hidden="true">
        <defs>
          <linearGradient id="wm-bg" x1="512" y1="64" x2="512" y2="960" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#0F1218" />
            <stop offset="1" stopColor="#3E4655" />
          </linearGradient>
          <linearGradient id="wm-blue" x1="512" y1="362" x2="512" y2="662" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#4FA8F0" />
            <stop offset="1" stopColor="#2B82DB" />
          </linearGradient>
        </defs>
        <rect x="64" y="64" width="896" height="896" rx="200" fill="url(#wm-bg)" />
        <path
          fill="url(#wm-blue)"
          stroke="#FFFFFF"
          strokeWidth="24"
          strokeLinejoin="round"
          d="M282 390 a28 28 0 0 1 28 -28 h38 a28 28 0 0 1 28 28 v74 h74 a28 28 0 0 1 28 28 v40 a28 28 0 0 1 -28 28 h-74 v74 a28 28 0 0 1 -28 28 h-38 a28 28 0 0 1 -28 -28 v-74 h-74 a28 28 0 0 1 -28 -28 v-40 a28 28 0 0 1 28 -28 h74 z"
        />
        <path
          fill="url(#wm-blue)"
          stroke="#FFFFFF"
          strokeWidth="24"
          strokeLinejoin="round"
          d="M646 390 a28 28 0 0 1 28 -28 h38 a28 28 0 0 1 28 28 v74 h74 a28 28 0 0 1 28 28 v40 a28 28 0 0 1 -28 28 h-74 v74 a28 28 0 0 1 -28 28 h-38 a28 28 0 0 1 -28 -28 v-74 h-74 a28 28 0 0 1 -28 -28 v-40 a28 28 0 0 1 28 -28 h74 z"
        />
      </svg>
      <span>
        Tables<span className="text-primary">++</span>
      </span>
    </div>
  );
}
