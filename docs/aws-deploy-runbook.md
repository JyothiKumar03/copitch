# Deploy copitch on one large EC2 host (demo and pilot)

This runs the full product (web, API with Chromium, voice, HTTPS gateway) on **one large EC2 instance with Docker Compose**. The images are built **on the instance**, so it doesn't depend on Docker Desktop on a laptop or on ECR.

`docs/aws-operations.md` (ECS + CloudFormation + ECR) remains the hardened production path. This runbook is the fast, reliable path for the demo.

> Every step below creates billable AWS resources. The owner runs them, or approves each one.

## 0. Architecture

```
Browser ──HTTPS 443──► EC2 (Elastic IP, Ubuntu 24.04, m7i.2xlarge)
                        └─ docker compose
                           ├─ gateway  Caddy: automatic Let's Encrypt TLS, / → web, /api/* → api
                           ├─ web      Next.js standalone (serves /voice/presentation-capture.js same-origin)
                           ├─ api      Bun + Express + SQLite + workers + Chromium (capture, site agent, render check)
                           └─ voice    Python, signs OpenAI realtime sessions, transcription, speech
Browser ──WebRTC──► OpenAI Realtime (direct; the API only signs the session)
api/voice ──HTTPS──► OpenAI APIs
Admin: AWS Systems Manager Session Manager (no SSH port open)
Data: SQLite on the instance's gp3 volume + nightly backup to S3
```

**Instance size.** The commands use `m7i.2xlarge` as a demo starting point. Approve the size after estimating cost and checking expected browser concurrency in rehearsal.

