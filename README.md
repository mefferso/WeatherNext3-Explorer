# WeatherNext 3 Explorer

An LIX-focused browser explorer for **Google WeatherNext 3** experimental ensemble guidance.

The live browser build uses the official WeatherNext 3 Earth Engine surface collection:

\`projects/gcp-public-data-weathernext/assets/weathernext_3_0_0_0p1deg\`

The Google Cloud project is registered for Earth Engine noncommercial Community Tier use, so the app can render WeatherNext surface fields directly as map tiles.

## Current Earth Engine products and analysis

- 2-m temperature (°F)
- 2-m dewpoint (°F)
- 10-m wind speed (kt)
- QPF (1/3/6/12/24 h, inches)
- Mean sea-level pressure (hPa)
- 1-hour QPF exceedance probability ranges from P10/P25/P50/P75/P90
- P75–P25 and P90–P10 percentile-spread maps for temperature, dewpoint, wind, and MSLP
- Same-valid-time and same-forecast-lead run-difference maps
- Point meteograms with mean, P25–P75, and P10–P90 envelopes
- Run-over-run point trends for a selected valid time

## Display design

Operational display scales remain fixed across forecast hours and model runs so a color keeps the same meaning during comparison.

- QPF uses discrete operational thresholds and masks values below trace.
- Wind uses fixed bins extending beyond 45 kt.
- MSLP uses a fixed 940–1040 hPa fill with approximate 4-hPa contour edges.
- Temperature and dewpoint retain fixed continuous scales to preserve subtle spatial gradients.
- Run differences use symmetric diverging scales centered on zero.
- Percentile-spread products are explicitly labeled as percentile ranges, not standard deviation.

## Why the probability product uses ranges

Earth Engine exposes precomputed ensemble statistics rather than all 64 raw members. Therefore the app reports defensible probability brackets such as \`75–90%\` instead of inventing an exact member-count probability.

## Browser setup

The Explorer requires:

1. A Google Cloud project with the **Earth Engine API** enabled.
2. That project registered for Earth Engine use.
3. An **OAuth 2.0 Web Client ID** with \`https://mefferso.github.io\` as an Authorized JavaScript origin.
4. A **Maps JavaScript API key** restricted to \`https://mefferso.github.io/WeatherNext3-Explorer/*\`.
5. Sign-in with the same Google account approved for WeatherNext access.

Enter the Cloud project ID, OAuth Client ID, and Maps API key in the Explorer's Setup dialog. They are stored in browser \`localStorage\`; no private key is committed to GitHub.

## Scientific notes

- WeatherNext 3 0.1° surface output is roughly 10–11 km.
- Synoptic 00/06/12/18 UTC initializations extend to 360 h; interim hourly initializations extend to 48 h.
- Forecast-hour controls are populated from the actual \`forecast_hour\` images available for the selected run.
- Multi-hour QPF sums hourly **ensemble-mean** precipitation only when every hour in the requested accumulation window is available.
- Same-valid-time comparison computes the comparison run's forecast hour from the selected valid timestamp and refuses mismatches.
- P75–P25 and P90–P10 maps are percentile spreads, not standard deviation.
- Point meteograms and run trends are loaded on demand; the site does not preload large forecast-hour datasets.
- Recently generated Earth Engine map IDs are cached in the browser session to reduce duplicate renders.

## Phase 3 boundary

Pressure-level atmospheric fields and the raw 64-member ensemble are published through WeatherNext's Google Cloud Storage Zarr dataset, not the Earth Engine surface summary collection. They remain intentionally out of the browser-only Phase 2 implementation.

The later GCS/Zarr phase is the path for:

- 500-mb heights and other pressure-level fields
- exact member-count probabilities
- member-by-member accumulated QPF distributions
- spaghetti and other full-ensemble diagnostics

## Data / attribution

WeatherNext is experimental guidance from Google DeepMind / Google Research and is not an official NWS forecast or warning. Historical data older than one hour is licensed under CC BY 4.0; real-time data is subject to Google's GDM Real-Time Weather Forecasting Experimental Data Terms of Use.

Chart rendering uses Chart.js 4.5.1 (MIT).

Official references:

- https://developers.google.com/weathernext/guides/models
- https://developers.google.com/weathernext/guides/earth-engine
- https://developers.google.com/weathernext/guides/gcs
- https://developers.google.com/earth-engine/custom-apps/client-js
