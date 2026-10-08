# Fixed initial CI delivery

Secondary publication-to-first-provider-exposure observations for the two preregistered initial jobs. Matched entries require identical tested bytes and terminal status in a complete correct pair. These observations do not measure current-failure reaction or overall task speed. Later agent-submitted jobs are not pooled with them.

| Pair | Initial job | Status | PA seconds | N seconds | PA stale at exposure | N stale at exposure |
|---|---|---|---:|---:|---|---|
| 7101 | legacy_smoke | passed | 129.6 | 23.0 | true | true |
| 7101 | legacy_integrity | failed | 89.6 | 5.1 | true | true |
| 7102 | legacy_smoke | passed | 114.8 | 5.7 | true | true |
| 7102 | legacy_integrity | failed | 74.8 | 3.4 | true | true |
| 7103 | legacy_smoke | passed | 132.9 | 20.3 | true | true |
| 7103 | legacy_integrity | failed | 92.9 | 10.9 | true | true |
| 7104 | legacy_smoke | passed | 162.9 | 29.8 | true | true |
| 7104 | legacy_integrity | failed | 122.9 | 1.7 | true | true |
| 7105 | legacy_smoke | passed | 121.1 | 1.9 | true | true |
| 7105 | legacy_integrity | failed | 81.1 | 6.1 | true | true |

Exact timestamps, hashes, eligibility and mode-specific exposure records are in [metrics.json](metrics.json). Unmatched or unexposed events are explicitly ineligible for delivery percentage calculations.
