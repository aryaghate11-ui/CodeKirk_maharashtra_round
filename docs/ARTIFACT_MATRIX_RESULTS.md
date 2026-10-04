# Artifact reproducibility evidence

Observed on 2026-10-04 with Go 1.27.1. Each package was cloned at its pinned
commit and built twice in separate temporary workspaces with separate Go build
and module caches.

| Package | Pinned commit | Build 1 SHA-256 | Build 2 SHA-256 | Result |
|---|---|---|---|---|
| hey | `e64ec7a3ad1ef8bc828fe61e1fb324cc2e74c604` | `fda27956e8fa631bd60e7e182a44899d7ffaaab5321ccb9604e3545fef20050c` | `fda27956e8fa631bd60e7e182a44899d7ffaaab5321ccb9604e3545fef20050c` | Match |
| fzf | `0012183ede3619e2bf52932c196377f8a7befbf6` | `5f363268be66637cea8c132422042e43def8dd37bfbb9a400fc805930830ed72` | `5f363268be66637cea8c132422042e43def8dd37bfbb9a400fc805930830ed72` | Match |
| micro | `04c577049ca898f097cd6a2dae69af0b4d4493e1` | `5c1f1c9f8d89ecb182dcc9b6b86a0c0cc6dd20e0476074d3d502dc3c98000948` | `5c1f1c9f8d89ecb182dcc9b6b86a0c0cc6dd20e0476074d3d502dc3c98000948` | Match |

These runs prove deterministic artifact integrity across clean workspaces on one
host. They do not by themselves prove independent operators; use the
release-specific challenge flow on separate machines for that claim.

## End-to-end quorum proof

The pinned `fzf` recipe was also run through all three separately keyed local
profiles. Release `5cf16200-52bd-4757-8f07-3208792443b3` reached `verified` with
three valid signatures, three matching hashes, three distinct declared operators,
candidate match, no conflict, and audit-chain head
`31275b72cb292641af748c4ebf4497dbb7ec03ee74930d9afc4204e4aba03f14`.

Its execution scope was `three-isolated-workspaces-on-one-host`; this is protocol
evidence and must not be represented as three independently controlled machines.
