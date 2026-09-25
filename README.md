# WeatherNext 3 Explorer

An LIX-focused browser explorer for **Google WeatherNext 3** experimental ensemble guidance.

## Zero-cost architecture

This build is intentionally limited to services that do not require pay-as-you-go use for the project's noncommercial workflow:

- **Google Earth Engine noncommercial Community Tier** for WeatherNext 3 surface guidance.
- **Leaflet** for map rendering.
- **OpenStreetMap** standard tiles for the basemap.
- **GitHub Pages** for the static site.
- **Chart.js** for point analysis.

The Explorer does **not** use:

- Google Maps JavaScript API
- Cloud Run
- Requester Pays WeatherNext GCS/Zarr reads
- raw 64-member processing
- service-account billing credentials

Earth Engine map IDs are displayed in Leaflet with `ee.data.getTileUrl()`.

## Current products and analysis

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

Operational display scales remain fixed across forecast hours and model runs.

- QPF uses discrete operational thresholds and masks values below trace.
- Wind uses fixed bins extending beyond 45 kt.
- MSLP uses a fixed 940–1040 hPa fill with approximate 4-hPa contour edges.
- Temperature and dewpoint retain fixed continuous scales to preserve spatial gradients.
- Run differences use symmetric diverging scales centered on zero.
- Percentile-spread products are explicitly labeled as percentile ranges, not standard deviation.

## Probability limitation

Earth Engine exposes precomputed ensemble statistics rather than all 64 raw members. The QPF probability product therefore reports defensible probability **ranges** such as `75–90%` rather than an invented exact member-count probability.

Exact raw-member probabilities and pressure-level fields such as 500-mb height are intentionally excluded because the official raw GCS/Zarr path is Requester Pays.

## Browser setup

The Explorer requires only:

1. A Google Cloud project registered for **Earth Engine noncommercial use**.
2. The **Earth Engine API** enabled.
3. An **OAuth 2.0 Web Client ID** with `https://mefferso.github.io` as an Authorized JavaScript origin.
4. Sign-in with the Google account approved for WeatherNext access.

No Google Maps API key is required.

The Cloud project ID and OAuth Client ID are stored in browser `localStorage`; no private key is committed to GitHub.

## Scientific notes

- WeatherNext 3 Earth Engine surface output is roughly 0.1° (~10–11 km).
- Synoptic 00/06/12/18 UTC initializations extend to 360 h; interim hourly initializations extend to 48 h.
- Forecast-hour controls use the actual `forecast_hour` images available for the selected run.
- Multi-hour QPF sums hourly **ensemble-mean** precipitation only when every required hour is available.
- Same-valid-time comparison computes the comparison run's matching forecast hour and refuses mismatches.
- P75–P25 and P90–P10 products are percentile spreads, not standard deviation.
- Point meteograms and run trends load on demand.
- Recently generated Earth Engine map IDs are cached in the browser session.

## Basemap

The basemap uses Leaflet 1.9.4 with OpenStreetMap standard tiles and the required OpenStreetMap attribution. This project is a low-volume personal/research viewer; deployments with substantial public traffic should follow OpenStreetMap's tile-usage policy or use another no-cost/self-hosted tile source.

## Data / attribution

WeatherNext is experimental guidance from Google DeepMind / Google Research and is not an official NWS forecast or warning. Historical WeatherNext data older than one hour is licensed under CC BY 4.0; real-time data is subject to Google's WeatherNext experimental terms.

Leaflet is BSD-2-Clause licensed. Chart.js is MIT licensed. Basemap data © OpenStreetMap contributors.

Official references:

- https://developers.google.com/weathernext/guides/earth-engine
- https://developers.google.com/earth-engine/apidocs/ee-data-gettileurl
- https://developers.google.com/earth-engine/guides/noncommercial_tiers
- https://www.openstreetmap.org/copyright
