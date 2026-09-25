from __future__ import annotations

import hashlib
import logging
import math
import os
import threading
import time
from collections import OrderedDict, defaultdict, deque
from datetime import datetime, timezone
from typing import Any, Iterable

import contourpy
import numpy as np
import obstore
import xarray as xr
import zarr
from cachetools import TTLCache
from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from google.auth.transport import requests as google_requests
from google.cloud import storage
from google.oauth2 import id_token

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
LOG = logging.getLogger("weathernext3-backend")

BUCKET = "weathernext3_spatial"
ROOT_PREFIX = "weathernext_3_0_0/zarr/2026_to_present"
GRAVITY = 9.80665
MEMBER_COUNT = 64
SUPPORTED_ACCUM_HOURS = {6, 12, 24}
SUPPORTED_THRESHOLDS_IN = {0.25, 0.50, 1.00, 2.00, 3.00}
SUPPORTED_PERCENTILES = {10, 25, 50, 75, 90}
MAX_BBOX_WIDTH = float(os.getenv("MAX_BBOX_WIDTH", "25"))
MAX_BBOX_HEIGHT = float(os.getenv("MAX_BBOX_HEIGHT", "20"))
RESPONSE_CACHE_SECONDS = int(os.getenv("RESPONSE_CACHE_SECONDS", "600"))
RUN_PREFIX_CACHE_SECONDS = int(os.getenv("RUN_PREFIX_CACHE_SECONDS", "300"))
DATASET_CACHE_SIZE = int(os.getenv("DATASET_CACHE_SIZE", "4"))
RATE_LIMIT_PER_MINUTE = int(os.getenv("RATE_LIMIT_PER_MINUTE", "60"))
BUILD_SHA = os.getenv("BUILD_SHA", "dev")
PROJECT_ID = (os.getenv("GCP_PROJECT_ID") or os.getenv("GOOGLE_CLOUD_PROJECT") or "").strip()
OAUTH_CLIENT_ID = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "").strip()
ALLOWED_EMAILS = {x.strip().lower() for x in os.getenv("ALLOWED_EMAILS", "").split(",") if x.strip()}
REQUIRE_ID_TOKEN = os.getenv("REQUIRE_ID_TOKEN", "true").lower() not in {"0", "false", "no"}
ALLOWED_ORIGINS = [x.strip() for x in os.getenv(
    "ALLOWED_ORIGINS",
    "https://mefferso.github.io,http://localhost:8000,http://127.0.0.1:8000",
).split(",") if x.strip()]

app = FastAPI(title="WeatherNext 3 Raw Ensemble Backend", version="1.0.0")
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

_cache_lock = threading.Lock()
_response_cache: TTLCache[str, dict[str, Any]] = TTLCache(maxsize=96, ttl=RESPONSE_CACHE_SECONDS)
_run_prefix_cache: TTLCache[str, str] = TTLCache(maxsize=96, ttl=RUN_PREFIX_CACHE_SECONDS)
_token_cache: TTLCache[str, str] = TTLCache(maxsize=512, ttl=300)
_dataset_cache: OrderedDict[str, xr.Dataset] = OrderedDict()
_rate_lock = threading.Lock()
_rate_events: dict[str, deque[float]] = defaultdict(deque)


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


@app.exception_handler(ApiError)
def api_error_handler(_: Request, exc: ApiError):
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=exc.status_code, content={"error": {"code": exc.code, "message": exc.message}})


@app.middleware("http")
async def rate_limit(request: Request, call_next):
    if request.url.path == "/health" or request.method == "OPTIONS":
        return await call_next(request)
    forwarded = request.headers.get("x-forwarded-for", "")
    ip = forwarded.split(",")[0].strip() or (request.client.host if request.client else "unknown")
    now = time.time()
    with _rate_lock:
        q = _rate_events[ip]
        while q and q[0] < now - 60:
            q.popleft()
        if len(q) >= RATE_LIMIT_PER_MINUTE:
            from fastapi.responses import JSONResponse
            return JSONResponse(status_code=429, content={"error": {"code": "rate_limited", "message": "Raw-backend request rate limit exceeded."}})
        q.append(now)
    return await call_next(request)


def _require_project() -> str:
    if not PROJECT_ID:
        raise ApiError(503, "backend_not_configured", "GCP_PROJECT_ID is not configured on the backend.")
    return PROJECT_ID


