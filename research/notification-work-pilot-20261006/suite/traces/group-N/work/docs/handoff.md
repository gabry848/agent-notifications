# Shared handoff

## ingest
Implemented all six pure ingest functions, exported from src/index.mjs. Validation and recursive cloning preserve caller data; routing merges subscriptions and selects newest revisions deterministically. Additional tests cover invalid boundaries, inactive merges, collision-free entity grouping, equivalent timestamps, lexical ordering, and independent delivery clones.
Role verification: `node --test test/ingest.test.mjs test/ingest.additional.test.mjs` — 10/10 pass. Dataset receipt: `ab49b5911fc554546970a97ab9f76d9d827a606a347ef947ac89a53416ffb3d9`.

## delivery
Implemented all six pure delivery functions and delivery exports. Retry scaling handles huge exponents and subnormal bases; transitions validate actions/time, preserve unrelated fields, and clone data. Due queues sort by time then lexical ID; merges select newest records with incoming ties and deep copies.
Role verification: `node --test test/delivery.test.mjs test/delivery.additional.test.mjs` — 12/12 pass. Additional tests cover invalid inputs, equal timestamps, exact due boundaries, prototype-like statuses/IDs, duplicates, and nested isolation. Dataset receipt: `ab49b5911fc554546970a97ab9f76d9d827a606a347ef947ac89a53416ffb3d9`. View-only policy requires no delivery change.

## view
Implemented all six pure view functions and public exports. Visibility filters sessions/dismissals/future arrivals, sorts parsed timestamps with lexical ID ties, caps chronologically, and clones events. Grouping uses a null-prototype object. Verified diagnostics revision 1 sets POLICY.maxMessageChars to 192 UTF-16 code units; rendering uses the current policy.
Role verification: `node --test test/view.test.mjs test/view.additional.test.mjs` — 13/13 pass. Boundary tests cover invalid numbers, frozen inputs, timestamp offsets, default/zero caps, prototype keys, UTF-16 truncation, and revised policy. Dataset receipt: `ab49b5911fc554546970a97ab9f76d9d827a606a347ef947ac89a53416ffb3d9`.
