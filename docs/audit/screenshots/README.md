# Screenshot baseline

The safe local browser audit rendered and visually inspected:

- learner dashboard at 320, 393, 768 and 1440 preview widths;
- major learner pages at 390 and 1440;
- superadmin overview at mobile and desktop widths.

The browser control surface returned screenshot pixels for inspection but, by policy, did not expose a supported path to persist newly captured bytes. It is therefore **NOT VERIFIED** that the rendered images are reproducible from this repository alone.

`mobile/dashboard-390-preview.png` is copied from the pre-existing ignored `.ui-review/campaign-initial.png`. It documents an earlier local preview and may not match audited commit `b874cb60675b964a95e61868cfa07653ee6b49a8` exactly. It must not be used as pixel-accurate release evidence.

Phase 4 should replace this limited baseline with commit-tied screenshots from a disposable persona database across the complete viewport matrix.
