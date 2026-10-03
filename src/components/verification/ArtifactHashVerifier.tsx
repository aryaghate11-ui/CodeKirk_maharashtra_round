import React, { useRef, useState } from 'react';
import {
  CheckCircle2,
  FileCheck2,
  FileWarning,
  Loader2,
  RotateCcw,
  Upload,
} from 'lucide-react';
import { Card, CardBody, CardHeader } from '../common/Card';
import { CopyButton } from '../common/CopyButton';
import { api } from '../../services/api';
import { ConsumerArtifactVerification } from '../../types';
import { formatFileSize, sha256File } from '../../lib/artifactHash';
import { cn, truncateHash } from '../../lib/utils';

interface ArtifactHashVerifierProps {
  releaseId: string;
  consensusHash: string | null;
}

type VerificationStage = 'idle' | 'hashing' | 'verifying' | 'done' | 'error';

export const ArtifactHashVerifier: React.FC<ArtifactHashVerifierProps> = ({
  releaseId,
  consensusHash,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [localHash, setLocalHash] = useState('');
  const [stage, setStage] = useState<VerificationStage>('idle');
  const [result, setResult] = useState<ConsumerArtifactVerification | null>(null);
  const [error, setError] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  const reset = () => {
    setFile(null);
    setLocalHash('');
    setResult(null);
    setError('');
    setStage('idle');
    if (inputRef.current) inputRef.current.value = '';
  };

  const verifyFile = async (nextFile: File) => {
    setFile(nextFile);
    setResult(null);
    setError('');
    try {
      setStage('hashing');
      const sha256 = await sha256File(nextFile);
      setLocalHash(sha256);
      setStage('verifying');
      const verification = await api.verifyConsumerArtifact(
        releaseId,
        nextFile.name,
        sha256
      );
      setResult(verification);
      setStage('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Artifact verification failed.');
      setStage('error');
    }
  };

  const decisionTone = result?.decision === 'accepted'
    ? 'text-quorum-green border-quorum-green-border bg-quorum-green-bg/50'
    : result?.decision === 'pending' || result?.decision === 'conflict'
      ? 'text-quorum-amber border-quorum-amber-border bg-quorum-amber-bg/50'
      : 'text-quorum-red-light border-quorum-red-border bg-quorum-red-bg/50';

  return (
    <Card glow={result?.decision === 'accepted' ? 'green' : result ? 'red' : 'none'}>
      <CardHeader
        title="Verify a downloaded artifact"
        subtitle="The file stays on this device. Only its SHA-256 fingerprint is sent to Quorum."
        icon={<FileCheck2 className="w-4 h-4 text-quorum-green" />}
        badge={
          <span className="hidden sm:inline-flex text-xs font-mono px-2 py-0.5 rounded border border-brand-border text-brand-muted">
            LOCAL HASHING
          </span>
        }
      />
      <CardBody className="space-y-4">
        {!file ? (
          <div
            onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              const droppedFile = event.dataTransfer.files[0];
              if (droppedFile) void verifyFile(droppedFile);
            }}
            className={cn(
              'rounded-xl border border-dashed p-6 text-center transition-colors',
              isDragging
                ? 'border-quorum-green bg-quorum-green-bg/30'
                : 'border-brand-border-bright bg-brand-bg-deep/50'
            )}
          >
            <Upload className="w-6 h-6 mx-auto text-brand-muted" />
            <p className="mt-3 text-sm font-medium text-brand-text">
              Drop the downloaded release file here
            </p>
            <p className="mt-1 text-xs text-brand-muted">Maximum size: 100 MB</p>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="mt-4 px-4 py-2 rounded-lg bg-brand-panel-elevated border border-brand-border-bright text-sm font-semibold text-white hover:border-quorum-green/60 transition-colors"
            >
              Choose file
            </button>
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              aria-label="Choose a software artifact to verify"
              onChange={(event) => {
                const selected = event.target.files?.[0];
                if (selected) void verifyFile(selected);
              }}
            />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-brand-border bg-brand-bg-deep/60 p-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white truncate">{file.name}</p>
                <p className="text-xs text-brand-muted mt-1">{formatFileSize(file.size)}</p>
              </div>
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-brand-border text-xs font-semibold text-brand-muted hover:text-white hover:border-brand-border-bright transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Check another file
              </button>
            </div>

            {(stage === 'hashing' || stage === 'verifying') && (
              <div className="flex items-center gap-3 rounded-lg border border-brand-border bg-brand-panel-elevated/50 p-4">
                <Loader2 className="w-5 h-5 text-quorum-green animate-spin" />
                <div>
                  <p className="text-sm font-semibold text-white">
                    {stage === 'hashing' ? 'Calculating SHA-256 locally' : 'Checking builder consensus'}
                  </p>
                  <p className="text-xs text-brand-muted mt-0.5">
                    {stage === 'hashing' ? 'No file bytes leave your browser.' : 'The backend is applying the release policy.'}
                  </p>
                </div>
              </div>
            )}

            {localHash && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className="rounded-lg border border-brand-border bg-brand-bg-deep/60 p-3 min-w-0">
                  <span className="text-xs text-brand-muted">Selected file SHA-256</span>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <code className="text-xs text-white truncate" title={localHash}>
                      {truncateHash(localHash, 12, 10)}
                    </code>
                    <CopyButton text={localHash} title="Copy selected file hash" />
                  </div>
                </div>
                <div className="rounded-lg border border-brand-border bg-brand-bg-deep/60 p-3 min-w-0">
                  <span className="text-xs text-brand-muted">Builder consensus SHA-256</span>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <code className="text-xs text-white truncate" title={consensusHash || 'Pending'}>
                      {consensusHash ? truncateHash(consensusHash, 12, 10) : 'Pending'}
                    </code>
                    {consensusHash && <CopyButton text={consensusHash} title="Copy consensus hash" />}
                  </div>
                </div>
              </div>
            )}

            {result && (
              <div className={cn('rounded-lg border p-4 flex items-start gap-3', decisionTone)}>
                {result.decision === 'accepted'
                  ? <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  : <FileWarning className="w-5 h-5 flex-shrink-0 mt-0.5" />}
                <div>
                  <p className="text-sm font-bold uppercase tracking-wide">
                    Artifact {result.decision}
                  </p>
                  <p className="text-sm mt-1 text-brand-text">{result.reason}</p>
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-quorum-red-border bg-quorum-red-bg/50 p-4 text-sm text-quorum-red-light">
                {error}
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
};
