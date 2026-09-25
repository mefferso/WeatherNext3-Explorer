# WeatherNext raw backend

This FastAPI service is the Phase 3 raw 64-member path for WeatherNext3-Explorer.

It is intentionally limited to:
- 500-hPa geopotential-height ensemble mean contours
- exact 6/12/24-h accumulated-QPF exceedance probabilities
- true accumulated-member QPF P10/P25/P50/P75/P90

## Runtime

Deploy to Cloud Run in `us-east1`. The service uses Cloud Run Application Default Credentials and passes `x-goog-user-project` on raw Zarr reads for Requester Pays.

Required runtime environment:
- `GCP_PROJECT_ID`
- `GOOGLE_OAUTH_CLIENT_ID`
- `ALLOWED_EMAILS` (recommended via Secret Manager)
- `ALLOWED_ORIGINS=https://mefferso.github.io`
- `REQUIRE_ID_TOKEN=true`

Optional:
- `MAX_BBOX_WIDTH` (default 25)
- `MAX_BBOX_HEIGHT` (default 20)
- `RESPONSE_CACHE_SECONDS` (default 600)
- `RUN_PREFIX_CACHE_SECONDS` (default 300)
- `DATASET_CACHE_SIZE` (default 4)
- `RATE_LIMIT_PER_MINUTE` (default 60)

The service account still needs permission to use the billing project for Requester Pays and must be accepted by the WeatherNext raw-data access controls.

## Local tests

```bash
cd backend
python -m pip install -r requirements.txt pytest
REQUIRE_ID_TOKEN=false PYTHONPATH=. python -m pytest -q
python -m py_compile app.py
```

The tests are synthetic and intentionally do not download the operational global ensemble.
