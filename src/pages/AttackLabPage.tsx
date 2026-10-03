import React, { useState } from 'react';
import { Card, CardHeader, CardBody } from '../components/common/Card';

const scenarios = ['valid', 'modified-candidate', 'conflicting-output', 'invalid-signature', 'unknown-builder', 'wrong-commit', 'replay', 'modified-report'] as const;
type Result = {
  scenario: string; passed: boolean; evidence_mode: string;
  observed_rejections: { builder_id: string; status_code: number; reason: string }[];
  report_check: { valid: boolean; errors: string[] } | null;
  verification: { release_id: string; status: string; audit_chain_head: string;
    builders: { id: string; artifact_sha256: string; signature_valid: boolean }[] };
};

export const AttackLabPage: React.FC = () => {
  const [scenario, setScenario] = useState<string>('conflicting-output');
  const [mode, setMode] = useState('k-of-n');
  const [threshold, setThreshold] = useState(2);
  const [operators, setOperators] = useState(2);
  const [strict, setStrict] = useState(true);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = 'bg-brand-bg-deep border border-brand-border rounded p-2 text-white';
  const run = async () => {
    setBusy(true); setError(''); setResult(null);
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL || '/api/v1'}/attack-lab/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario, policy: { mode, threshold, expected_builders: 3, minimum_operators: operators, reject_on_conflict: strict } }),
      });
      if (!response.ok) throw new Error(`Backend rejected the request (${response.status}): ${await response.text()}`);
      const data = await response.json();
      if (!data.verification) throw new Error('Backend returned an unsupported response');
      setResult(data);
    } catch (e) { setError(e instanceof Error ? e.message : 'Backend unavailable'); }
    finally { setBusy(false); }
  };
  return <div className="space-y-6">
    <Card><CardHeader title="Security & Attack Lab" subtitle="Real backend checks · no mock fallback" />
      <CardBody><p className="text-sm text-brand-muted">These exercises use synthetic artifact bytes and demo keys, not a new source build. The backend runs real hashing, signatures, replay checks and quorum decisions.</p></CardBody>
    </Card>
    <Card><CardHeader title="Choose an attack and consumer policy" /><CardBody>
      <fieldset disabled={busy} className="space-y-4">
        <label className="block">Scenario <select className={input + ' ml-2'} value={scenario} onChange={e => { setScenario(e.target.value); setResult(null); }}>{scenarios.map(s => <option key={s}>{s}</option>)}</select></label>
        <div className="flex flex-wrap gap-4">
          <label>Policy <select className={input + ' ml-2'} value={mode} onChange={e => { setMode(e.target.value); setResult(null); }}><option>k-of-n</option><option>majority</option><option>all</option></select></label>
          <label>Required matches <input aria-label="Required matches" className={input + ' w-16 ml-2'} type="number" min={1} max={3} disabled={mode !== 'k-of-n'} value={threshold} onChange={e => { setThreshold(Number(e.target.value)); setResult(null); }} /></label>
          <label>Minimum operators <input className={input + ' w-16 ml-2'} type="number" min={1} max={3} value={operators} onChange={e => { setOperators(Number(e.target.value)); setResult(null); }} /></label>
        </div>
        <label className="block"><input type="checkbox" checked={strict} onChange={e => { setStrict(e.target.checked); setResult(null); }} /> Reject any builder conflict</label>
        <button className="rounded bg-quorum-green text-black px-4 py-2 font-semibold" onClick={run}>{busy ? 'Running backend checks…' : 'Run verification exercise'}</button>
      </fieldset>
      {error && <p role="alert" className="mt-4 text-red-400">{error} — No simulated result has been substituted.</p>}
    </CardBody></Card>
    {result && <Card><CardHeader title={`${result.scenario}: ${result.passed ? 'check passed' : 'unexpected outcome'}`} subtitle={`Release decision: ${result.verification.status}`} /><CardBody>
      <p className="text-sm text-brand-muted mb-4">An invalid submission can be rejected while two honest builders still satisfy a 2-of-3 policy.</p>
      <div className="overflow-auto"><table className="w-full text-sm"><thead><tr><th className="text-left">Accepted builder</th><th className="text-left">Artifact SHA-256</th><th>Signature</th></tr></thead><tbody>{result.verification.builders.map(b => <tr key={b.id}><td className="py-2 pr-4">{b.id}</td><td className="font-mono pr-4">{b.artifact_sha256}</td><td>{b.signature_valid ? 'valid' : 'invalid'}</td></tr>)}</tbody></table></div>
      {result.observed_rejections.map((r, i) => <p key={i} className="mt-3 text-amber-400">HTTP {r.status_code}: {r.reason} ({r.builder_id})</p>)}
      {result.report_check && <p className="mt-3">Modified report accepted: {String(result.report_check.valid)}. {result.report_check.errors.join('; ')}</p>}
      <p className="text-xs break-all mt-4">Release: {result.verification.release_id}<br />Audit head: {result.verification.audit_chain_head}</p>
      <a className="inline-block mt-4 underline" href={`${import.meta.env.VITE_API_URL || '/api/v1'}/releases/${result.verification.release_id}/audit-report`}>Download signed Evidence Passport</a>
    </CardBody></Card>}
  </div>;
};
