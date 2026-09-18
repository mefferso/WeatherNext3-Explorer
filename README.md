# WeatherNext 3 Explorer

An LIX-focused browser explorer for **Google WeatherNext 3** experimental ensemble guidance.

The app uses the official WeatherNext 3 Earth Engine surface collection:

`projects/gcp-public-data-weathernext/assets/weathernext_3_0_0_0p1deg`

and runs as a static GitHub Pages site. Users authenticate in the browser with their own Google account; **no service-account private key belongs in this repository**.

## Current products

- 2-m temperature (°F)
- 2-m dewpoint (°F)
- 10-m wind speed (kt)
- QPF (1/3/6/12/24 h, inches)
- Mean sea-level pressure (hPa)
- 1-hour QPF exceedance **probability range** from the published P10/P25/P50/P75/P90 fields

The probability product intentionally reports brackets such as `75–90%` instead of pretending the Earth Engine summary fields provide an exact member-count probability.

### Why no 500-mb height map yet?

WeatherNext 3 pressure-level atmospheric fields and the full 64-member ensemble are published in **Google Cloud Storage as Zarr**, not in the Earth Engine/BigQuery surface summary collections. The first browser release stays scientifically honest: it does not substitute or infer a fake 500-mb field. The raw-ensemble/GCS backend is the next phase and will also enable exact member-count QPF probabilities.

## One-time Google setup

You already need WeatherNext allowlist access. In addition, the browser app requires a Google Cloud project for Earth Engine client-side OAuth.

1. In Google Cloud Console, select/create a project.
2. Enable **Earth Engine API**.
3. Register the project for Earth Engine if Google requests it.
4. Configure the OAuth consent screen.
5. Create an **OAuth 2.0 Client ID → Web application**.
6. Add your GitHub Pages origin to **Authorized JavaScript origins**, e.g. `https://mefferso.github.io`.
7. Enable **Maps JavaScript API**.
8. Create a Maps API key and restrict it to your GitHub Pages referrer, e.g. `https://mefferso.github.io/WeatherNext3-Explorer/*`.
9. Open the Explorer, click **Setup**, enter the Cloud project ID, OAuth Web Client ID, and Maps JavaScript API key.
10. Connect using the same Google account approved for WeatherNext.

These values are stored in your browser's `localStorage`; they are not committed to GitHub.

## Scientific notes

- WeatherNext 3 0.1° surface output is about 11 km and is ensemble guidance, not a point forecast.
- Synoptic 00/06/12/18 UTC initializations extend to 360 h; interim hourly initializations extend to 48 h.
- Multi-hour QPF is produced by summing **hourly ensemble-mean precipitation**. The UI locks the statistic to Mean because summing P10/P50/P90 at each hour does **not** equal the percentile of the accumulated precipitation distribution.
- The QPF probability-range layer uses the published precipitation quantiles to state only what those quantiles support.
- Click the map for a point sample of the currently displayed field.

## Local testing

Because OAuth does not work correctly from `file://`, serve the repo locally:

```bash
python -m http.server 8000
```

Then add `http://localhost:8000` as an OAuth authorized JavaScript origin and open `http://localhost:8000`.

## Data / attribution

WeatherNext 3 is experimental guidance from Google DeepMind and Google Research. Real-time and historical data have different applicable terms. Follow the current WeatherNext terms and attribution requirements. This explorer is not an official NWS forecast or warning.

Official references:

- https://developers.google.com/weathernext/guides/models
- https://developers.google.com/weathernext/guides/earth-engine
- https://developers.google.com/earth-engine/custom-apps/client-js
