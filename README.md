# I Like Planes

A local flight radar app for Android with real-time ADS-B tracking, a radar map, spotter tools, and multiple data sources. Built as a native Kotlin shell (`MainActivity` + `ApiBridge`) that hosts a WebView UI (Leaflet.js) served from app assets.

## Features

- **Live Flight Tracking** - Real-time aircraft positions within a configurable radius
- **Range & Units** - Radius slider (1-250 NM), range displayed in km or NM (default km)
- **Flight List** - Sortable table with callsign, route, airline, type, altitude, speed, distance, heading
- **Radar Map** - OpenStreetMap + Leaflet with plane markers, your location marker, radius circle, flight trails, airport markers and route polylines
- **Flight Details** - Airline, route with origin/destination and times, altitude, speed, squawk, ADS-B category, ICAO24; bottom sheet in portrait, fullscreen in landscape
- **GPS Compass** - Top-bar compass (rotating dial + fixed heading arrow) shown when GPS mode is active
- **Location Modes** - Auto GPS via native FusedLocationProvider (continuous updates) or manual city search (Nominatim)
- **Session Statistics** - Total flights, unique aircraft, average altitude, max speed, hourly activity chart, top airlines, daily records
- **Weather** - METAR for the nearest airport
- **Multiple Data Sources** - airplanes.live, adsb.lol, adsb.fi, or a local dump1090/readsb receiver with internet fallback
- **OpenSky Network** - Optional route data with API credits monitor and connection error codes
- **8 Color Themes** - Default, Dark, Light, Ocean, Forest, Sunset, Cyber, Radar
- **Night Mode** - Reduced brightness for dark environments
- **Bilingual UI** - English and Polish

## Data Sources

- **airplanes.live** - Free community ADS-B source
- **adsb.lol** - Open-source ADS-B network
- **adsb.fi** - Flight data aggregator
- **Local Receiver** - dump1090/readsb on LAN with internet fallback
- **OpenSky Network** - Flight route data (optional, requires API credentials)

## Architecture

```
I Like Planes (Android)
│
├── android/app/src/main/
│   ├── java/com/ilikeplanes/app/
│   │   ├── MainActivity.kt        # WebView host, GPS (FusedLocationProvider), compass sensor
│   │   ├── SplashActivity.kt      # Launch screen
│   │   ├── ApiBridge.kt           # Intercepts /api/* requests, proxies to services
│   │   └── api/                   # Native services:
│   │       ├── AdsbService.kt     #   ADS-B flight data (airplanes.live, adsb.lol, adsb.fi)
│   │       ├── OpenSkyService.kt  #   OpenSky auth token + flight tracks
│   │       ├── RouteService.kt    #   Route / airport resolution
│   │       ├── MetarService.kt    #   METAR weather
│   │       └── HttpService.kt     #   Shared HTTP client
│   │   └── model/                 # Data classes
│   ├── assets/                    # WebView UI (synced from public/)
│   │   ├── index.html
│   │   ├── styles.css
│   │   ├── app.js                 # Leaflet map, views, settings, i18n
│   │   └── lang/{en,pl}.json
│   └── res/                       # Launcher icons, splash, themes
│
└── public/                        # Frontend source of truth
    ├── index.html
    ├── styles.css
    ├── app.js
    └── lang/{en,pl}.json
```

The frontend lives in `public/` and is copied into `android/app/src/main/assets/` for the app build. **After editing any file in `public/`, sync it to the corresponding file under `android/app/src/main/assets/`.**

## Building

1. Open the `android/` folder in Android Studio.
2. Let Gradle sync (Gradle 8.9, JDK 21+, AGP compatible).
3. Run the `app` configuration on a device/emulator.

Command line:

```bash
cd android
./gradlew assembleDebug
```

The APK is produced at `android/app/build/outputs/apk/debug/app-debug.apk`.

## Permissions

- `INTERNET` - Fetch flight data from network sources
- `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION` - Automatic GPS positioning (used only on-device)

## Privacy

Your location is used only on your device to find aircraft near you. It is never stored or shared with third parties. See [PRIVACY_POLICY.md](PRIVACY_POLICY.md) for details.

## License

MIT
