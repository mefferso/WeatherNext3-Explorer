from datetime import timezone
import json

import numpy as np
import pytest
import xarray as xr

from app import (
    MEMBER_COUNT,
    ApiError,
    exact_probability_from_accumulated,
    forecast_step_indices,
    height_dam_from_geopotential,
    parse_run,
    percentile_from_accumulated,
    validate_bbox,
    api_error_handler,
    _pressure_geopotential,
    _sample_dim,
)


def test_parse_run_normalizes_utc():
    dt = parse_run("2026-09-25T12:00:00Z")
    assert dt.tzinfo == timezone.utc
    assert dt.hour == 12


def test_bbox_limits_region_size():
    assert validate_bbox("-94,27,-86,33") == (-94.0, 27.0, -86.0, 33.0)
    with pytest.raises(ApiError) as exc:
        validate_bbox("-120,10,-70,40")
    assert exc.value.code == "bbox_too_large"


def test_forecast_hour_mapping_uses_lead_plus_subtime():
    lead = np.array([np.timedelta64(6, "h"), np.timedelta64(12, "h")])
    sub = np.array([np.timedelta64(-5, "h"), np.timedelta64(-4, "h"), np.timedelta64(-3, "h"), np.timedelta64(-2, "h"), np.timedelta64(-1, "h"), np.timedelta64(0, "h")])
    assert forecast_step_indices(lead, sub, [1, 6, 7, 12]) == [0, 5, 6, 11]


def test_height_conversion_to_decameters():
    geopotential = np.array([[9.80665 * 5700.0]])
    assert height_dam_from_geopotential(geopotential)[0, 0] == pytest.approx(570.0)


def test_exact_probability_uses_all_64_members():
    arr = np.zeros((MEMBER_COUNT, 1, 1), dtype=float)
    arr[:32, 0, 0] = 0.02
    prob = exact_probability_from_accumulated(arr, 0.01)
    assert prob[0, 0] == pytest.approx(50.0)


def test_partial_member_data_is_masked():
    arr = np.zeros((MEMBER_COUNT, 1, 1), dtype=float)
    arr[0, 0, 0] = np.nan
    prob = exact_probability_from_accumulated(arr, 0.01)
    assert np.isnan(prob[0, 0])


def test_accumulated_percentile_is_across_member_totals():
    arr = np.arange(MEMBER_COUNT, dtype=float).reshape(MEMBER_COUNT, 1, 1)
    p50 = percentile_from_accumulated(arr, 50)
    assert p50[0, 0] == pytest.approx(31.5)


def test_api_error_serializes_status_and_code():
    response = api_error_handler(None, ApiError(404, "forecast_hour_unavailable", "No such forecast hour."))
    assert response.status_code == 404
    body = json.loads(response.body)
    assert body["error"]["code"] == "forecast_hour_unavailable"


def test_pressure_level_selection_supports_unflattened_raw_schema():
    values = np.zeros((64, 2, 1, 1), dtype=float)
    ds = xr.Dataset(
        {"geopotential": (("sample", "level", "lat_0p25", "lon_0p25"), values)},
        coords={"sample": np.arange(64), "level": [50000.0, 70000.0], "lat_0p25": [30.0], "lon_0p25": [270.0]},
    )
    selected = _pressure_geopotential(ds, 500)
    assert "level" not in selected.dims
    assert selected.sizes["sample"] == 64


def test_partial_ensemble_dimension_is_rejected():
    da = xr.DataArray(np.zeros((63, 1, 1)), dims=("sample", "lat_0p1", "lon_0p1"))
    with pytest.raises(ApiError) as exc:
        _sample_dim(da)
    assert exc.value.code == "partial_ensemble"