def _verify_identity(request: Request) -> str:
    if not REQUIRE_ID_TOKEN:
        return "auth-disabled"
    if not OAUTH_CLIENT_ID:
        raise ApiError(503, "backend_auth_not_configured", "GOOGLE_OAUTH_CLIENT_ID is not configured on the backend.")
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise ApiError(401, "backend_sign_in_required", "Sign in with Google before using raw WeatherNext products.")
    token = auth.split(None, 1)[1].strip()
    digest = hashlib.sha256(token.encode()).hexdigest()
    with _cache_lock:
        cached = _token_cache.get(digest)
    if cached:
        return cached
    try:
        info = id_token.verify_oauth2_token(token, google_requests.Request(), OAUTH_CLIENT_ID)
    except Exception as exc:
        LOG.warning("ID-token verification failed: %s", type(exc).__name__)
        raise ApiError(401, "invalid_backend_identity", "Google identity token is invalid or expired.") from exc
    email = str(info.get("email", "")).lower()
    if info.get("email_verified") is not True or not email:
        raise ApiError(403, "unverified_identity", "A verified Google account is required for raw WeatherNext products.")
    if ALLOWED_EMAILS and email not in ALLOWED_EMAILS:
        raise ApiError(403, "identity_not_allowed", "This Google account is not allowed to use the raw WeatherNext backend.")
    with _cache_lock:
        _token_cache[digest] = email
    return email


def parse_run(value: str) -> datetime:
    raw = value.strip()
    try:
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        dt = datetime.fromisoformat(raw)
    except ValueError as exc:
        raise ApiError(400, "invalid_run", "run must be an ISO-8601 initialization timestamp.") from exc
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    dt = dt.astimezone(timezone.utc)
    if dt.minute or dt.second or dt.microsecond:
        raise ApiError(400, "invalid_run", "WeatherNext initialization must be on an exact UTC hour.")
    if dt.year < 2026:
        raise ApiError(422, "historical_archive_not_enabled", "Phase 3 currently targets per-init 2026-to-present operational Zarr stores.")
    return dt


def validate_bbox(value: str) -> tuple[float, float, float, float]:
    try:
        west, south, east, north = [float(x) for x in value.split(",")]
    except Exception as exc:
        raise ApiError(400, "invalid_bbox", "bbox must be west,south,east,north in decimal degrees.") from exc
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise ApiError(400, "invalid_bbox", "bbox must satisfy -180≤west<east≤180 and -90≤south<north≤90.")
    if east - west > MAX_BBOX_WIDTH or north - south > MAX_BBOX_HEIGHT:
        raise ApiError(413, "bbox_too_large", f"Raw-data bbox is limited to {MAX_BBOX_WIDTH:g}° × {MAX_BBOX_HEIGHT:g}°.")
    return west, south, east, north


def _cache_key(prefix: str, **parts: Any) -> str:
    return prefix + "|" + "|".join(f"{k}={parts[k]}" for k in sorted(parts))


def _get_cached(key: str) -> dict[str, Any] | None:
    with _cache_lock:
        value = _response_cache.get(key)
        return value.copy() if value else None


def _put_cached(key: str, value: dict[str, Any]) -> None:
    with _cache_lock:
        _response_cache[key] = value


def _storage_client() -> storage.Client:
    return storage.Client(project=_require_project())


def resolve_run_prefix(run: datetime) -> str:
    run_key = run.strftime("%Y%m%d_%H")
    with _cache_lock:
        cached = _run_prefix_cache.get(run_key)
    if cached:
        return cached
    client = _storage_client()
    bucket = client.bucket(BUCKET, user_project=_require_project())
    search_prefix = f"{ROOT_PREFIX}/{run.strftime('%Y%m%d_%H')}hr_"
    try:
        iterator = client.list_blobs(bucket, prefix=search_prefix, delimiter="/", max_results=20)
        list(iterator)
        candidates = sorted(p for p in iterator.prefixes if p.endswith("_preds/"))
    except Exception as exc:
        raise ApiError(502, "gcs_list_failed", f"Could not discover the raw Zarr run in GCS: {type(exc).__name__}.") from exc
    if not candidates:
        raise ApiError(404, "run_unavailable", f"No raw WeatherNext Zarr folder was found for {run.isoformat()}.")
    prefix = candidates[-1] + "predictions.zarr"
    with _cache_lock:
        _run_prefix_cache[run_key] = prefix
    return prefix


