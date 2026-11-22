#!/bin/bash
# First boot of the single demo EC2 host: install Docker, clone master, pre-build images.
# The OpenAI key is never in this script. The owner runs /srv/copitch/start.sh in EC2 Instance Connect to enter it.
set -eux
exec > /var/log/copitch-setup.log 2>&1
apt-get update
apt-get install -y ca-certificates curl git jq sqlite3 openssl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable" > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
usermod -aG docker ubuntu
mkdir -p /srv/copitch/data
git clone --depth 1 --branch master https://github.com/JyothiKumar03/copitch.git /srv/copitch/app

cat > /srv/copitch/start.sh <<'START'
#!/bin/bash
# Asks for the OpenAI key (hidden), writes a private .env and starts the stack behind HTTPS.
set -eu
cd /srv/copitch/app
TOKEN=$(curl -fsS -X PUT http://169.254.169.254/latest/api/token -H "X-aws-ec2-metadata-token-ttl-seconds: 60")
IP=$(curl -fsS -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/public-ipv4)
HOST="${IP//./-}.sslip.io"
read -rsp "Paste your OpenAI API key, then press Enter: " KEY; echo
[ -n "$KEY" ] || { echo "No key entered."; exit 1; }
umask 077
{
  echo "OPENAI_API_KEY=$KEY"
  echo "VOICE_WORKER_TOKEN=$(openssl rand -hex 32)"
  echo "PUBLIC_HOST=$HOST"
  echo "SESSION_DATA_DIR=/srv/copitch/data"
} | sudo tee .env > /dev/null
sudo chmod 600 .env
sudo docker compose -f docker-compose.yml -f deploy/compose.aws.yml up -d --build
sudo docker compose -f docker-compose.yml -f deploy/compose.aws.yml ps
echo "Done. Open https://$HOST (the certificate can take a minute)."
START
chmod 755 /srv/copitch/start.sh

# Pre-build so start.sh only starts containers. Placeholders satisfy compose interpolation; nothing secret here.
cd /srv/copitch/app
PUBLIC_HOST=placeholder.invalid SESSION_DATA_DIR=/srv/copitch/data docker compose -f docker-compose.yml -f deploy/compose.aws.yml build \
  && touch /srv/copitch/BUILD_OK || touch /srv/copitch/BUILD_FAILED
