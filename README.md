# WeatherNext 3 Explorer

An LIX-focused browser explorer for **Google WeatherNext 3** experimental ensemble guidance.

The live browser build uses the official WeatherNext 3 Earth Engine surface collection:

`projects/gcp-public-data-weathernext/assets/weathernext_3_0_0_0p1deg`

The Google Cloud project is registered for Earth Engine noncommercial Community Tier use, so the app can render WeatherNext surface fields directly as map tiles.

## Current products

- 2-m temperature (°F)
- 2-m dewpoint (°F)
- 10-m wind speed (kt)
- QPF (1/3/6/12/24 h, inches)
- Mean sea-level pressure (hPa)
- 1-hour QPF exceedance probability ranges from P10/P25/P50/P75/P90

## Why the probability product uses ranges

Earth Engine exposes precomputed ensemble statistics rather than all 64 raw members. Therefore the app reports defensible probability brackets such as `75–90%` instead of inventing an exact member-count probability.

## Why 500-mb height is not in the browser build yet

Pressure-level atmospheric fields and the raw 64-member ensemble are published through WeatherNext's Google Cloud Storage Zarr dataset, not the Earth Engine surface summary collection. The next phase will add that raw-ensemble path for:

- 500-mb heights
- other pressure-level fields
- exact member-count probabilities
- spread / spaghetti / ensemble diagnostics

## Browser setup

The Explorer requires:

1. A Google Cloud project with the **Earth Engine API** enabled.
2. That project registered for Earth Engine use.
3. An **OAuth 2.0 Web Client ID** with `https://mefferso.github.io` as an Authorized JavaScript origin.
4. A **Maps JavaScript API key** restricted to `https://mefferso.github.io/WeatherNext3-Explorer/*`.
5. Sign-in with the same Google account approved for WeatherNext access.

Enter the Cloud project ID, OAuth Client ID, and Maps API key in the Explorer's Setup dialog. They are stored in browser `localStorage`; no private key is committed to GitHub.

## Scientific notes

- WeatherNext 3 0.1° surface output is roughly 11 km.
- Synoptic 00/06/12/18 UTC initializations extend to 360 h; interim hourly initializations extend to 48 h.
- Multi-hour QPF sums hourly **ensemble-mean** precipitation. The UI locks the statistic to Mean because summing hourly percentiles does not produce the percentile of the accumulated distribution.
- Click the map for a point sample of the currently displayed field.

## Data / attribution

WeatherNext is experimental guidance from Google DeepMind / Google Research and is not an official NWS forecast or warning. Historical data older than one hour is licensed under CC BY 4.0; real-time data is subject to Google's GDM Real-Time Weather Forecasting Experimental Data Terms of Use.

Official references:

- https://developers.google.com/weathernext/guides/models
- https://developers.google.com/weathernext/guides/earth-engine
- https://developers.google.com/weathernext/guides/gcs
- https://developers.google.com/earth-engine/custom-apps/client-js
