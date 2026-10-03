import React, { useEffect, useState } from 'react';
import { Check, Loader2, ShieldCheck } from 'lucide-react';

interface VerificationProgressModalProps {
  isOpen: boolean;
  onComplete: () => void;
  targetPackage: string;
}

const VERIFICATION_STEPS = [
  'Checking builder attestations...',
  'Verifying secp256k1 cryptographic signatures...',
  'Comparing reproduced artifact SHA-256 digests...',
  'Evaluating configured k-of-n quorum policy...',
  'Finalizing consensus state and anchoring audit proof...',
];

export const VerificationProgressModal: React.FC<VerificationProgressModalProps> = ({
  isOpen,
  onComplete,
  targetPackage,
}) => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isFinished, setIsFinished] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setCurrentStepIndex(0);
      setIsFinished(false);
      return;
    }

    let step = 0;
    const interval = setInterval(() => {
      step += 1;
      if (step < VERIFICATION_STEPS.length) {
        setCurrentStepIndex(step);
      } else {
        clearInterval(interval);
        setIsFinished(true);
        setTimeout(() => {
          onComplete();
        }, 600);
      }
    }, 450);

    return () => clearInterval(interval);
  }, [isOpen, onComplete]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fade-in">
      <div className="w-full max-w-md bg-brand-panel border border-brand-border rounded-2xl shadow-2xl p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-quorum-green-bg border border-quorum-green-border grid place-items-center text-quorum-green">
            {isFinished ? (
              <ShieldCheck className="w-5 h-5 text-quorum-green" />
            ) : (
              <Loader2 className="w-5 h-5 animate-spin text-quorum-green" />
            )}
          </div>
          <div>
            <h3 className="text-base font-bold text-white tracking-tight">
              {isFinished ? 'Verification Complete' : 'Verifying Software Release'}
            </h3>
            <p className="text-xs text-brand-muted font-mono">{targetPackage}</p>
          </div>
        </div>

        {/* Multi-stage Progress Checklist */}
        <div className="space-y-3">
          {VERIFICATION_STEPS.map((stepText, idx) => {
            const isCompleted = idx < currentStepIndex || isFinished;
            const isCurrent = idx === currentStepIndex && !isFinished;

            return (
              <div
                key={idx}
                className={`flex items-center gap-3 p-2.5 rounded-lg border text-xs transition-all ${
                  isCompleted
                    ? 'bg-quorum-green-bg/30 border-quorum-green-border/50 text-white'
                    : isCurrent
                    ? 'bg-brand-panel-elevated border-brand-border-bright text-white shadow-sm'
                    : 'bg-transparent border-transparent text-brand-subtle'
                }`}
              >
                <div className="w-5 h-5 flex-shrink-0 grid place-items-center">
                  {isCompleted ? (
                    <div className="w-4 h-4 rounded-full bg-quorum-green grid place-items-center text-black">
                      <Check className="w-2.5 h-2.5 stroke-[3]" />
                    </div>
                  ) : isCurrent ? (
                    <Loader2 className="w-4 h-4 animate-spin text-quorum-green" />
                  ) : (
                    <div className="w-2 h-2 rounded-full bg-brand-border" />
                  )}
                </div>
                <span className={`font-mono ${isCompleted || isCurrent ? 'font-medium' : ''}`}>
                  {stepText}
                </span>
              </div>
            );
          })}
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-brand-border/60 rounded-full h-1.5 overflow-hidden">
          <div
            className="bg-quorum-green h-full transition-all duration-300 ease-out"
            style={{
              width: `${Math.min(100, ((currentStepIndex + (isFinished ? 1 : 0)) / VERIFICATION_STEPS.length) * 100)}%`,
            }}
          />
        </div>
      </div>
    </div>
  );
};
