# Phase 3 Google Cloud setup

Phase 3 keeps the public site on GitHub Pages and deploys only the raw-data service to Cloud Run.

## 1. Choose the billing project

Use the Google Cloud project that should pay the WeatherNext Requester Pays charges.

```bash
export PROJECT_ID="YOUR_PROJECT_ID"
export REPO="mefferso/WeatherNext3-Explorer"
export REGION="us-east1"
export RUNTIME_SA="weathernext3-runtime@${PROJECT_ID}.iam.gserviceaccount.com"
export DEPLOY_SA="weathernext3-deploy@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud config set project "${PROJECT_ID}"
```

Cloud Run is deliberately deployed in `us-east1`, the same region documented for the raw WeatherNext full-ensemble bucket.

## 2. Enable required APIs

```bash
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com \
  serviceusage.googleapis.com
```

## 3. Create the runtime and deploy service accounts

```bash
gcloud iam service-accounts create weathernext3-runtime \
  --display-name="WeatherNext 3 raw runtime"

gcloud iam service-accounts create weathernext3-deploy \
  --display-name="WeatherNext 3 GitHub deploy"
```

Do not create service-account JSON keys.

## 4. Create Artifact Registry

```bash
gcloud artifacts repositories create weathernext3 \
  --repository-format=docker \
  --location="${REGION}" \
  --description="WeatherNext3 Explorer backend images"
```

Grant the GitHub deploy identity permission to push images:

```bash
gcloud artifacts repositories add-iam-policy-binding weathernext3 \
  --location="${REGION}" \
  --member="serviceAccount:${DEPLOY_SA}" \
  --role="roles/artifactregistry.writer"
```

## 5. Runtime Requester Pays and Secret Manager permissions

The raw WeatherNext GCS bucket is Requester Pays. The runtime principal needs `serviceusage.services.use` on the billing project.

```bash
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/serviceusage.serviceUsageConsumer"
```

Create the backend's allowed-browser-email secret. For personal use this should normally be the same Google account you use for the existing WeatherNext Explorer.

```bash
printf '%s' "YOUR_GOOGLE_ACCOUNT_EMAIL" | \
  gcloud secrets create WN3_ALLOWED_EMAILS --data-file=-

gcloud secrets add-iam-policy-binding WN3_ALLOWED_EMAILS \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/secretmanager.secretAccessor"
```

If the secret already exists, add a new version instead:

```bash
printf '%s' "YOUR_GOOGLE_ACCOUNT_EMAIL" | \
  gcloud secrets versions add WN3_ALLOWED_EMAILS --data-file=-
```

## 6. Deploy-service-account permissions

```bash
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${DEPLOY_SA}" \
  --role="roles/run.admin"

gcloud iam service-accounts add-iam-policy-binding "${RUNTIME_SA}" \
  --member="serviceAccount:${DEPLOY_SA}" \
  --role="roles/iam.serviceAccountUser"
```

If Cloud Run deployment reports that the deployer cannot inspect the Secret Manager reference, also grant the deploy service account `roles/secretmanager.viewer` on `WN3_ALLOWED_EMAILS`.

## 7. Configure keyless GitHub Workload Identity Federation

Create one pool and GitHub OIDC provider:

```bash
export POOL_ID="github"
export PROVIDER_ID="weathernext3-github"

gcloud iam workload-identity-pools create "${POOL_ID}" \
  --location=global \
  --display-name="GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc "${PROVIDER_ID}" \
  --location=global \
  --workload-identity-pool="${POOL_ID}" \
  --display-name="WeatherNext3 GitHub provider" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository=='${REPO}'"

export POOL_NAME="$(gcloud iam workload-identity-pools describe "${POOL_ID}" \
  --location=global --format='value(name)')"

export PROVIDER_NAME="$(gcloud iam workload-identity-pools providers describe "${PROVIDER_ID}" \
  --location=global --workload-identity-pool="${POOL_ID}" --format='value(name)')"

gcloud iam service-accounts add-iam-policy-binding "${DEPLOY_SA}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/${POOL_NAME}/attribute.repository/${REPO}"

echo "GCP_WIF_PROVIDER=${PROVIDER_NAME}"
```

If you already have a GitHub WIF pool/provider, reuse it instead of creating another one.

## 8. Add GitHub repository variables

In the GitHub repository, open:

**Settings → Secrets and variables → Actions → Variables**

Create:

| Variable | Value |
| --- | --- |
| `GCP_PROJECT_ID` | your project ID |
| `GCP_WIF_PROVIDER` | full provider resource name printed above |
| `GCP_DEPLOY_SERVICE_ACCOUNT` | `weathernext3-deploy@PROJECT_ID.iam.gserviceaccount.com` |
| `WN3_RUNTIME_SERVICE_ACCOUNT` | `weathernext3-runtime@PROJECT_ID.iam.gserviceaccount.com` |
| `WN3_OAUTH_CLIENT_ID` | the same OAuth Web Client ID already used by the Explorer |

No long-lived GCP credential is stored as a GitHub secret.

## 9. WeatherNext raw-data access for the Cloud Run identity

This is the one access-control detail that cannot be created by this repo.

WeatherNext currently documents real-time access as an allowlist tied to a Google Account email. A Cloud Run runtime service account is a separate principal. If the deployed service gets `403` / permission-denied errors reading `gs://weathernext3_spatial`, contact the WeatherNext data-access team and ask whether they can allow the runtime principal:

`weathernext3-runtime@YOUR_PROJECT_ID.iam.gserviceaccount.com`

WeatherNext support: `weathernext@google.com`.

Your existing user allowlist does not prove that this service account is also authorized.

## 10. Deploy and connect the browser

After the GitHub variables exist:

1. In **Actions**, run **Test and deploy WeatherNext raw backend**, or push a change under `backend/`.
2. The workflow tests the Python code, builds the container, deploys Cloud Run, and calls `/health`.
3. Copy the printed Cloud Run URL.
4. Open the Explorer's **Setup** dialog.
5. Paste it into **Phase 3 Cloud Run backend URL** and save.
6. Select a raw product and use the Google sign-in button in the Raw full-ensemble panel.

## 11. First smoke tests

Use a 00/06/12/18 UTC run and a regional map view.

- **500-mb Height:** choose F024 and confirm 3-dam contour lines appear.
- **Raw QPF:** choose F024, 24 h, 1.00 in, Exact exceedance probability.
- Change to True accumulated P90 and verify a QPF raster appears.
- Repeat the exact same request and confirm the backend response reports a cache hit in Cloud Run logs.
- Try an interim hourly run for 500 mb; it should return a clear pressure-level-run-unavailable error.
- Zoom far out beyond 25° × 20°; the frontend should stop the raw request and tell you to zoom in.
