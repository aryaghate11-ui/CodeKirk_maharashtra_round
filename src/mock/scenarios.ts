import { ScenarioDefinition, VerificationResult } from '../types';
import { MOCK_BUILDERS, MOCK_RELEASES, DEFAULT_POLICY, STRICT_POLICY } from './data';

export const HASH_CANONICAL = '91ac82e8f192b0c441a980753d08154e1933ba20ef41680199d74e0d9b431718';
export const HASH_DIVERGENT = '43ff7299a80192e448b209d1715019a3b610c492817452d00194857bba108f91';
export const HASH_MALICIOUS = 'badc0de91823746a819203918247012938471029384710293847102938471029';

export const SCENARIO_DEFINITIONS: Record<string, ScenarioDefinition> = {
  valid: {
    id: 'valid',
    name: 'Valid Release — Full Builder Consensus',
    badge: 'Consensus 3/3',
    subtitle: 'All independent builders independently reproduce identical artifact hashes.',
    description: 'All 3 independent builders (running disparate environments: Docker, Podman, and MicroVM) rebuild from the pinned Git commit and yield identical bit-for-bit SHA-256 digests. Cryptographic signatures verify on-chain.',
    threatModel: 'Guarantees the vendor published binary exactly matches the auditable public source code without backdoors.',
    builderHashes: {
      builder01: HASH_CANONICAL,
      builder02: HASH_CANONICAL,
      builder03: HASH_CANONICAL,
    },
    signatureValidity: {
      builder01: true,
      builder02: true,
      builder03: true,
    },
    expectedDecision2of3: 'ACCEPTED',
    expectedDecision3of3: 'ACCEPTED',
    auditHashMatch: true,
    explanation: '3 of 3 independent builders produced the exact same artifact hash (sha256: 91ac82...). The configured 2-of-3 quorum policy is satisfied with zero conflicts detected.',
  },
  conflict: {
    id: 'conflict',
    name: 'Inconsistent Artifact — Builder Divergence',
    badge: 'Conflict 2/3',
    subtitle: 'One builder diverges due to environmental variance, non-determinism, or local compromise.',
    description: 'Builder 01 and Builder 02 reach consensus on HASH A. Builder 03 produces HASH B. Quorum detects the disagreement and isolates the conflicting builder.',
    threatModel: 'Defends against non-reproducible build timestamps or single-builder infrastructure compromise.',
    builderHashes: {
      builder01: HASH_CANONICAL,
      builder02: HASH_CANONICAL,
      builder03: HASH_DIVERGENT,
    },
    signatureValidity: {
      builder01: true,
      builder02: true,
      builder03: true,
    },
    expectedDecision2of3: 'ACCEPTED',
    expectedDecision3of3: 'REJECTED',
    auditHashMatch: true,
    explanation: '2 of 3 independent builders produced the same artifact hash (sha256: 91ac82...). The configured 2-of-3 policy was satisfied. One builder (Local Witness) produced a conflicting artifact hash (sha256: 43ff72...).',
  },
  tampered: {
    id: 'tampered',
    name: 'Vendor Binary Tampering — SolarWinds / Codecov Vector',
    badge: 'Artifact Rejected',
    subtitle: 'The upstream release asset was swapped or injected after source compilation.',
    description: 'All 3 independent builders faithfully reproduce the source code into clean binary (HASH A). However, the download binary hosted on GitHub Releases has hash HASH_MALICIOUS. Quorum rejects the release immediately.',
    threatModel: 'Prevents supply-chain attacks where release credentials, S3 buckets, or GitHub releases are hijacked.',
    builderHashes: {
      builder01: HASH_CANONICAL,
      builder02: HASH_CANONICAL,
      builder03: HASH_CANONICAL,
    },
    signatureValidity: {
      builder01: true,
      builder02: true,
      builder03: true,
    },
    expectedDecision2of3: 'REJECTED',
    expectedDecision3of3: 'REJECTED',
    auditHashMatch: true,
    explanation: 'All 3 builders agree on the source compilation result (sha256: 91ac82...), but the vendor published binary hash (sha256: badc0d...) diverges. Zero trust policy rejects the binary.',
  },
  invalidSignature: {
    id: 'invalidSignature',
    name: 'Invalid Builder Signature — Rogue Node Injection',
    badge: 'Cryptographic Failure',
    subtitle: 'An unauthenticated node or forged attestation is detected during ECDSA verification.',
    description: 'Builder 03 attempts to submit an attestation with a malformed or forged secp256k1 cryptographic signature. The verification pipeline discards the attestation before quorum calculation.',
    threatModel: 'Protects against man-in-the-middle attestation spoofing and unauthorized build operators.',
    builderHashes: {
      builder01: HASH_CANONICAL,
      builder02: HASH_CANONICAL,
      builder03: HASH_CANONICAL,
    },
    signatureValidity: {
      builder01: true,
      builder02: true,
      builder03: false,
    },
    expectedDecision2of3: 'ACCEPTED', // 2 valid signatures remain
    expectedDecision3of3: 'REJECTED', // strictly requires 3 valid
    auditHashMatch: true,
    explanation: 'Attestation from Builder 03 rejected: Cryptographic signature verification failed (invalid secp256k1 signature). 2 valid attestations remain.',
  },
  auditTampering: {
    id: 'auditTampering',
    name: 'Audit Log Tampering — Historical Record Mutation',
    badge: 'Audit Failed',
    subtitle: 'Stored database record does not match the immutable cryptographic Merkle root.',
    description: 'A malicious database administrator or compromised API attempts to retroactively alter an audit record. Quorum recomputes the Merkle tree and detects an evidence hash divergence.',
    threatModel: 'Guarantees unalterable transparency and non-repudiation across public audit logs.',
    builderHashes: {
      builder01: HASH_CANONICAL,
      builder02: HASH_CANONICAL,
      builder03: HASH_CANONICAL,
    },
    signatureValidity: {
      builder01: true,
      builder02: true,
      builder03: true,
    },
    expectedDecision2of3: 'REJECTED',
    expectedDecision3of3: 'REJECTED',
    auditHashMatch: false,
    explanation: 'AUDIT INTEGRITY FAILED: Evidence hash stored in SQLite does not match on-chain smart contract Merkle root (0x8fd7c... vs 0x5a21e...). Audit log rejected as tampered.',
  },
};

