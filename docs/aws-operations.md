# Run Module 1 on AWS

One regional ECS service runs four immutable Linux amd64 images on an EC2 host. Caddy handles HTTPS, Next.js serves the studio, Express owns SQLite and the research worker, and Python negotiates voice with OpenAI. The scheduler replaces failed tasks. The placement constraint binds the service to the host with the correct encrypted gp3 volume. SQLite has one active writer. A release briefly stops the old task before starting the new revision. Plan host replacement as a maintenance operation in the data volume's availability zone.

## Promote a release

1. Open a PR from the `jk/` feature branch into `dev`. Record the customer journey and its evidence in the module handoff. Review the changes in a private preview built from the candidate source commit. [Module 1 acceptance contract](../handoffs/1-pitch-studio.contract.md) · [Local HTTPS rehearsal](#rehearse-locally)
2. Obtain owner approval for the AWS candidate, including region, cost, hostname and data retention. Build the four Linux amd64 images from the reviewed source commit. Push them to ECR and record each digest URI beside that commit. Deploy those digests to the approved AWS candidate. [Provision an approved release](#provision-an-approved-release)
3. Validate the candidate over real HTTPS. Complete a pitch and reopen the same saved revision after signing in from a fresh browser on a second device. Verify another account cannot access it. Follow the returned `X-Trace-Id` into CloudWatch and restore a known project from an EBS snapshot into a separate stack. Use a physical microphone and audible agent playback to check English, Hindi and mixed-language turns, including a spoken interruption during the reply. Record the environment and outcomes against the acceptance contract. [Find a trace](#find-a-trace) · [Restore and recover](#restore-and-recover)
4. Obtain owner approval to promote after the candidate passes acceptance. Promote the tested source to `master`, tag the release, and record the same four digest URIs with the tag. Deploy those digests during an agreed maintenance window. Keep the previous digests and a verified SQLite backup available. If source content changes after candidate signoff, run acceptance on the new candidate before promotion.
5. To roll back, use the previous release's digests during a maintenance window. First verify on a copy that those images can read the current SQLite schema and saved revisions. If they cannot, rehearse the snapshot restore separately and get owner approval for the data loss window before switching the live volume. Verify the previous release can open a saved pitch and write a new project. [Restore and recover](#restore-and-recover)

## Rehearse locally

Build images on a workstation or CI runner. The web image serves every deployment using the gateway's origin. The API installs its production workspace dependencies, and the frontend copies the Next.js standalone server, static output and public assets into its runtime image.

```sh
export DOCKER_DEFAULT_PLATFORM=linux/amd64
docker build --platform linux/amd64 -t copitch-aws-x86-api -f backend/Dockerfile .
docker build --platform linux/amd64 -t copitch-aws-x86-web -f frontend/Dockerfile --build-arg NEXT_PUBLIC_API_URL= .
docker build --platform linux/amd64 -t copitch-aws-x86-voice voice
docker build --platform linux/amd64 -t copitch-aws-x86-gateway -f deploy/Gateway.Dockerfile .
python3 deploy/check-images.py
cfn-lint --regions us-east-1 --template deploy/stack.yml deploy/registry.yml
```

The image check creates a separate Docker Compose project with a private database. It trusts the fixture gateway's local CA, loads the home page through HTTPS, creates an account and project, restarts the API, then reads the saved project. It removes its own containers and fixture volume. Use Python with OpenSSL 3 on macOS.

## Provision an approved release

The following steps create billable resources. Obtain owner approval for the deployment, region, instance size and retention period. Select a public subnet with an internet gateway in the specified VPC and data zone. Allow outbound HTTPS to ECR, AWS APIs and OpenAI. The security group accepts TCP 80 and 443. Caddy is the single public HTTP hop. The private API trusts exactly that hop for client-IP rate limits when COPITCH_TRUST_GATEWAY=1. Leave the setting disabled on a directly reachable API. Administration uses Systems Manager Session Manager. Browser audio connects directly to OpenAI following authenticated HTTPS signaling through the API.

1. Create an ECR repository with `deploy/registry.yml`. Build for Linux amd64 and give each image a unique tag such as `api-<revision>`. Authenticate Docker with the regional ECR login, push all four tags and record each repository URI with its image digest. Reuse those digests in rehearsal and production.
2. Store a JSON object in regional Secrets Manager with string fields `OPENAI_API_KEY`, `OPENAI_TEXT_MODELS` and `VOICE_WORKER_TOKEN`. Set the text-model value to the team's approved serialized model configuration. Use a randomly generated worker credential. The template expects the default Secrets Manager encryption key. For a customer-managed key, grant the ECS execution role decrypt access on that key.
3. Apply `deploy/stack.yml` with the parameter names below. The template creates an ECS cluster, host, instance role, execution role, service, static IPv4 address, log group, retained data volume and snapshot schedule. A new release updates the image digest parameters. ECS rolls back a failed update when a previous deployment completed successfully.
4. Point the public hostname's DNS A record to the stack's GatewayIP output. Check the gateway certificate, the home page, `/api/ready` and a fresh-account pitch from a second browser. The ready check reads the SQLite job table. Creating and reopening a project verifies writes through the customer entry point.

```sh
aws cloudformation deploy --stack-name copitch-images --template-file deploy/registry.yml
aws cloudformation deploy --stack-name copitch-studio --template-file deploy/stack.yml \
  --capabilities CAPABILITY_IAM --parameter-overrides \
  "Vpc=$VPC" "PublicSubnet=$SUBNET" "DataZone=$ZONE" "PublicHost=$PUBLIC_HOST" \
  "ApplicationSecret=$SECRET_ARN" "ApiImage=$API_DIGEST_URI" "WebImage=$WEB_DIGEST_URI" \
  "VoiceImage=$VOICE_DIGEST_URI" "GatewayImage=$GATEWAY_DIGEST_URI"
```

The default host is a t3.medium. Its memory and burstable CPU are a starting configuration for a measured rehearsal. The service deliberately has one replica. During rehearsal, record cold start, warm request p95, completed research p95 and CPU credit balance at the expected concurrency. The single worker queues extra research requests. Increase host capacity or change scheduling after measuring the limiting resource. Local image size and fixture timing do not predict AWS round-trip latency.

## Find a trace

Express returns `X-Trace-Id`. Accepted research and job-poll requests use the durable job UUID. Retries after an API restart retain that UUID. The API emits one JSON line per completed or disconnected request, research activity and worker attempt. The allowlist includes route templates, operation, method, status, attempts and milliseconds. Trace logging omits filenames, raw URLs, account names, audio, prompts, source excerpts, cookie values and error bodies. Only the API forwards its process output to the dedicated CloudWatch log group.

Select the stack's TraceLogGroup in Logs Insights. Supply the trace ID from the response. Activity durations are elapsed times since the current attempt began. The completed attempt measures worker execution. A 202 response measures enqueue latency. The saved `<stack>/latency` query aggregates p50 and p95 separately. Browser media quality and audible interruption require measurements on a real device.

```
fields @timestamp, operation, status, route, attempt, duration_ms
| filter trace_id = "REPLACE_WITH_TRACE_ID"
| sort @timestamp asc
```

For a local trace rehearsal, enable `TRACE_LOGS=1` in the backend process and pipe the combined output of `bun test backend/tests/research-to-pitch.test.ts` into `python3 deploy/check-trace.py`. The checker requires an accepted request, research activity and completed worker attempt with the same trace ID.

## Restore and recover

Data Lifecycle Manager schedules daily encrypted snapshots of the project volume at 02:00 UTC and retains seven. The live SQLite database, its WAL and gateway certificate storage share that volume. Snapshots are crash-consistent. With daily snapshots the prospective data loss window is about a day, potentially longer after a missed snapshot. The application has no measured hosted recovery time yet. [AWS snapshot lifecycle policies](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-dlm-lifecyclepolicy.html)

For an online SQLite drill, run `python3 deploy/check-restore.py /srv/copitch/database/sessions.sqlite <research-id>` on the host. It uses SQLite's backup API and checks the restored database, artifact contents and owner identity inside a temporary directory. This tests the database backup separately from AWS snapshots.

For a hosted recovery drill, deploy a separate stack and hostname with `RestoreSnapshot=snap-...` and `VolumeGiB` at least the source snapshot's size. Use an approved test dataset and restricted access for that drill. Verify host registration, sign-in, the known project's source and saved pitch, and a new write in the restored stack. Record snapshot age and time to recovery. Keep the original stack serving throughout. A retained volume survives stack deletion. Retained EBS volumes, snapshots and repository images continue to incur charges until the owner approves cleanup.
