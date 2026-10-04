import React from 'react';
import { AlertCircle, RefreshCw, Terminal, ShieldAlert } from 'lucide-react';

interface ApiErrorBannerProps {
  error: string | Error;
  endpoint?: string;
  onRetry?: () => void;
  className?: string;
}

export const ApiErrorBanner: React.FC<ApiErrorBannerProps> = ({
  error,
  endpoint,
  onRetry,
  className = '',
}) => {
  const errorMessage = typeof error === 'string' ? error : error.message;

  return (
    <div
      className={`p-5 rounded-xl bg-quorum-red-bg/75 backdrop-blur-md border border-quorum-red-border text-xs space-y-3 shadow-glow-red ${className}`}
      role="alert"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-quorum-red/20 text-quorum-red flex-shrink-0">
            <ShieldAlert className="w-5 h-5 text-quorum-red" />
          </div>
          <div>
            <h4 className="font-bold text-sm text-white tracking-tight">
              Backend Connection Failure (Strict Verification Mode)
            </h4>
            <span className="text-[11px] font-mono text-quorum-red-light">
              Mock fallback is disabled by default. Real verification data is required.
            </span>
          </div>
        </div>

        {onRetry && (
          <button
            onClick={onRetry}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-brand-panel-elevated/80 backdrop-blur-sm hover:bg-brand-panel/80 border border-brand-border transition-colors flex-shrink-0"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Retry</span>
          </button>
        )}
      </div>

      <p className="text-slate-300 leading-relaxed font-sans">
        The application received an error or could not reach the backend. In strict verification mode, Quorum refuses to silently substitute mock decisions for real cryptographic verification.
      </p>

      <div className="p-3 rounded-lg bg-black/40 backdrop-blur-sm border border-quorum-red-border/60 font-mono text-[11px] text-quorum-red-light space-y-1">
        <div className="flex items-center gap-1.5 text-slate-400">
          <Terminal className="w-3 h-3 text-brand-subtle" />
          <span>Error Details:</span>
        </div>
        <div className="text-slate-200 break-all">{errorMessage}</div>
        {endpoint && (
          <div className="text-slate-400 pt-0.5">Endpoint: <span className="text-white">{endpoint}</span></div>
        )}
      </div>
    </div>
  );
};