export function getMockVerificationForScenario(
  scenarioId: string,
  policyType: '2-of-3' | '3-of-3' = '2-of-3',
  releaseId: string = 'rel-hey-01'
): VerificationResult {
  const scenario = SCENARIO_DEFINITIONS[scenarioId] || SCENARIO_DEFINITIONS.valid;
  const policy = policyType === '3-of-3' ? STRICT_POLICY : DEFAULT_POLICY;

  const matchedRelease = MOCK_RELEASES.find((r) => r.id === releaseId) || MOCK_RELEASES[0];

  const b1 = MOCK_BUILDERS[0];
  const b2 = MOCK_BUILDERS[1];
  const b3 = MOCK_BUILDERS[2];

  const now = Date.now();
  const attestations = [
    {
      id: 'att-01',
      releaseId: matchedRelease.id,
      builderId: b1.id,
      builderName: b1.name,
      builderAddress: b1.address,
      artifactHash: scenario.builderHashes.builder01,
      signature: '0x9482f01928374a019283740192837401928374019283740192837401928374017a123f819283471029384710293847102938471029384710293847102938471b',
      signatureValid: scenario.signatureValidity.builder01,
      timestamp: new Date(now - 18 * 1000).toISOString(),
      status: 'MATCH' as const,
      environment: b1.environment,
      buildDurationMs: 4230,
      logsAvailable: true,
    },
    {
      id: 'att-02',
      releaseId: matchedRelease.id,
      builderId: b2.id,
      builderName: b2.name,
      builderAddress: b2.address,
      artifactHash: scenario.builderHashes.builder02,
      signature: '0x51829034871029384710293847102938471029384710293847102938471029385b2910384710293847102938471029384710293847102938471029384710291c',
      signatureValid: scenario.signatureValidity.builder02,
      timestamp: new Date(now - 14 * 1000).toISOString(),
      status: 'MATCH' as const,
      environment: b2.environment,
      buildDurationMs: 3890,
      logsAvailable: true,
    },
    {
      id: 'att-03',
      releaseId: matchedRelease.id,
      builderId: b3.id,
      builderName: b3.name,
      builderAddress: b3.address,
      artifactHash: scenario.builderHashes.builder03,
      signature: scenario.signatureValidity.builder03
        ? '0x88371029384710293847102938471029384710293847102938471029384710294c192837401928374019283740192837401928374019283740192837401928371d'
        : '0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      signatureValid: scenario.signatureValidity.builder03,
      timestamp: new Date(now - 9 * 1000).toISOString(),
      status: !scenario.signatureValidity.builder03
        ? ('INVALID_SIG' as const)
        : scenario.builderHashes.builder03 !== HASH_CANONICAL
        ? ('CONFLICT' as const)
        : ('MATCH' as const),
      environment: b3.environment,
      buildDurationMs: 4610,
      logsAvailable: true,
    },
  ];

  // Agreement calculation based on valid signatures and hash matches
  const validAttestations = attestations.filter(a => a.signatureValid);
  const hashCounts: Record<string, number> = {};
  for (const a of validAttestations) {
    hashCounts[a.artifactHash] = (hashCounts[a.artifactHash] || 0) + 1;
  }

  let maxAgreement = 0;
  let consensusHash: string | null = null;
  for (const [hash, count] of Object.entries(hashCounts)) {
    if (count > maxAgreement) {
      maxAgreement = count;
      consensusHash = hash;
    }
  }

  const conflictDetected = scenario.id === 'conflict' || (validAttestations.length > 0 && Object.keys(hashCounts).length > 1);
  const conflictingBuilders = attestations
    .filter(a => a.artifactHash !== consensusHash || !a.signatureValid)
    .map(a => a.builderName);

  let decision = policyType === '3-of-3' ? scenario.expectedDecision3of3 : scenario.expectedDecision2of3;
  if (!scenario.auditHashMatch) {
    decision = 'REJECTED';
  }

  return {
    release: {
      ...matchedRelease,
      publishedArtifactHash: scenario.id === 'tampered' ? HASH_MALICIOUS : matchedRelease.publishedArtifactHash,
      agreement: maxAgreement,
      policy,
      status: decision,
    },
    builders: [b1, b2, b3],
    attestations,
    agreement: maxAgreement,
    totalBuilders: 3,
    consensusHash,
    conflictDetected,
    conflictingBuilders,
    policy,
    policySatisfied: maxAgreement >= policy.k && scenario.auditHashMatch,
    decision,
    explanation: scenario.explanation,
    signaturesValid: attestations.every(a => a.signatureValid),
    verifiedAt: new Date(now - 3 * 1000).toISOString(),
    auditChainHash: scenario.auditHashMatch ? '0x8fd7c2091823746a81920391824701293847102938471029384710293847e341' : '0xTAMPERED_RECORD_MERKLE_ROOT_MISMATCH_INVALID',
    transactionHash: '0x3a4b91726a80918234710293847102938471029384710293847102938471092a',
    blockNumber: 5829104,
  };
}
