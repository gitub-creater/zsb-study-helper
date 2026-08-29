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
   | `VITE_CLOUD_API_URL` | Stable production Vercel URL, used by the local desktop build |

4. Redeploy the Vercel project after saving the variables. GitHub-connected deployments use `npm run build`, which validates both the Vite client and Vercel API routes.

## User migration

- A new user registers once and is signed in with the same account/password on web, phone, and desktop.
- A pre-existing local account is migrated automatically on the next password login when the cloud endpoint is available.
- A pre-existing account that is already signed in can use `Personal Profile > Enable cloud sync`, enter the Vercel URL and its current password, and the local learning history will be uploaded once.
- On a fresh device, the local desktop app asks for the Vercel URL on its first login and remembers it. The deployed web and phone app use their own origin automatically.

## Operational notes

- Sessions are random opaque tokens stored as SHA-256 hashes in the database and expire after 30 days.
- Passwords are hashed on Vercel with a per-user scrypt salt. Plaintext passwords are not stored.
- During an outage, local learning remains available. The next local state change retries the cloud upload after the connection is restored.
- The current SMS password-recovery screen remains a local simulation. Production cloud recovery requires a real SMS or email provider and should not rely on the simulated code.
