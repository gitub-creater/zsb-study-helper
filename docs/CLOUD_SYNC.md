# Cloud Account and Sync Setup

This project uses Supabase PostgreSQL for account records, login sessions, and one encrypted-in-transit learning-state snapshot per user. Vercel API routes are the only code that receives the Supabase service-role key. It must never be added to client-side variables or committed to Git.

## One-time setup

1. Create a Supabase project and open its SQL Editor.
2. Run [`supabase/schema.sql`](../supabase/schema.sql) in full.
3. In Vercel project Settings > Environment Variables, create the following values for Production, Preview, and Development:

   | Name | Source |
   | --- | --- |
   | `SUPABASE_URL` | Supabase Settings > API > Project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase Settings > API > `service_role` key |
   | `CORS_ORIGINS` | Comma-separated deployed URL and `http://localhost:5173` |
   | `VITE_CLOUD_API_URL` | Primary HTTPS cloud API URL, used by the local desktop build |
   | `VITE_CLOUD_API_URLS` | Optional comma/semicolon-separated fallback API URLs; put a mainland-reachable,备案 domain first when available |
   | `VITE_SUPABASE_URL` | Public Supabase project URL used by Realtime in the client |
   | `VITE_SUPABASE_ANON_KEY` | Public Supabase publishable/anon key; never use the service-role key |
   | `VITE_RTC_WS_URL` | Optional HTTPS/WSS RTC relay URL |

4. Redeploy the Vercel project after saving the variables. GitHub-connected deployments use `npm run build`, which validates both the Vite client and Vercel API routes.

## User migration

- A new user registers once and is signed in with the same account/password on web, phone, and desktop.
- A pre-existing local account is migrated automatically on the next password login when the cloud endpoint is available.
- A pre-existing account that is already signed in can use `Personal Profile > Enable cloud sync`, enter the cloud API URL and its current password, and the local learning history will be uploaded once.
- If registration happens while the mainland network cannot reach the API, the app keeps only a salted local password hash and a pending-registration marker. Enter the same account and password again after the network recovers; the same stable account ID is retried safely. Plaintext passwords are never queued.
- On a fresh device, the local desktop app asks for the cloud API URL on its first login and remembers it. The deployed web and phone app use the configured cloud API candidates; GitHub Pages is static and cannot serve `/api` routes.
- `VITE_CLOUD_API_URLS` enables short-timeout fallback across multiple HTTPS API domains. This improves ordinary DNS, carrier, and single-domain failures, but cannot guarantee access if a carrier blocks every configured provider. A true “all mainland networks” guarantee requires a tested mainland-hosted,备案 API domain.

## Operational notes

- Sessions are random opaque tokens stored as SHA-256 hashes in the database and expire after 30 days.
- Passwords are hashed on Vercel with a per-user scrypt salt. Plaintext passwords are not stored.
- During an outage, local learning remains available. A failed download is never treated as an empty cloud account, so it cannot overwrite an existing remote snapshot. Pending uploads retry after a short backoff, when the browser reports `online`, and when the app regains focus; the profile page shows the actual sync state.
- The current SMS password-recovery screen remains a local simulation. Production cloud recovery requires a real SMS or email provider and should not rely on the simulated code.
