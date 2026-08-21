# e-Mate Share Worker

This Worker publishes the existing DSH Session ZIP; it does not create another
session snapshot, event store, or transcript renderer. Create and revoke calls
must carry the current short-lived Model Gateway session token. The Worker
forwards that token to the existing `/v1/consents/current` route, so the Model
Gateway remains the single JWT and active-session authority.

An owner/session R2 index lets Desktop read active links back after a restart
and revoke them. The index is paginated and bounded; every result is rechecked
against the archive's exact owner and session hashes before it is returned.

The `emate-session-shares` R2 bucket is dedicated user-data storage. Never bind
the `emate-desktop-downloads` release bucket here.

One-time production activation:

```sh
pnpm dlx wrangler@4.124.0 r2 bucket create emate-session-shares
pnpm dlx wrangler@4.124.0 r2 bucket lifecycle add emate-session-shares expire-session-shares --expire-days 7 --abort-multipart-days 1 --force
pnpm dlx wrangler@4.124.0 deploy --config enterprise/apps/share-worker/wrangler.jsonc
```

After deployment, `GET https://emate-share.emate-zyfjacksonchen.workers.dev/healthz`
must return `{"schema_version":1,"ready":true}` before Desktop activation.
