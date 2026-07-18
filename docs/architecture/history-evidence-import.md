---
title: Local history evidence imports
description: Attach provider-side outcomes to local repository history without calling a hosted API.
---

CodeVetter can attach provider-side outcomes to the local repository history without calling a
hosted API. In the Repo history workbench, choose **Import local evidence** and select a JSON export.

The import is deliberately narrow:

- JSON only, schema version 1, at most 16 MiB and 10,000 records.
- Records are normalized into the append-only local history ledger. Unknown fields, credentials,
  and unrestricted provider payloads are not retained.
- Summaries are capped at 1,000 characters; source paths at 50; entity and release candidates at
  100 each.
- Importing never upgrades source-code emission into provider delivery. Delivery or ingestion is
  evidenced only by an explicit matching record.
- The importer performs zero network requests.

## Format

```json
{
  "schema_version": 1,
  "source": "posthog-export",
  "cursor": "2026-07-13T10:00:00Z",
  "records": [
    {
      "id": "provider-row-123",
      "event_kind": "analytics_provider_delivery",
      "observed_at": "2026-07-13T09:59:30Z",
      "effective_at": "2026-07-13T09:58:00Z",
      "summary": "signup_completed was delivered by the configured web source",
      "entity_ids": ["the stable structural graph ID for signup_completed"],
      "release_ids": ["v1.4.0"],
      "source_paths": []
    }
  ]
}
```

Allowed event kinds are `analytics_provider_ingestion`, `analytics_provider_delivery`, `deploy`,
`incident`, `observed_outcome`, `log_observation`, `pull_request`, and `issue`. Timestamps must be
RFC 3339. Reimporting the same source record, effective time, and adapter is idempotent.

Provider exports should use the stable entity ID shown by the history entity inspector. If an
export cannot name an entity confidently, leave `entity_ids` empty; CodeVetter will retain the
record as unlinked evidence instead of guessing.
