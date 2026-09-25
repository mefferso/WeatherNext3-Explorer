# WeatherNext 3 Explorer

An LIX-focused browser explorer for **Google WeatherNext 3** experimental ensemble guidance.

## Architecture

Phase 3 uses a deliberately hybrid architecture:

- **Earth Engine** remains the fast browser path for 0.1° surface mean/percentile maps, percentile spreads, meteograms, run comparison, run trends, and the existing bracketed QPF probability product.
- **Cloud Run + Google Cloud Storage Zarr** is the raw full-ensemble path for 64-member diagnostics and pressure-level fields.
- The GitHub Pages browser never receives a service-account key or GCS billing credential. Raw requests go only to the Cloud Run API.

The raw WeatherNext 3 store is:

`gs://weathernext3_spatial/weathernext_3_0_0/zarr/`

The backend targets the per-initialization `2026_to_present` Zarr stores and uses Requester Pays billing through the backend's Google Cloud project.

## Current products

### Earth Engine

- 2-m temperature and dewpoint
- 10-m wind speed
- 1/3/6/12/24-h ensemble-mean QPF
- MSLP
- 1-hour QPF probability **ranges** inferred from P10/P25/P50/P75/P90
- P75–P25 and P90–P10 percentile-spread maps
- same-valid-time and same-forecast-lead run differences
- point meteograms and run-over-run trends

### Raw GCS/Zarr proof-of-concept

- **500-hPa geopotential height, 64-member ensemble mean**
  - raw 0.25° pressure-level grid
  - geopotential height = geopotential / 9.80665
  - displayed in decameters
  - 3-dam contours, without upsampling the raw field into a fake high-resolution raster
- **Exact accumulated-QPF exceedance probability**
  - 6/12/24-hour windows
  - thresholds 0.25/0.50/1.00/2.00/3.00 inches
  - sums each member's hourly QPF first, then computes `members exceeding threshold / 64 × 100`
- **True accumulated QPF P10/P25/P50/P75/P90**
  - sums each member first
  - then computes the percentile across the 64 accumulated member totals
  - never sums hourly percentile fields

## Raw backend API

The Phase 3 API intentionally stays small:

- `GET /health`
- `GET /v1/capabilities`
- `GET /v1/field?run=...&fh=...&variable=geopotential&level=500&bbox=west,south,east,north`
- `GET /v1/probability?run=...&fh=...&accum_hours=24&threshold_in=1.00&bbox=...`
- `GET /v1/percentile?run=...&fh=...&accum_hours=24&percentile=90&bbox=...`

Raw requests are regional only (default maximum 25° × 20°). The backend selects variable, forecast step, pressure level and geographic subset before loading Zarr chunks.

The backend maps a browser forecast hour onto the raw Zarr `lead_time + lead_subtime` coordinates instead of assuming a flattened hourly raw time dimension.

## Caching and cost controls

- Cloud Run should be deployed in **us-east1**, the same region as the raw WeatherNext full-ensemble bucket.
- Open Xarray/Zarr datasets are kept in a small process LRU.
- Finished regional API responses have a short TTL cache.
- Run-folder discovery is cached.
- The browser also caches a small number of recent raw responses.
- Raw data are loaded only after a raw product is selected; no raw forecast hours are preloaded.
- The backend verifies that all 64 ensemble members are present. Grid cells with partial member data are returned as missing rather than silently changing the probability denominator.

## Browser setup

The existing Earth Engine/Google Maps setup is unchanged. The setup dialog now also accepts an optional **Phase 3 Cloud Run backend URL**.

Raw products use Google Identity Services with the same OAuth Web Client ID. The ID token stays in browser memory and is sent to Cloud Run in the Authorization header. The backend verifies the OAuth audience and a server-side allowed-email list.

## Deploying the backend

The repo includes `backend/` and `.github/workflows/backend.yml`.

The workflow always runs backend unit tests. Deployment is enabled only after the required GitHub repository variables are configured.

### One-time Google Cloud resources

