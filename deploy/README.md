# Raspberry Pi deployment — backend

Deploy first (owns Postgres + the shared network). Then do the frontend repo.
The image is built **on the Pi** (arm64-native) — there is no registry.

## One-time Pi setup

Assumes 64-bit Raspberry Pi OS (arm64) on a Pi 4/5.

```bash
# Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER        # re-login after this

# Tailscale — lets CI SSH in without port forwarding
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh                       # approve the node in the admin console
tailscale status                              # note this Pi's MagicDNS name

# Shared network for both compose projects
docker network create life-tasks

# Repos (siblings under ~)
git clone https://github.com/ysadilo/life-tasks-backend.git ~/life-tasks-backend
git clone https://github.com/ysadilo/life-tasks-frontend.git ~/life-tasks-frontend

# Backend env
cd ~/life-tasks-backend/deploy
cp .env.example .env && nano .env    # POSTGRES_PASSWORD, AUTH0_DOMAIN, AUTH0_AUDIENCE
```

Optional: add `GEMINI_API_KEY` to that `.env` (and `docker compose up -d` again) to turn on "Task from a photo";
without it `POST /api/tasks/from-photo` answers 503. The free Gemini tier lets Google use the photos to improve its
products, so use a paid key before real users send photos.

## Access — no port forwarding

The Pi has no public IP:

- **CI → Pi:** the deploy workflow joins the GitHub runner to your tailnet and
  SSHes to the Pi's MagicDNS name. Set `PI_HOST` to that name (e.g.
  `raspberrypi.tailXXXXXX.ts.net`).
- **Users → app:** a Cloudflare Tunnel serves `https://lifetasks.today` from the
  frontend container (configured in the frontend repo's `deploy/`). The backend
  itself is never exposed — reached only as `backend:3000` on the shared network.

### CI access — Tailscale OAuth

1. Admin console → **Access controls** → add the tag:
   ```jsonc
   "tagOwners": { "tag:ci": ["autogroup:admin"] }
   ```
2. Admin console → **Settings → OAuth clients**
   (<https://login.tailscale.com/admin/settings/oauth>) → **Generate OAuth
   client**, scope **Auth Keys → Write**, tag **`tag:ci`**. Copy the client id +
   secret (secret shown once).
3. Add repo secrets `TS_OAUTH_CLIENT_ID` / `TS_OAUTH_SECRET`.
4. `appleboy/ssh-action` needs a key, so also add `PI_SSH_KEY` — a normal SSH
   keypair whose public half is in the Pi's `~/.ssh/authorized_keys`.

## GitHub Actions secrets (this repo → Settings → Secrets → Actions)

| Secret               | Value                                                          |
| -------------------- | -------------------------------------------------------------- |
| `PI_HOST`            | Pi MagicDNS name (`raspberrypi.tailXXXXXX.ts.net`)             |
| `PI_USER`            | SSH user (`blcktqq`)                                           |
| `PI_SSH_KEY`         | private key whose public half is in the Pi's `authorized_keys` |
| `TS_OAUTH_CLIENT_ID` | Tailscale OAuth client id                                      |
| `TS_OAUTH_SECRET`    | Tailscale OAuth client secret                                  |

## Deploy

Push to `main` → the workflow joins the tailnet, SSHes to the Pi, and runs
`git pull && docker compose up -d --build` in `deploy/`. The image builds on the
Pi; migrations (`prisma migrate deploy`) run automatically on container start.

Manual run (also the first bring-up):

```bash
cd ~/life-tasks-backend/deploy && docker compose up -d --build
```

## Backups (do this yourself, not automated here)

```bash
docker compose exec postgres pg_dump -U life_tasks life_tasks > backup-$(date +%F).sql
```
