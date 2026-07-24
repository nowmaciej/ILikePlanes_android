# FlightRadar Local

A local flight radar application with real-time ADS-B tracking, spotter tools, and multiple data sources.

## Features

- **Live Flight Tracking** - Real-time aircraft positions within configurable radius (10-250 NM)
- **Flight Details** - Airline, route, altitude, speed, squawk, ADS-B category, aircraft photos
- **Spotter Tools** - Compass bearing, elevation angle, flyover predictions
- **Multiple Views** - Flight list, radar map, session statistics
- **Screensaver Mode** - Aircraft tracking visualization with clock and weather
- **7 Color Themes** - Default, Dark, Light, Ocean, Forest, Sunset, Cyberpunk
- **Night Mode** - Reduced brightness for dark environments
- **Bilingual UI** - English and Polish language support
- **Touch Optimized** - Responsive design for touchscreen devices

## Data Sources

- **airplanes.live** - Free community ADS-B source
- **adsb.lol** - Open-source ADS-B network
- **adsb.fi** - Flight data aggregator
- **Local Receiver** - dump1090/readsb on LAN with internet fallback

## Installation

```bash
# Clone repository
git clone <repository-url>
cd FlightRadarLocal

# Install dependencies
npm install

# Start server
npm start
```

Open http://localhost:3000 in your browser.

## Configuration

### Environment Variables

- `PORT` - Server port (default: 3000)

### Settings Menu

Access via gear icon in top-right corner:

- **Language** - English or Polish
- **Units** - Metric (km/h, meters) or Imperial (knots, feet)
- **Radius** - Tracking radius 10-250 NM
- **Refresh Rate** - Data update interval (5-30 seconds)
- **Night Mode** - Reduced brightness theme
- **Color Theme** - 7 available themes
- **Screensaver Timeout** - Idle time before screensaver (0=off, 1-10 min)
- **Local Receiver** - Enable/disable local ADS-B receiver
- **Receiver URL** - Local receiver address (e.g., http://192.168.1.100)
- **FlightAware API Key** - Optional key for enhanced flight data

## Project Structure

```
FlightRadarLocal/
├── server.js          # Express backend with ADS-B API proxy
├── package.json       # Node.js configuration
├── .gitignore         # Git ignore rules
├── README.md          # This file
├── req.txt            # Original requirements
└── public/
    ├── index.html     # Main HTML with all views
    ├── styles.css     # CSS with 7 themes and night mode
    ├── app.js         # Frontend JavaScript application
    └── lang/
        ├── en.json    # English translations
        └── pl.json    # Polish translations
```

## API Endpoints

- `GET /api/flights?lat={lat}&lon={lon}&radius={nm}` - Flights in area
- `GET /api/flights/:hex` - Specific aircraft details
- `GET /api/routes/:hex` - Flight route information
- `GET /api/source` - Current active data source
- `GET /api/health` - System health check

## Browser Support

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers with geolocation support

## License

MIT