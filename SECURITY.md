# Security Policy

## Supported versions

mykb is pre-1.0. Only the latest tagged release on the `main` / release branch is supported. Older releases do not receive security backports — upgrade to the latest version.

| Version | Supported |
|---------|-----------|
| Latest release (≥ 0.2.x) | ✅ |
| Older pre-releases       | ❌ |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.** Public issues can expose users to risk before a fix is available.

Instead, report privately via either of the following:

- **GitHub Security Advisories** — preferred. Go to <https://github.com/vilosource/mykb/security/advisories/new> and submit a private report. This routes directly to the maintainers and gives us a coordinated disclosure workflow.
- **Email** — `lonvilo@pm.me` with the subject line `[mykb security]`.

Please include:

- A description of the issue and the impact you observed
- Steps to reproduce (a minimal proof-of-concept where possible)
- Affected version(s) — `kb --version`
- Your platform / Node.js version
- Whether you would like to be credited in the advisory after disclosure

## What to expect

- **Acknowledgement** within 5 business days.
- **Triage** (severity, scope, affected versions) within 10 business days.
- **Fix timeline** depending on severity. Critical issues are prioritized.
- **Coordinated disclosure** — we will work with you on a disclosure timeline. Default embargo is 90 days from initial report, sooner if a fix ships earlier.
- **Credit** — reporters are credited in the published advisory unless you ask otherwise.

## Scope

In scope:

- The `kb` CLI and `@vilosource/mykb` npm package
- The Pi extension shipped from `dist/extension/`
- Documented APIs, file-format invariants, and the storage layout

Out of scope:

- Vulnerabilities requiring the attacker to already have write access to `~/.mykb` on the host
- Issues in third-party dependencies (please report to those projects; we will pick up patched versions)
- Social-engineering of repository maintainers
- DoS by causing legitimate users to fill their own disk with knowledge entries

## Threat-model notes

mykb has a known **cooperative-LLM** trust boundary: the in-process tool-gating hook (`src/extension/hooks/tool-gating.ts`) blocks `write`/`edit` against knowledge files but cannot defend against an in-runtime `bash` redirection. This is tracked in [issue #1](https://github.com/vilosource/mykb/issues/1) and addressed architecturally by the v2 privileged-write-channel design (`docs/v2-privileged-write-channel-DESIGN.md`). For untrusted-LLM scenarios, run mykb inside a container with `~/.mykb` mounted read-only until v2 ships.

If you find a way to corrupt knowledge invariants (id uniqueness, schema, tombstone semantics, FTS sync) through the cooperative-LLM path that isn't already documented in `experiments/tool-gating/`, that's in scope — please report it.

## Acknowledgements

This policy will list reporters of accepted vulnerabilities here, with their consent, after coordinated disclosure.
