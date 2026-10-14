# Deploying to Hugging Face, with PostgreSQL

The app runs on Hugging Face as a **Docker Space**. The Space builds the repo's `Dockerfile` (one container: the API also serves the web app).

**Hugging Face does not host databases.** The Space connects to a hosted PostgreSQL over the internet, so your data lives outside the Space and survives every restart and redeploy. This guide uses **Neon** (free tier). Supabase works the same way.

```
browser ──▶ Hugging Face Space (Docker: API + web app) ──SSL──▶ Neon PostgreSQL
                       │
                       └──▶ Gemini / Claude API (the AI assistant)
```

Total time: about 15 minutes. Steps 1–2 are the database; steps 3–5 are Hugging Face.

---

## Step 1 – Create the PostgreSQL database (Neon, free)

1. Go to **https://neon.tech** and sign up (GitHub or Google login is fine).
2. **Create a project:**
   - name `gold-loan-portal`;
   - PostgreSQL version 16 or newer;
   - the region closest to your users, for example *AWS Asia Pacific (Singapore)* for India.
3. On the project dashboard click **Connect** and copy the **connection string**. It looks like:
   ```
   postgresql://neondb_owner:AbC123…@ep-cool-name-123456.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```
   It contains the password, so treat it like one: don't paste it into chats, issues or commits.

## Step 2 – Put it in `.env.hf` and test the connection from your computer

1. Copy the template:
   ```bash
   cp .env.hf.example .env.hf        # Windows PowerShell: Copy-Item .env.hf.example .env.hf
   ```
   `.env.hf` is git-ignored; it never goes to GitHub.
2. In `.env.hf`, paste the Neon string after `DATABASE_URL=`, and your Gemini key after `LLM_API_KEY=`.
3. Test the connection **before** deploying:
   ```bash
   npm run db:check:hf
   ```
   You should see `✓ Connected: neondb – PostgreSQL 16…`. "No app tables yet" is expected: the app creates its tables (and the two loan plans) itself on its first start.

If it fails, copy the connection string again from Neon and check that it ends with `?sslmode=require`. A string with an extra `&channel_binding=require` is fine.

## Step 3 – Hugging Face account and token

1. Sign up at **https://huggingface.co**.
2. Go to **Settings → Access Tokens → Create new token**, choose type **Write**, and copy it.
3. Log in from the terminal, pasting the token when asked:
   ```bash
   pip install huggingface_hub      # once
   hf auth login
   ```

## Step 4 – Deploy

```bash
git add -A && git commit -m "…"   # only committed code is deployed
npm run deploy:hf                 # Mac/Linux: python3 scripts/deploy_hf.py
```

The script:
1. creates the Space `<your-username>/gold-loan-portal` (Docker) if it doesn't exist;
2. stores `DATABASE_URL` and `LLM_API_KEY` as **encrypted Space secrets**, and `LLM_BASE_URL` / `LLM_MODEL` as variables;
3. uploads the committed code (never a `.env` file), with the header Hugging Face needs (`sdk: docker`, `app_port: 4000`).

Run `npm run deploy:hf -- --dry-run` first to see what would happen without uploading anything.

## Step 5 – Check it

1. Open `https://huggingface.co/spaces/<your-username>/gold-loan-portal`. The **Logs** tab shows the build (about 3–5 minutes the first time) and then:
   ```
   applied 001_init.sql
   applied 002_lead_plan_terms.sql
   Gold Loan Portal API listening on http://localhost:4000
   ```
2. Open `https://<your-username>-gold-loan-portal.hf.space/api/v1/health`. It should say `"storage":"postgres"`.
3. File an application, then look in Neon's **Tables** view: the row is in `leads`.

To change a secret later, use the Space's **Settings → Variables and secrets** page, or edit `.env.hf` and run `npm run deploy:hf` again.

---

## Updating the app

Commit your changes and run `npm run deploy:hf` again. Hugging Face rebuilds the image. **The data stays**, because it lives in Neon, and on start the app only applies migrations it hasn't applied yet.

## Good to know

- **Free Spaces sleep** after 48 hours without visitors. The next visit wakes them, which takes about a minute.
- **Neon's free tier** pauses the database when idle. The first query after a pause takes a second or two; the app allows 10 s.
- **Rate limits** use the visitor's real IP: inside a Space the app trusts Hugging Face's proxy header (`X-Forwarded-For`).
- **Framing:** Hugging Face shows the app inside an iframe on huggingface.co. The app allows that only when it detects it is running in a Space (`SPACE_ID`).
- **The admin panel has no login** (the assignment doesn't ask for one). On a public Space anyone can open it. Mobile numbers are masked, but consider a **private** Space (`npm run deploy:hf -- --private`) or adding authentication before sharing widely.
- **PostgreSQL inside the Space** instead of Neon is possible, but it needs Hugging Face's paid persistent storage; without it the database would be wiped on every restart. That isn't set up here.

**What has been tested:**
- the deploy script's packaging and its login check;
- `npm run db:check:hf` against PostgreSQL 16;
- the app on PostgreSQL in Docker.

**Not yet tested:** a real Neon database and a real Space. That needs your accounts.
