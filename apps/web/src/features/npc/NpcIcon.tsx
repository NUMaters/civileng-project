export function NpcIcon({ experienced = false }: { experienced?: boolean }) {
  return (
    <svg className="npc-icon" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <circle cx="24" cy="24" r="23" fill={experienced ? "#e4ad50" : "#78b7a5"} />
      <path d="M11 40v-5c0-7 6-11 13-11s13 4 13 11v5" fill="#203f43" />
      <circle cx="24" cy="19" r="8" fill="#f9dfbb" />
      {experienced ? (
        <path
          d="M14 18c0-7 4-11 10-11s10 4 10 11M12 18h24M24 6v9"
          stroke="#705426"
          strokeWidth="3"
          strokeLinecap="round"
        />
      ) : (
        <path d="M16 17c0-6 4-9 8-9s8 3 8 9c-4-1-7-3-9-5-1 3-4 4-7 5" fill="#49504b" />
      )}
      <path d="M21 35h6" stroke="#f9dfbb" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
