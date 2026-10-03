import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { copyToClipboard, cn } from '../../lib/utils';

interface CopyButtonProps {
  text: string;
  className?: string;
  label?: string;
  title?: string;
}

export const CopyButton: React.FC<CopyButtonProps> = ({
  text,
  className,
  label,
  title = 'Copy to clipboard',
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const success = await copyToClipboard(text);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? 'Copied!' : title}
      className={cn(
        'inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-xs transition-colors',
        'text-brand-muted hover:text-brand-text hover:bg-brand-panel-elevated/70 border border-transparent hover:border-brand-border',
        copied && 'text-quorum-green hover:text-quorum-green border-quorum-green-border/50 bg-quorum-green-bg/40',
        className
      )}
      aria-label={label || title}
    >
      {copied ? (
        <>
          <Check className="w-3.5 h-3.5 text-quorum-green" />
          {label && <span className="text-quorum-green text-[11px]">Copied</span>}
        </>
      ) : (
        <>
          <Copy className="w-3.5 h-3.5 opacity-70 group-hover:opacity-100" />
          {label && <span className="text-[11px]">{label}</span>}
        </>
      )}
    </button>
  );
};
