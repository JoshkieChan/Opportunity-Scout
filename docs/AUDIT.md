# Repository audit and hardening record

## Initial audit

The original repository had a Node/Playwright worker posting scraped products to a Python/FastAPI validator and forwarding selected listings to Discord. That separation was appropriate and retained.

Findings addressed:
- Token-prefix diagnostics in worker startup and a disposable token-test script.
- Different tier cutoffs in Node and Python, causing incorrect alert routing.
- Substring source detection allowing lookalike domains and query-string matches.
- Unconstrained product fields, bare exception handling, and inconsistent rejection response fields.
- Financial extraction assigning ambiguous values to monthly revenue/profit.
- Unbounded validator HTTP requests and incomplete browser cleanup/recovery.
- A stale package lock containing unused Puppeteer dependencies, unused Python dependencies, and mismatched browser/image versions.
- Python 3.9 image, no health check, secrets shared with the validator, and unused Compose volumes.
- An obsolete single-service app spec and a destructive VPS rescue script containing hard reset/prune operations.
- No automated tests, CI workflow, or README.

The debug screenshot, token checker, obsolete app spec, and destructive reset script were removed. Git history was not rewritten.

## Security

Credentials remain environment-only. Logs do not include tokens, prefixes, arbitrary upstream errors, or submitted URL values. Discord messages disable mentions. Environment files and development tools are ignored; per-service Docker ignore files protect build contexts.

The Node lockfile was regenerated and its transitive `ws` dependency updated after npm reported a high-severity advisory. Final npm and Python runtime dependency audits reported no known vulnerabilities.

The heuristic secret scanner checked 227 reachable historical text blobs plus current tracked/unignored files. One historical candidate in an old Kubernetes manifest consisted of placeholder strings; no real credentials were identified. This is a pattern-based check, not proof that every possible secret format is absent. GitHub secret scanning remains a useful independent control.

## Validation performed

| Check | Result |
| --- | --- |
| Python business rules and API | 49 passing tests |
| Node unit/failure-path tests | 13 passing tests |
| Real Chromium fixture extraction | 1 passing test |
| Node syntax / Ruff | Pass |
| Node → running FastAPI HTTP | Pass; A, B, C decisions asserted |
| Full worker fixture dry-run | Pass; two approvals, one rejection |
| npm runtime dependency audit | No known vulnerabilities |
| Python runtime dependency audit | No known vulnerabilities |
| Reachable-history/current-tree heuristic secret scan | No non-placeholder candidates |
| Docker Compose configuration | Pass using standalone Compose CLI |
| Docker images / container networking | Pass in GitHub Actions: both images build, validator becomes healthy, worker receives A/B/C decisions |
| Chromium in worker container | Pass in GitHub Actions |
| Live marketplace / real Discord / Hetzner | Optional; not exercised |

Windows sandbox restrictions initially stalled the FastAPI test client's loopback socket setup. The suite passed with local loopback access; no production workaround was introduced.

## Hosted Docker validation

The [GitHub Actions run for hardening commit fca00a7](https://github.com/JoshkieChan/Opportunity-Scout/actions/runs/37631912367) passed both the tests and Docker jobs. This closes the container validation gate despite the local machine lacking a Docker daemon. Live scraping, Discord delivery, and Hetzner deployment are optional and are not portfolio release blockers.