def open_dataset(run: datetime) -> tuple[xr.Dataset, str]:
    prefix = resolve_run_prefix(run)
    with _cache_lock:
        cached = _dataset_cache.get(prefix)
        if cached is not None:
            _dataset_cache.move_to_end(prefix)
            return cached, prefix
    try:
        gcs_store = obstore.store.GCSStore(
            bucket=BUCKET,
            prefix=prefix,
            client_options={"default_headers": {"x-goog-user-project": _require_project()}},
        )
        zstore = zarr.storage.ObjectStore(gcs_store, read_only=True)
        ds = xr.open_zarr(zstore, chunks={})
    except Exception as exc:
        raise ApiError(502, "zarr_open_failed", f"Could not open the WeatherNext Zarr store: {type(exc).__name__}.") from exc
    with _cache_lock:
        _dataset_cache[prefix] = ds
        _dataset_cache.move_to_end(prefix)
        while len(_dataset_cache) > DATASET_CACHE_SIZE:
            _, old = _dataset_cache.popitem(last=False)
            try:
                old.close()
            except Exception:
                pass
    return ds, prefix


def _timedelta_hours(values: Any) -> np.ndarray:
    arr = np.asarray(values)
    if np.issubdtype(arr.dtype, np.timedelta64):
        return np.rint(arr / np.timedelta64(1, "h")).astype(int)
    try:
        return np.rint(arr.astype(float)).astype(int)
    except Exception as exc:
        raise ApiError(500, "time_schema_error", "Raw Zarr lead-time coordinates are not interpretable as hours.") from exc


def forecast_step_indices(lead_time: Any, lead_subtime: Any, hours: Iterable[int]) -> list[int]:
    lead = _timedelta_hours(lead_time)
    sub = _timedelta_hours(lead_subtime)
    flattened = (lead[:, None] + sub[None, :]).reshape(-1)
    out: list[int] = []
    for hour in hours:
        hits = np.flatnonzero(flattened == int(hour))
        if len(hits) != 1:
            raise ApiError(404, "forecast_hour_unavailable", f"Raw Zarr does not contain a unique F{int(hour):03d} step.")
        out.append(int(hits[0]))
    return out


def _select_hours(da: xr.DataArray, ds: xr.Dataset, hours: Iterable[int]) -> xr.DataArray:
    if "lead_time" not in da.dims:
        raise ApiError(500, "time_schema_error", f"Variable {da.name!r} does not have a lead_time dimension.")
    if "lead_subtime" in da.dims:
        indices = forecast_step_indices(ds["lead_time"].values, ds["lead_subtime"].values, hours)
        return da.stack(step=("lead_time", "lead_subtime"), create_index=False).isel(step=indices)
    lead = _timedelta_hours(ds["lead_time"].values)
    indices = []
    for hour in hours:
        hits = np.flatnonzero(lead == int(hour))
        if len(hits) != 1:
            raise ApiError(404, "forecast_hour_unavailable", f"Raw Zarr does not contain F{int(hour):03d}.")
        indices.append(int(hits[0]))
    return da.isel(lead_time=indices).rename({"lead_time": "step"})


def _spatial_dims(da: xr.DataArray) -> tuple[str, str]:
    lat = next((d for d in da.dims if d.startswith("lat") or d in {"latitude", "y"}), None)
    lon = next((d for d in da.dims if d.startswith("lon") or d in {"longitude", "x"}), None)
    if not lat or not lon:
        raise ApiError(500, "spatial_schema_error", f"Could not identify latitude/longitude dimensions for {da.name!r}.")
    return lat, lon


def _coord_slice(coord: xr.DataArray, low: float, high: float) -> slice:
    values = np.asarray(coord.values)
    return slice(low, high) if values.size < 2 or values[0] <= values[-1] else slice(high, low)


def _subset_bbox(da: xr.DataArray, bbox: tuple[float, float, float, float]) -> tuple[xr.DataArray, str, str]:
    west, south, east, north = bbox
    lat_dim, lon_dim = _spatial_dims(da)
    da = da.sel({lat_dim: _coord_slice(da[lat_dim], south, north)})
    west360, east360 = west % 360.0, east % 360.0
    lon_values = np.asarray(da[lon_dim].values)
    ascending = lon_values[0] <= lon_values[-1]
    if west360 <= east360:
        da = da.sel({lon_dim: slice(west360, east360) if ascending else slice(east360, west360)})
    else:
        left = da.sel({lon_dim: slice(west360, 360.0) if ascending else slice(360.0, west360)})
        right = da.sel({lon_dim: slice(0.0, east360) if ascending else slice(east360, 0.0)})
        da = xr.concat([left, right], dim=lon_dim)
    if da.sizes.get(lat_dim, 0) < 2 or da.sizes.get(lon_dim, 0) < 2:
        raise ApiError(404, "empty_region", "The requested bbox did not intersect enough raw WeatherNext grid cells.")
    return da, lat_dim, lon_dim


