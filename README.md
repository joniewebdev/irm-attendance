# IRM Attendance — Phase 3.1 Authentication

## Configure
1. Put these files in the root of your GitHub repository, preserving folders.
2. Edit `js/supabase-config.js` with the Supabase project URL and publishable/anon key. Never put a service-role key in frontend files.
3. Ensure `user_profiles.email` exists: `alter table public.user_profiles add column if not exists email text;`
4. Deploy Edge Functions with Supabase CLI:

```sh

```

The service-role key is a server-side Edge Function secret only. Do not commit it.

## First administrator
Create the first Auth account through the Supabase Dashboard. Add that person as a member, then provision the profile from SQL Editor with actual IDs:

```sql
insert into public.user_profiles(user_id,member_id,username,email,role,account_status,registered_at)
values('AUTH-USER-UUID','MEMBER-UUID','adminusername','admin@example.com','administrator','active',now());
```

Do this only as trusted initial setup. Do not enable public signup.

## Auth configuration
In Supabase Authentication → URL Configuration, set Site URL to your GitHub Pages URL and add it to Redirect URLs. Enable email/password auth and configure SMTP for production email delivery.

## Test
- Open dashboard.html while signed out: it must redirect to login.
- Active account can sign in; pending/disabled accounts cannot.
- Incorrect credentials return a generic message.
- Sign out returns to login.
- Password reset does not disclose whether a username exists.

## Scope
This is the authentication foundation and protected dashboard shell, not the finished application. A dedicated reset-password page and the administrative invitation/user-management Edge Functions are still required. Configure a specific CORS origin and rate limiting before production. The username Edge Function uses service-role credentials only server-side; it should be additionally rate-limited at the edge before public deployment.
