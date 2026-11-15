#!/usr/bin/env bash
# ONE-TIME Google Cloud setup for the voice gateway. Run it in Google Cloud Shell (free):
#   bash setup-gcp.sh <PROJECT_ID>
# Prerequisite (needs you, in the console): a project with a billing account linked. Cloud Run
# requires billing to be enabled even when usage stays inside the free tier.
# Creates: APIs, 2 service accounts (deployer + runtime), an Artifact Registry repo (keeps only the
# 2 newest images, so it stays under the free 0.5 GB), and keyless GitHub → Google sign-in
# (Workload Identity Federation, limited to this repo's main branch). No keys are downloaded.
set -euo pipefail
PROJECT_ID="${1:?usage: bash setup-gcp.sh <PROJECT_ID>}"
REGION=asia-south1
GITHUB_REPO=suryavanshi-cmd/super-kirana
DEPLOYER="voice-deployer@${PROJECT_ID}.iam.gserviceaccount.com"
RUNTIME="voice-gateway-run@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud config set project "$PROJECT_ID" >/dev/null
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
echo "Enabling APIs (free)…"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com \
  iamcredentials.googleapis.com sts.googleapis.com logging.googleapis.com billingbudgets.googleapis.com

echo "Service accounts…"
gcloud iam service-accounts describe "$DEPLOYER" >/dev/null 2>&1 || gcloud iam service-accounts create voice-deployer --display-name="GitHub deploy: voice-gateway"
gcloud iam service-accounts describe "$RUNTIME" >/dev/null 2>&1 || gcloud iam service-accounts create voice-gateway-run --display-name="voice-gateway runtime (reads its 3 secrets only)"
for role in roles/run.admin roles/artifactregistry.writer roles/secretmanager.admin; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$DEPLOYER" --role="$role" --condition=None >/dev/null
done
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME" --member="serviceAccount:$DEPLOYER" --role=roles/iam.serviceAccountUser >/dev/null

echo "Artifact Registry (keeps the 2 newest images)…"
gcloud artifacts repositories describe voice --location="$REGION" >/dev/null 2>&1 || \
  gcloud artifacts repositories create voice --repository-format=docker --location="$REGION" --description="voice-gateway images"
cat > /tmp/voice-cleanup.json <<'JSON'
[{"name":"keep-2-newest","action":{"type":"Keep"},"mostRecentVersions":{"keepCount":2}},
 {"name":"delete-rest","action":{"type":"Delete"},"condition":{"tagState":"ANY","olderThan":"1d"}}]
JSON
gcloud artifacts repositories set-cleanup-policies voice --location="$REGION" --policy=/tmp/voice-cleanup.json --no-dry-run >/dev/null

echo "Keyless GitHub sign-in (Workload Identity Federation)…"
gcloud iam workload-identity-pools describe github --location=global >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools create github --location=global --display-name="GitHub Actions"
gcloud iam workload-identity-pools providers describe github --location=global --workload-identity-pool=github >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools providers create-oidc github --location=global --workload-identity-pool=github \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
    --attribute-condition="assertion.repository=='${GITHUB_REPO}' && assertion.ref=='refs/heads/main'"
gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository/${GITHUB_REPO}" >/dev/null

echo
echo "Done. Add these two GitHub repository secrets (Settings → Secrets and variables → Actions):"
echo "  GCP_PROJECT_ID   = ${PROJECT_ID}"
echo "  GCP_WIF_PROVIDER = projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/providers/github"