def _sample_dim(da: xr.DataArray) -> str:
    dim = next((d for d in da.dims if d in {"sample", "member", "ensemble_member"}), None)
    if not dim:
        raise ApiError(500, "ensemble_schema_error", f"Variable {da.name!r} does not expose the ensemble-member dimension.")
    if int(da.sizes[dim]) != MEMBER_COUNT:
        raise ApiError(502, "partial_ensemble", f"Expected {MEMBER_COUNT} ensemble members but found {int(da.sizes[dim])}.")
    return dim


def _pressure_geopotential(ds: xr.Dataset, level_hpa: int) -> xr.DataArray:
    if "geopotential" in ds.data_vars:
        da = ds["geopotential"]
        level_dim = next((d for d in da.dims if "level" in d.lower() or "pressure" in d.lower()), None)
        if not level_dim:
            raise ApiError(500, "pressure_schema_error", "Geopotential exists but has no pressure-level dimension.")
        levels = np.asarray(da[level_dim].values, dtype=float)
        target = float(level_hpa * 100 if np.nanmax(levels) > 2000 else level_hpa)
        if not np.any(np.isclose(levels, target)):
            raise ApiError(404, "pressure_level_unavailable", f"{level_hpa}-hPa geopotential is not available in this run.")
        return da.sel({level_dim: target})
    for name in (f"geopotential_{level_hpa}", f"{level_hpa}_geopotential"):
        if name in ds.data_vars:
            return ds[name]
    raise ApiError(404, "variable_unavailable", f"Geopotential at {level_hpa} hPa is not present in this raw run.")