Use the same billing project you want charged for WeatherNext Requester Pays access.

```bash
PROJECT_ID="YOUR_PROJECT_ID"
RUNTIME_SA="weathernext3-runtime@${PROJECT_ID}.iam.gserviceaccount.com"
DEPLOY_SA="weathernext3-deploy@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud config set project "${PROJECT_ID}"

gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com \
  serviceusage.googleapis.com

gcloud iam service-accounts create weathernext3-runtime
gcloud iam service-accounts create weathernext3-deploy

gcloud artifacts repositories create weathernext3 \
  --repository-format=docker \
  --location=us-east1

printf '%s' "YOUR_GOOGLE_ACCOUNT_EMAIL" | \
  gcloud secrets create WN3_ALLOWED_EMAILS --data-file=-

gcloud secrets add-iam-policy-binding WN3_ALLOWED_EMAILS \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/secretmanager.secretAccessor"

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/serviceusage.serviceUsageConsumer"
```

The runtime service account uses Application Default Credentials on Cloud Run; **do not create or upload a service-account JSON key**.

### WeatherNext raw-data allowlist

Google's WeatherNext access form currently describes allowlisting by Google Account email. A Cloud Run service-account identity may therefore need explicit access from the WeatherNext team before the raw bucket will accept it.

If the runtime service account receives a 403 from `weathernext3_spatial`, contact WeatherNext support / the data-access form and request GCS access for:

`weathernext3-runtime@YOUR_PROJECT_ID.iam.gserviceaccount.com`

This is separate from the OAuth email allowlist used to protect your own Cloud Run endpoint.

### GitHub → Google Cloud deployment identity

Configure **Workload Identity Federation** for GitHub Actions and grant the deploy service account:

- Artifact Registry Writer on the `weathernext3` repository
- Cloud Run Admin on the project
- Service Account User on the runtime service account

Then create these GitHub **repository variables**:

- `GCP_PROJECT_ID`
- `GCP_WIF_PROVIDER`
- `GCP_DEPLOY_SERVICE_ACCOUNT`
- `WN3_RUNTIME_SERVICE_ACCOUNT`
- `WN3_OAUTH_CLIENT_ID`

The workflow does not use a long-lived Google service-account key.

After those variables and the `WN3_ALLOWED_EMAILS` Secret Manager secret exist, run **Test and deploy WeatherNext raw backend** from GitHub Actions or push a backend change. Copy the resulting Cloud Run HTTPS URL into the Explorer's Setup dialog.

## Scientific notes

- WeatherNext surface fields are ~0.1° (~10 km).
- Pressure-level atmospheric fields are ~0.25° (~25 km) and available on 00/06/12/18 UTC initializations.
- Raw full-ensemble data contain 64 members.
- `total_precipitation_1hr` is in meters in the raw store.
- The Explorer's old Earth Engine QPF probability map remains a **quantile-derived probability range**. It is not renamed or presented as exact.
- The new raw-QPF product is explicitly **exact 64-member probability**.
- 500-hPa contours are computed from the raw grid; the frontend does not create a higher-resolution pressure-level raster.

## Testing

`backend/tests/test_core.py` covers:

- run timestamp parsing
- regional bbox limits
- raw `lead_time + lead_subtime` forecast-hour mapping
- geopotential → decameter conversion
- exact 64-member probability math
- partial-member masking
- percentile calculation across accumulated member totals

GitHub Actions installs the actual backend dependency stack and runs those tests plus Python compilation before a deploy can occur.

## Data / attribution

WeatherNext is experimental guidance from Google DeepMind / Google Research and is not an official NWS forecast or warning. Historical data older than one hour is CC BY 4.0; real-time data is subject to Google's WeatherNext experimental terms.

Official references:

- https://developers.google.com/weathernext/guides/models
- https://developers.google.com/weathernext/guides/earth-engine
- https://developers.google.com/weathernext/guides/gcs
- https://developers.google.com/weathernext/guides/access-forecast
- https://developers.google.com/earth-engine/custom-apps/client-js
