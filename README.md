# WeatherNext 3 Explorer

An LIX-focused browser explorer for **Google WeatherNext 3** experimental ensemble guidance.

## Architecture

The original prototype used Google Earth Engine. Earth Engine project registration became an unnecessary bottleneck, so the app now uses **WeatherNext 3 through BigQuery Analytics Hub for surface statistics**.

That is a better separation of responsibilities:

- **BigQuery** — current browser maps for 0.1° surface ensemble statistics.
- **Google Cloud Storage / Zarr** — next phase for the raw 64-member ensemble and 13 atmospheric pressure levels, including 500-mb heights and exact member-count probabilities.
- **Google Maps JavaScript API** — basemap only.

No Earth Engine registration is required.

## Current products

- 2-m temperature (°F)
- 2-m dewpoint (°F)
- 10-m wind speed (kt)
- QPF (1/3/6/12/24 h, inches)
- Mean sea-level pressure (hPa)
- 1-hour QPF exceedance probability **ranges** based on P10/P25/P50/P75/P90
- 500-mb height is shown as the next GCS/Zarr phase and is intentionally not faked from surface data.

## One-time BigQuery setup

1. Select the Google Cloud project used for this explorer.
2. Enable the **BigQuery API**.
3. Open Google's WeatherNext 3 BigQuery Analytics Hub listing while signed into the allowlisted WeatherNext account.
4. Subscribe to the listing and create a linked dataset in the project.
5. Note the linked dataset ID. It should contain:
   - `weathernext_3_0_0_0p1deg`
   - `weathernext_3_0_0_0p05deg`
6. Keep the existing OAuth Web Client ID. Its Authorized JavaScript origins should include:
   - `https://mefferso.github.io`
7. Keep the Maps JavaScript API key restricted to:
   - `https://mefferso.github.io/WeatherNext3-Explorer/*`
8. In the Explorer Setup dialog enter:
   - Cloud project ID
   - BigQuery linked dataset ID
   - OAuth Web Client ID
   - Maps JavaScript API key
9. Sign in with the same Google account approved for WeatherNext.

The app requests only the BigQuery OAuth scope and runs read-only SQL against the linked WeatherNext table.

## Scientific notes

- WeatherNext 3 0.1° output is roughly 11 km.
- 00/06/12/18 UTC initializations extend to 360 h; interim hourly initializations extend to 48 h.
- The app always filters on `init_time` to use BigQuery partition pruning.
- The map query is spatially limited to the Lower Mississippi Valley / central Gulf Coast region to reduce query volume.
- Multi-hour QPF sums hourly **ensemble-mean** precipitation. It does not sum hourly percentile fields.
- BigQuery provides precomputed surface statistics, not the raw 64 members. Therefore QPF probability is represented as a defensible range from the published quantiles rather than an invented exact percentage.
- Exact member-count probabilities and pressure-level fields require the full GCS/Zarr dataset.

## Full-ensemble GCS/Zarr phase

Google publishes the raw WeatherNext 3 ensemble at:

`gs://weathernext3_spatial/weathernext_3_0_0/zarr/`

The full ensemble contains 64 members, multi-resolution surface grids, and 13 pressure levels. It is Requester Pays, so regional slicing and compute locality matter. We should slice variable / lead time / region before loading chunks and avoid downloading global arrays.

## Official documentation

- https://developers.google.com/weathernext/guides/access-forecast
- https://developers.google.com/weathernext/guides/bigquery
- https://developers.google.com/weathernext/guides/gcs
- https://developers.google.com/weathernext/guides/models

## Data / attribution

Historical WeatherNext experimental data (data relating to one hour ago or more) is licensed under CC BY 4.0. Real-time experimental data is governed by Google's GDM Real-Time Weather Forecasting Experimental Data Terms of Use. WeatherNext predictions are experimental guidance and are not official NWS warnings or forecasts.