def _normalize_grid(data: np.ndarray, lat: np.ndarray, lon: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    lat = np.asarray(lat, dtype=float)
    lon = ((np.asarray(lon, dtype=float) + 180.0) % 360.0) - 180.0
    lat_order, lon_order = np.argsort(lat), np.argsort(lon)
    normalized = np.asarray(data)[..., lat_order, :][..., :, lon_order]
    return normalized, lat[lat_order], lon[lon_order]


def _json_values(arr: np.ndarray, digits: int) -> list[list[float | None]]:
    rounded = np.round(np.asarray(arr, dtype=float), digits)
    return [[None if not math.isfinite(float(v)) else float(v) for v in row] for row in rounded]


def height_dam_from_geopotential(values: np.ndarray) -> np.ndarray:
    return np.asarray(values, dtype=float) / GRAVITY / 10.0


def exact_probability_from_accumulated(accumulated_m: np.ndarray, threshold_m: float) -> np.ndarray:
    arr = np.asarray(accumulated_m, dtype=float)
    if arr.shape[0] != MEMBER_COUNT:
        raise ValueError(f"Expected {MEMBER_COUNT} members, got {arr.shape[0]}")
    valid = np.isfinite(arr).all(axis=0)
    probability = (arr > threshold_m).sum(axis=0) / MEMBER_COUNT * 100.0
    return np.where(valid, probability, np.nan)


def percentile_from_accumulated(accumulated_m: np.ndarray, percentile: int) -> np.ndarray:
    arr = np.asarray(accumulated_m, dtype=float)
    if arr.shape[0] != MEMBER_COUNT:
        raise ValueError(f"Expected {MEMBER_COUNT} members, got {arr.shape[0]}")
    valid = np.isfinite(arr).all(axis=0)
    values = np.quantile(arr, percentile / 100.0, axis=0)
    return np.where(valid, values, np.nan)


def _contour_features(lon: np.ndarray, lat: np.ndarray, height_dam: np.ndarray, interval: float = 3.0) -> tuple[list[dict[str, Any]], list[float]]:
    finite = np.asarray(height_dam)[np.isfinite(height_dam)]
    if not finite.size:
        raise ApiError(502, "empty_field", "500-hPa height returned no finite values for this region.")
    first = math.floor(float(finite.min()) / interval) * interval
    last = math.ceil(float(finite.max()) / interval) * interval
    levels = np.arange(first, last + interval * 0.5, interval)
    generator = contourpy.contour_generator(x=lon, y=lat, z=height_dam, line_type="Separate")
    features: list[dict[str, Any]] = []
    for level in levels:
        for segment in generator.lines(float(level)):
            if len(segment) < 2:
                continue
            features.append({
                "type": "Feature",
                "properties": {"height_dam": float(level)},
                "geometry": {"type": "LineString", "coordinates": [[round(float(x), 4), round(float(y), 4)] for x, y in segment]},
            })
    return features, [float(x) for x in levels]


def _raw_qpf_accumulation(ds: xr.Dataset, fh: int, accum_hours: int, bbox: tuple[float, float, float, float]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    if "total_precipitation_1hr" not in ds.data_vars:
        raise ApiError(404, "variable_unavailable", "total_precipitation_1hr is not present in this raw run.")
    if fh < accum_hours:
        raise ApiError(422, "accumulation_unavailable", f"{accum_hours}-h QPF is unavailable before F{accum_hours:03d}.")
    hours = list(range(fh - accum_hours + 1, fh + 1))
    da, lat_dim, lon_dim = _subset_bbox(ds["total_precipitation_1hr"], bbox)
    selected = _select_hours(da, ds, hours)
    sample_dim = _sample_dim(selected)
    accumulated = selected.sum(dim="step", skipna=False).transpose(sample_dim, lat_dim, lon_dim)
    try:
        values = np.asarray(accumulated.compute().values, dtype=float)
    except Exception as exc:
        raise ApiError(504, "gcs_read_failed", f"Raw QPF chunk read/computation failed: {type(exc).__name__}.") from exc
    values, lat, lon = _normalize_grid(values, accumulated[lat_dim].values, accumulated[lon_dim].values)
    return values, lat, lon


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok", "build": BUILD_SHA, "project_configured": bool(PROJECT_ID),
        "oauth_configured": bool(OAUTH_CLIENT_ID), "allowed_identity_count": len(ALLOWED_EMAILS),
        "bucket": BUCKET, "requester_pays": True, "recommended_region": "us-east1",
    }


@app.get("/v1/capabilities")
def capabilities(request: Request) -> dict[str, Any]:
    _verify_identity(request)
    return {
        "field": {"variables": ["geopotential"], "levels_hpa": [500], "ensemble": "mean", "contour_interval_dam": 3},
        "qpf_probability": {"accum_hours": sorted(SUPPORTED_ACCUM_HOURS), "thresholds_in": sorted(SUPPORTED_THRESHOLDS_IN), "members": MEMBER_COUNT},
        "qpf_percentile": {"accum_hours": sorted(SUPPORTED_ACCUM_HOURS), "percentiles": sorted(SUPPORTED_PERCENTILES), "members": MEMBER_COUNT},
    }


@app.get("/v1/field")
def field(request: Request, run: str = Query(...), fh: int = Query(..., ge=1, le=360),
          variable: str = Query("geopotential"), level: int = Query(500), bbox: str = Query(...)) -> dict[str, Any]:
    _verify_identity(request)
    if variable != "geopotential" or level != 500:
        raise ApiError(422, "unsupported_field", "Phase 3 currently supports only 500-hPa geopotential height.")
    init, region = parse_run(run), validate_bbox(bbox)
    if init.hour not in {0, 6, 12, 18}:
        raise ApiError(422, "pressure_level_run_unavailable", "Pressure-level fields are available only for 00/06/12/18 UTC initializations.")
    key = _cache_key("field", run=init.isoformat(), fh=fh, level=level, bbox=region)
    if cached := _get_cached(key):
        cached["cache"] = "hit"
        return cached
    ds, prefix = open_dataset(init)
    da = _pressure_geopotential(ds, level)
    da, lat_dim, lon_dim = _subset_bbox(da, region)
    selected = _select_hours(da, ds, [fh]).isel(step=0, drop=True)
    sample_dim = _sample_dim(selected)
    mean = selected.mean(dim=sample_dim, skipna=False).transpose(lat_dim, lon_dim)
    try:
        geopotential = np.asarray(mean.compute().values, dtype=float)
    except Exception as exc:
        raise ApiError(504, "gcs_read_failed", f"500-hPa Zarr chunk read/computation failed: {type(exc).__name__}.") from exc
    geopotential, lat, lon = _normalize_grid(geopotential, mean[lat_dim].values, mean[lon_dim].values)
    height_dam = height_dam_from_geopotential(geopotential)
    features, levels = _contour_features(lon, lat, height_dam, 3.0)
    result = {
        "kind": "contours", "product": "500-hPa geopotential height ensemble mean",
        "run": init.isoformat().replace("+00:00", "Z"), "forecast_hour": fh, "level_hpa": 500,
        "units": "dam", "ensemble_members": MEMBER_COUNT, "resolution_deg": 0.25,
        "contour_interval_dam": 3, "contour_levels_dam": levels, "features": features,
        "bbox": list(region), "source_prefix": prefix, "cache": "miss",
    }
    _put_cached(key, result)
    return result


@app.get("/v1/probability")
def probability(request: Request, run: str = Query(...), fh: int = Query(..., ge=1, le=360),
                accum_hours: int = Query(...), threshold_in: float = Query(...), bbox: str = Query(...)) -> dict[str, Any]:
    _verify_identity(request)
    if accum_hours not in SUPPORTED_ACCUM_HOURS:
        raise ApiError(422, "unsupported_accumulation", "Exact QPF probability supports 6, 12, or 24-hour accumulations.")
    threshold = round(float(threshold_in), 2)
    if threshold not in SUPPORTED_THRESHOLDS_IN:
        raise ApiError(422, "unsupported_threshold", "Threshold must be 0.25, 0.50, 1.00, 2.00, or 3.00 inches.")
    init, region = parse_run(run), validate_bbox(bbox)
    key = _cache_key("probability", run=init.isoformat(), fh=fh, accum=accum_hours, threshold=threshold, bbox=region)
    if cached := _get_cached(key):
        cached["cache"] = "hit"
        return cached
    ds, prefix = open_dataset(init)
    accumulated_m, lat, lon = _raw_qpf_accumulation(ds, fh, accum_hours, region)
    probability_pct = exact_probability_from_accumulated(accumulated_m, threshold * 0.0254)
    result = {
        "kind": "grid", "product": "exact accumulated-QPF exceedance probability",
        "run": init.isoformat().replace("+00:00", "Z"), "forecast_hour": fh,
        "accum_hours": accum_hours, "threshold_in": threshold, "units": "%",
        "ensemble_members": MEMBER_COUNT, "resolution_deg": 0.1,
        "lat": [round(float(x), 4) for x in lat], "lon": [round(float(x), 4) for x in lon],
        "values": _json_values(probability_pct, 2),
        "bbox": [float(lon.min()), float(lat.min()), float(lon.max()), float(lat.max())],
        "source_prefix": prefix, "cache": "miss",
    }
    _put_cached(key, result)
    return result


@app.get("/v1/percentile")
def percentile(request: Request, run: str = Query(...), fh: int = Query(..., ge=1, le=360),
               accum_hours: int = Query(...), percentile: int = Query(...), bbox: str = Query(...)) -> dict[str, Any]:
    _verify_identity(request)
    if accum_hours not in SUPPORTED_ACCUM_HOURS:
        raise ApiError(422, "unsupported_accumulation", "Accumulated QPF percentiles support 6, 12, or 24-hour accumulations.")
    if percentile not in SUPPORTED_PERCENTILES:
        raise ApiError(422, "unsupported_percentile", "Percentile must be P10, P25, P50, P75, or P90.")
    init, region = parse_run(run), validate_bbox(bbox)
    key = _cache_key("percentile", run=init.isoformat(), fh=fh, accum=accum_hours, percentile=percentile, bbox=region)
    if cached := _get_cached(key):
        cached["cache"] = "hit"
        return cached
    ds, prefix = open_dataset(init)
    accumulated_m, lat, lon = _raw_qpf_accumulation(ds, fh, accum_hours, region)
    values_in = percentile_from_accumulated(accumulated_m, percentile) / 0.0254
    result = {
        "kind": "grid", "product": f"true accumulated-QPF P{percentile}",
        "run": init.isoformat().replace("+00:00", "Z"), "forecast_hour": fh,
        "accum_hours": accum_hours, "percentile": percentile, "units": "in",
        "ensemble_members": MEMBER_COUNT, "resolution_deg": 0.1,
        "method": "accumulate each member first, then compute percentile across 64 accumulated totals",
        "lat": [round(float(x), 4) for x in lat], "lon": [round(float(x), 4) for x in lon],
        "values": _json_values(values_in, 3),
        "bbox": [float(lon.min()), float(lat.min()), float(lon.max()), float(lat.max())],
        "source_prefix": prefix, "cache": "miss",
    }
    _put_cached(key, result)
    return result
