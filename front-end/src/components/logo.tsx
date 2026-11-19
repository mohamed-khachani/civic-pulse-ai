import { cn } from "@/lib/utils";
export function Logo({
  className = "",
  wordmark = true,
}: {
  className?: string;
  wordmark?: boolean;
}) {
  return (
    <span className={cn("logo", className)}>
      <svg
        width="30"
        height="30"
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden="true"
      >
        <rect width="32" height="32" rx="9" fill="#16803C" />
        <path
          d="M8 23 16 7l8 16-8-4-8 4Z"
          stroke="white"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
        <path d="M16 7v12" stroke="white" strokeWidth="1.7" />
      </svg>
      {wordmark && (
        <span>
          atlas<span className="logo-period">.</span>
        </span>
      )}
    </span>
  );
}