Check the current regional rate before launch. Include volumes, snapshots and public IPv4 in the estimate. [AWS EC2 On-Demand pricing](https://aws.amazon.com/ec2/pricing/on-demand/)

**Region.** Use `ap-south-1` (Mumbai) for an India audience. Realtime audio goes from the browser to OpenAI directly, so the region mainly affects page and API latency.

## 1. Before you start (10 min)

1. **Code:** use the reviewed release ref or the source-only snapshot that passed local acceptance. Save its checksums with the release evidence. See §4 for both paths.
2. **AWS CLI:** use **AWS CloudShell** in the console (the CLI is preinstalled and already authenticated), or install AWS CLI v2 locally and run `aws configure`.
3. **Hostname**, either:
   - your domain (you'll add an A record to the Elastic IP), or
   - no domain: use `<elastic-ip-with-dashes>.sslip.io`, for example `13-234-10-20.sslip.io`. It resolves to that IP, and Caddy gets a real certificate for it.

   HTTPS is mandatory: browsers block the microphone on plain HTTP.

## 2. Network, role, secret (CloudShell, 10 min)

```sh
export AWS_REGION=ap-south-1
export NAME=copitch-demo

# Default VPC and one public subnet
VPC=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
SUBNET=$(aws ec2 describe-subnets --filters Name=vpc-id,Values=$VPC Name=default-for-az,Values=true --query 'Subnets[0].SubnetId' --output text)

# Security group: only 80 and 443 open to the world. No SSH.
SG=$(aws ec2 create-security-group --group-name $NAME-web --description "copitch web" --vpc-id $VPC --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id $SG --ip-permissions \
  IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges='[{CidrIp=0.0.0.0/0}]' \
  IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges='[{CidrIp=0.0.0.0/0}]'

# Application secret. Paste the real values in the console's Secrets Manager editor instead of the shell if you prefer.
aws secretsmanager create-secret --name $NAME/app --secret-string '{
  "OPENAI_API_KEY": "REPLACE",
  "OPENAI_TEXT_MODELS": "REPLACE_WITH_THE_SAME_JSON_AS_LOCAL_.env (include gpt-5.6-luna with purposes director, browse)",
  "VOICE_WORKER_TOKEN": "REPLACE_WITH_A_NEW_RANDOM_VALUE",
  "OPENAI_BASE_URL": ""
}'
SECRET_ARN=$(aws secretsmanager describe-secret --secret-id $NAME/app --query ARN --output text)

# Instance role: Session Manager + read this one secret + write backups
aws iam create-role --role-name $NAME-host --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
aws iam attach-role-policy --role-name $NAME-host --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
BUCKET=$NAME-backups-$(aws sts get-caller-identity --query Account --output text)
aws s3 mb s3://$BUCKET
aws iam put-role-policy --role-name $NAME-host --policy-name app --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[
  {\"Effect\":\"Allow\",\"Action\":\"secretsmanager:GetSecretValue\",\"Resource\":\"$SECRET_ARN\"},
  {\"Effect\":\"Allow\",\"Action\":[\"s3:PutObject\",\"s3:GetObject\",\"s3:ListBucket\"],\"Resource\":[\"arn:aws:s3:::$BUCKET\",\"arn:aws:s3:::$BUCKET/*\"]}]}"
aws iam create-instance-profile --instance-profile-name $NAME-host
aws iam add-role-to-instance-profile --instance-profile-name $NAME-host --role-name $NAME-host
```

Never put the key in git, in user data or in a screenshot. Use a **new** `VOICE_WORKER_TOKEN` for the cloud. Don't reuse the local one.

## 3. Launch the instance (5 min)

```sh
AMI=$(aws ssm get-parameter --name /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id --query Parameter.Value --output text)
cat > user-data.sh <<'EOF'
#!/bin/bash
set -eux
apt-get update
apt-get install -y ca-certificates curl git jq sqlite3 unzip
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable" > /etc/apt/sources.list.d/docker.list
apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
curl -fsSL https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o /tmp/awscli.zip && unzip -q /tmp/awscli.zip -d /tmp && /tmp/aws/install
mkdir -p /srv/copitch/data /srv/copitch/backup
EOF
IID=$(aws ec2 run-instances --image-id $AMI --instance-type m7i.2xlarge \
  --subnet-id $SUBNET --security-group-ids $SG --iam-instance-profile Name=$NAME-host \
  --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=100,VolumeType=gp3,Encrypted=true,DeleteOnTermination=false}' \
  --metadata-options HttpTokens=required,HttpPutResponseHopLimit=1 \
  --user-data file://user-data.sh \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NAME}]" --query 'Instances[0].InstanceId' --output text)
aws ec2 wait instance-status-ok --instance-ids $IID
EIP=$(aws ec2 allocate-address --query AllocationId --output text)
aws ec2 associate-address --instance-id $IID --allocation-id $EIP
IP=$(aws ec2 describe-addresses --allocation-ids $EIP --query 'Addresses[0].PublicIp' --output text)
echo "Elastic IP: $IP   sslip host: ${IP//./-}.sslip.io"
```

- `HttpPutResponseHopLimit=1` stops containers from reaching the instance metadata service. This protects the instance role even if a website the agent visits tries a server-side request trick. Keep `SITE_AGENT_ALLOW_PRIVATE=0` (already set in `deploy/compose.aws.yml`).
- `DeleteOnTermination=false` keeps the data volume if the instance is terminated by mistake.

If you use your own domain, create the A record `copitch.yourdomain.com → $IP` now and wait until it resolves.

## 4. Put the code on the server

Open a shell: **EC2 console → instance → Connect → Session Manager**, then run `sudo -i`.

**Option A. Clone a reviewed release ref from GitHub.**

```sh
cd /srv/copitch
RELEASE_REF=REPLACE_WITH_REVIEWED_TAG
git -c credential.helper= clone --branch "$RELEASE_REF" https://github.com/JyothiKumar03/copitch.git app
git -C app rev-parse HEAD
```

For a private repository, use the interactive credential prompt with a short-lived read-only credential. The printed commit must match the reviewed release.

**Option B. Transfer the verified source-only snapshot.** Run this from your workstation with the approved snapshot, manifest and private bucket already selected.

```sh
CANDIDATE_DIR=/absolute/path/to/reviewed-source
CANDIDATE_MANIFEST=/absolute/path/to/reviewed-source.sha256
(
  set -eu
  BUNDLE_DIR=$(mktemp -d)
  (cd "$CANDIDATE_DIR" && shasum -a 256 -c "$CANDIDATE_MANIFEST")
  COPYFILE_DISABLE=1 tar -C "$CANDIDATE_DIR" -czf "$BUNDLE_DIR/copitch.tgz" .
  aws s3 cp "$BUNDLE_DIR/copitch.tgz" "s3://$BUCKET/release/copitch.tgz"
  aws s3 cp "$CANDIDATE_MANIFEST" "s3://$BUCKET/release/copitch.sha256"
)
```

The snapshot contains only reviewed build inputs. Verify the downloaded archive in a new directory on the instance.

```sh
(
  set -eu
  bundle_dir=$(mktemp -d)
  aws s3 cp "s3://$BUCKET/release/copitch.tgz" "$bundle_dir/copitch.tgz"
  aws s3 cp "s3://$BUCKET/release/copitch.sha256" "$bundle_dir/copitch.sha256"
  mkdir /srv/copitch/app
  cd /srv/copitch/app
  tar -xzf "$bundle_dir/copitch.tgz"
  sha256sum -c "$bundle_dir/copitch.sha256"
)
```

(No local CLI? Use CloudShell's **Actions → Upload file**, then `aws s3 cp` from CloudShell.)

## 5. Configure and start (15–20 min, the first build is the slow part)

```sh
cd /srv/copitch/app
export AWS_REGION=ap-south-1
umask 077
aws secretsmanager get-secret-value --secret-id copitch-demo/app --query SecretString --output text \
  | jq -r 'to_entries[] | "\(.key)=\(.value|@sh)"' > .env
cat >> .env <<'EOF'
PUBLIC_HOST=REPLACE_WITH_HOSTNAME
SESSION_DATA_DIR=/srv/copitch/data
SITE_RUN_BUDGET_USD=5
MISSION_BUDGET_USD=5
EOF
chmod 600 .env
docker compose -f docker-compose.yml -f deploy/compose.aws.yml up -d --build
docker compose -f docker-compose.yml -f deploy/compose.aws.yml ps
```

`PUBLIC_HOST` is either `copitch.yourdomain.com` or `13-234-10-20.sslip.io`.

## 6. Verify (go / no-go)

```sh
curl -fsS "https://REPLACE_WITH_HOSTNAME/api/ready"
docker compose -f docker-compose.yml -f deploy/compose.aws.yml logs --tail=50 api gateway
```

Then in Chrome on a **second device**:
1. Open `https://<host>`. Check for the padlock and a valid certificate.
2. Sign up, create a project, and run the website journey on `jk-ai.in`. Check that screenshots appear; that proves Chromium works in the container.
3. Generate slides, then **Approve and present**.
4. Run the live checks on the real laptop, with speakers and the mic (see `docs/live-interruption-rca.md` §4, step 6):
   - Hold to talk: 5 of 5;
   - hands-free interruption: record the result.
5. Sign out, sign in from another browser, and reopen the project and deck. They must match.
6. Record the results in `docs/release-checklist.md`.

## 7. Operate

| Task | Command (on the server, in `/srv/copitch/app`) |
|---|---|
| Logs | `docker compose -f docker-compose.yml -f deploy/compose.aws.yml logs -f api` |
| Update to new code | Build the reviewed release ref or verified bundle in a fresh directory. Reuse the approved Compose project name and persistent data mount during the maintenance window. Retain the previous release and verified backup for rollback. |
| Restart one service | `docker compose -f docker-compose.yml -f deploy/compose.aws.yml restart api` |
| Nightly backup (add once) | `echo '15 2 * * * root sqlite3 /srv/copitch/data/sessions.sqlite ".backup /srv/copitch/backup/s.sqlite" && aws s3 cp /srv/copitch/backup/s.sqlite s3://<BUCKET>/db/sessions-$(date +\%F).sqlite' > /etc/cron.d/copitch-backup` |
| Rehearse restore | Download the chosen backup to a separate data directory with the filename `sessions.sqlite`. Start an isolated Compose project on a separate hostname with that directory as `SESSION_DATA_DIR`. Sign in and compare the saved research, approved deck revision, screenshot and PowerPoint. Verify a new test project is isolated to the restored instance. |
| Pause spending | `aws ec2 stop-instances --instance-ids $IID` (storage and Elastic IP still bill) |
| Tear down | Terminate the instance, delete the volume, release the Elastic IP, delete the secret, empty and delete the bucket, delete the IAM role, profile and security group |

## 8. Known cloud risks and mitigations

| Risk | Mitigation |
|---|---|
| Venue Wi-Fi blocks the UDP WebRTC connection to OpenAI | Hold to talk and typed questions use HTTPS only. Rehearse on the venue network or a phone hotspot. |
| The first build takes 15–20 min (Java PowerPoint reader, Next.js) | Build the day before. Later updates rebuild only the changed layers. |
| Let's Encrypt rate limits after repeated failed attempts | Make sure DNS resolves before the first start. `sslip.io` works immediately. |
| One SQLite writer | Single instance by design. Don't run two copies against the same data. |
| A runaway crawl costs money | `SITE_RUN_BUDGET_USD` and `MISSION_BUDGET_USD` are hard caps metered per call. Check spend in the run view. |
| Secrets exposure | The secret lives in Secrets Manager. `.env` on the server is `600` and excluded from tarballs. Rotate `VOICE_WORKER_TOKEN` and the OpenAI key if they were ever pasted anywhere. |

Keep the original data volume available until the restored instance passes the browser drill. Switching traffic to a restored snapshot requires agreement on the recovery point and any intervening writes. [AWS EBS snapshot recovery](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-snapshots.html)
