# Deploying copitch (manual, one EC2)

There is no CI/CD. Deploys are manual: push to `master`, then pull and rebuild on the server.

| | |
|---|---|
| Live URL | https://32-188-91-207.sslip.io |
| Server | EC2 `i-060b8a8d6377a2fcb`, m7i.xlarge (4 vCPU, 16 GB), us-west-2, Elastic IP `32.188.91.207` |
| App folder | `/srv/copitch/app` (a clone of `master`) |
| Data | `/srv/copitch/data/sessions.sqlite` (kept across deploys) |
| Secrets | `/srv/copitch/app/.env` on the server only (`OPENAI_API_KEY`, `VOICE_WORKER_TOKEN`, `PUBLIC_HOST`, `SESSION_DATA_DIR`). Never in git. |
| SSH | `ssh -i ~/.ssh/copitch-demo ubuntu@32.188.91.207` |

The AWS account is a Workshop Studio event account: CloudShell and EC2 Instance Connect are blocked, so SSH with the key above is the only way in. It may be deleted after the event.

## Deploy a change (about 2–5 minutes, about 30 s of downtime)

Tell anyone using the site first. A rebuild restarts the API and cuts live voice sessions and running jobs. Saved work resumes from its checkpoints.

1. **Local checks** (repo root):
   ```sh
   bun run typecheck && bun run lint && bun test --cwd backend && bun test --cwd frontend lib
   (cd voice && .venv/bin/python -m unittest test_server)
   ```
2. **Push to master:**
   ```sh
   git push origin HEAD:master
   ```
3. **Pull and rebuild on the server:**
   ```sh
   ssh -i ~/.ssh/copitch-demo ubuntu@32.188.91.207 \
     'cd /srv/copitch/app && sudo git pull --ff-only && sudo docker compose -f docker-compose.yml -f deploy/compose.aws.yml up -d --build'
   ```
4. **Verify:**
   ```sh
   curl -fsS https://32-188-91-207.sslip.io/api/ready      # {"status":"ready"}
   ssh -i ~/.ssh/copitch-demo ubuntu@32.188.91.207 \
     'cd /srv/copitch/app && sudo git log --oneline -1 && sudo docker compose -f docker-compose.yml -f deploy/compose.aws.yml ps'
   ```
   All four containers (`api`, `web`, `voice`, `gateway`) should be `Up`, and `api` should be `(healthy)`. Then open the site and run one quick flow.

## Logs

Container logs go to the persistent system journal and survive restarts and redeploys.

```sh
ssh -i ~/.ssh/copitch-demo ubuntu@32.188.91.207 'sudo journalctl CONTAINER_NAME=app-api-1 -f'          # live API log
ssh -i ~/.ssh/copitch-demo ubuntu@32.188.91.207 'sudo journalctl CONTAINER_NAME=app-api-1 --since "-1h" -o cat | grep level\":\"error'
```

Other containers: `app-web-1`, `app-voice-1`, `app-gateway-1`.

## Roll back

```sh
ssh -i ~/.ssh/copitch-demo ubuntu@32.188.91.207 \
  'cd /srv/copitch/app && sudo git log --oneline -5 && sudo git checkout <good-commit> && sudo docker compose -f docker-compose.yml -f deploy/compose.aws.yml up -d --build'
```

Return to the latest version later with `sudo git checkout master && sudo git pull`.

## Change the OpenAI key

From the repo root, with the new key in your local `.env`:

```sh
bash deploy/set-openai-key.sh
```

It sends the key over SSH without printing it, rewrites the server `.env` (with a new voice token) and restarts the stack.

## Stop and start (save money)

Use the EC2 console: Instances → `copitch-demo` → Instance state → **Stop**, or **Start**. The disk, data and Elastic IP are kept, so the URL doesn't change. A running instance costs about $0.20/h. A stopped one still bills for the disk and the IP, a few dollars a month.

## Back up the data

```sh
ssh -i ~/.ssh/copitch-demo ubuntu@32.188.91.207 'sudo sqlite3 /srv/copitch/data/sessions.sqlite ".backup /tmp/s.sqlite" && sudo chmod 644 /tmp/s.sqlite'
scp -i ~/.ssh/copitch-demo ubuntu@32.188.91.207:/tmp/s.sqlite ./copitch-backup-$(date +%F).sqlite
```

## New server from scratch

Launch Ubuntu 24.04, m7i.xlarge, 50 GB gp3, key pair `copitch-demo`, ports 22/80/443 open and metadata hop limit 1. Use this user data:

```sh
#!/bin/bash
curl -fsSL https://raw.githubusercontent.com/JyothiKumar03/copitch/master/deploy/ec2-user-data.sh | bash
```

Attach the Elastic IP. Wait until `ls /srv/copitch` shows `BUILD_OK` (about 15 minutes), then run `bash deploy/set-openai-key.sh <ip>` from your laptop. To keep logs across restarts, also set Docker's log driver to journald (`/etc/docker/daemon.json`), as on the current host. The full background is in `docs/aws-deploy-runbook.md`.
