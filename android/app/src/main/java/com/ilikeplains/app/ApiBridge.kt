package com.ilikeplains.app

import android.webkit.WebResourceResponse
import android.webkit.WebView
import com.ilikeplains.app.api.*
import kotlinx.coroutines.*
import java.io.ByteArrayInputStream

class ApiBridge(private val webView: WebView) {

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var pendingResponses = mutableMapOf<String, Deferred<WebResourceResponse?>>()

    fun handleRequest(url: String): WebResourceResponse? {
        val uri = java.net.URI(url)
        val path = uri.path ?: return null
        val query = uri.query ?: ""

        if (!path.startsWith("/api/")) return null

        val deferred = scope.async(Dispatchers.IO) {
            processApiRequest(path, query)
        }

        return runBlocking {
            try {
                withTimeout(30000) {
                    deferred.await()
                }
            } catch (e: Exception) {
                jsonResponse(mapOf("error" to e.message))
            }
        }
    }

    private suspend fun processApiRequest(path: String, query: String): WebResourceResponse? {
        val params = parseQuery(query)

        return when {
            path == "/api/flights" && params.containsKey("lat") -> handleFlights(params)
            path.matches(Regex("/api/flights/[a-fA-F0-9]+")) -> {
                val hex = path.substringAfterLast("/")
                handleFlightByHex(hex)
            }
            path.matches(Regex("/api/routes/[a-fA-F0-9]+")) -> {
                val hex = path.substringAfterLast("/")
                handleRouteByHex(hex)
            }
            path.startsWith("/api/route/") -> {
                val callsign = path.substringAfterLast("/")
                handleRoute(callsign)
            }
            path == "/api/routes-batch" -> handleRoutesBatch(params)
            path == "/api/metar" -> handleMetar(params)
            path == "/api/source" -> handleSource()
            path.startsWith("/api/opensky-track/") -> {
                val hex = path.substringAfterLast("/")
                handleOpenSkyTrack(hex, params)
            }
            path == "/api/health" -> handleHealth()
            else -> jsonResponse(mapOf("error" to "not_found"))
        }
    }

    private suspend fun handleFlights(params: Map<String, String>): WebResourceResponse {
        val lat = params["lat"]?.toDoubleOrNull() ?: return jsonResponse(mapOf("error" to "lat required"), 400)
        val lon = params["lon"]?.toDoubleOrNull() ?: return jsonResponse(mapOf("error" to "lon required"), 400)
        val radius = (params["radius"]?.toIntOrNull() ?: 250).coerceIn(10, 250)

        val nmToDeg = 1.0 / 60.0
        val latDeg = radius * nmToDeg
        val lonDeg = radius * (nmToDeg / Math.cos(Math.toRadians(lat)))
        val minLat = lat - latDeg
        val maxLat = lat + latDeg
        val minLon = lon - lonDeg
        val maxLon = lon + lonDeg

        return try {
            val (flightsData, source) = AdsbService.queryFlights(lat, lon, radius)
            val filtered = flightsData.filter { f ->
                f.lat != null && f.lon != null &&
                f.lat >= minLat && f.lat <= maxLat &&
                f.lon >= minLon && f.lon <= maxLon
            }
            val arr = org.json.JSONArray()
            filtered.forEach { f -> arr.put(flightToJson(f)) }
            jsonResponse(mapOf("flights" to arr, "source" to source))
        } catch (e: Exception) {
            val (flightsData, source) = AdsbService.queryByIcao("/all")
            val filtered = flightsData.filter { f ->
                f.lat != null && f.lon != null &&
                f.lat >= minLat && f.lat <= maxLat &&
                f.lon >= minLon && f.lon <= maxLon
            }
            val arr = org.json.JSONArray()
            filtered.forEach { f -> arr.put(flightToJson(f)) }
            jsonResponse(mapOf("flights" to arr, "source" to source))
        }
    }

    private suspend fun handleFlightByHex(hex: String): WebResourceResponse {
        return try {
            val (flights, source) = AdsbService.queryByIcao(hex)
            val flight = if (flights.isNotEmpty()) flightToJson(flights.first()) else org.json.JSONObject.NULL
            jsonResponse(mapOf("flight" to flight, "source" to source))
        } catch (e: Exception) {
            jsonResponse(mapOf("flight" to org.json.JSONObject.NULL, "source" to "error"), 500)
        }
    }

    private suspend fun handleRouteByHex(hex: String): WebResourceResponse {
        return try {
            val (flights, source) = AdsbService.queryRouteByIcao(hex)
            val route = if (flights.isNotEmpty()) flights.first().route else null
            if (route != null) {
                jsonResponse(mapOf("route" to route, "source" to source))
            } else {
                val (f2, s2) = AdsbService.queryByIcao(hex)
                val r = f2.firstOrNull()?.route
                jsonResponse(mapOf("route" to (r ?: org.json.JSONObject.NULL), "source" to s2))
            }
        } catch (e: Exception) {
            jsonResponse(mapOf("error" to e.message), 500)
        }
    }

    private suspend fun handleRoute(callsign: String): WebResourceResponse {
        return try {
            val result = RouteService.getRouteWithAirports(callsign)
            jsonResponse(mapOf(
                "origin" to airportToJson(result.origin),
                "destination" to airportToJson(result.destination),
                "route" to (result.route ?: org.json.JSONObject.NULL)
            ))
        } catch (e: Exception) {
            jsonResponse(mapOf("error" to e.message), 502)
        }
    }

    private suspend fun handleRoutesBatch(params: Map<String, String>): WebResourceResponse {
        val callsigns = (params["callsigns"] ?: "").split(",").filter { it.isNotBlank() }.take(15)
        val results = RouteService.getRoutesBatch(callsigns)
        val json = org.json.JSONObject()
        results.forEach { (cs, route) ->
            val obj = org.json.JSONObject()
            obj.put("origin", airportToJson(route.origin))
            obj.put("destination", airportToJson(route.destination))
            obj.put("route", route.route ?: org.json.JSONObject.NULL)
            json.put(cs, obj)
        }
        return jsonResponse(json)
    }

    private suspend fun handleMetar(params: Map<String, String>): WebResourceResponse {
        val lat = params["lat"]?.toDoubleOrNull()
        val lon = params["lon"]?.toDoubleOrNull()
        if (lat == null || lon == null) return jsonResponse(mapOf("error" to "lat and lon required"), 400)
        return try {
            val list = MetarService.fetchMetar(lat, lon)
            val arr = org.json.JSONArray()
            list.forEach { m ->
                val obj = org.json.JSONObject()
                obj.put("icaoId", m.icaoId ?: org.json.JSONObject.NULL)
                obj.put("rawOb", m.rawOb ?: org.json.JSONObject.NULL)
                obj.put("temp", m.temp ?: org.json.JSONObject.NULL)
                obj.put("dewp", m.dewp ?: org.json.JSONObject.NULL)
                obj.put("windDir", m.windDir ?: org.json.JSONObject.NULL)
                obj.put("windSpeed", m.windSpeed ?: org.json.JSONObject.NULL)
                obj.put("visibility", m.visibility ?: org.json.JSONObject.NULL)
                obj.put("altimeter", m.altimeter ?: org.json.JSONObject.NULL)
                obj.put("flightCategory", m.flightCategory ?: org.json.JSONObject.NULL)
                obj.put("wxString", m.wxString ?: org.json.JSONObject.NULL)
                obj.put("lat", m.lat ?: org.json.JSONObject.NULL)
                obj.put("lon", m.lon ?: org.json.JSONObject.NULL)
                arr.put(obj)
            }
            jsonResponse(arr)
        } catch (e: Exception) {
            jsonResponse(mapOf("error" to e.message), 502)
        }
    }

    private suspend fun handleSource(): WebResourceResponse {
        return jsonResponse(mapOf(
            "active" to AdsbService.getActiveSource(),
            "sources" to AdsbService.getSources()
        ))
    }

    private suspend fun handleOpenSkyTrack(hex: String, params: Map<String, String>): WebResourceResponse {
        val clientId = params["client_id"] ?: ""
        val clientSecret = params["client_secret"] ?: ""
        val token = OpenSkyService.getToken(clientId, clientSecret)
        if (token == null) return jsonResponse(mapOf("trail" to org.json.JSONArray(), "error" to "no_token"))
        val result = OpenSkyService.fetchTrack(hex, token)

        val trailArr = org.json.JSONArray()
        result.trail.forEach { tp ->
            val pt = org.json.JSONObject()
            pt.put("lat", tp.lat)
            pt.put("lon", tp.lon)
            pt.put("alt", tp.alt ?: org.json.JSONObject.NULL)
            pt.put("track", tp.track ?: org.json.JSONObject.NULL)
            pt.put("onGround", tp.onGround ?: org.json.JSONObject.NULL)
            pt.put("ts", tp.ts)
            trailArr.put(pt)
        }
        val resp = org.json.JSONObject()
        resp.put("trail", trailArr)
        if (result.creditsRemaining != null) resp.put("creditsRemaining", result.creditsRemaining)
        if (result.error != null) resp.put("error", result.error)
        return jsonResponse(resp)
    }

    private suspend fun handleHealth(): WebResourceResponse {
        val healthArr = org.json.JSONArray()
        for (name in AdsbService.getSources()) {
            val status = try {
                val url = AdsbService.getSourceUrl(name)
                if (url != null) {
                    HttpService.fetchString("$url/stats", 5000)
                    "ok"
                } else "unknown"
            } catch (_: Exception) {
                "down"
            }
            val h = org.json.JSONObject()
            h.put("name", name)
            h.put("status", status)
            healthArr.put(h)
        }
        return jsonResponse(mapOf("health" to healthArr, "active" to AdsbService.getActiveSource()))
    }

    fun destroy() {
        scope.cancel()
    }

    private fun parseQuery(query: String): Map<String, String> {
        val map = mutableMapOf<String, String>()
        if (query.isBlank()) return map
        query.split("&").forEach { pair ->
            val parts = pair.split("=", limit = 2)
            if (parts.size == 2) {
                try {
                    map[java.net.URLDecoder.decode(parts[0], "UTF-8")] = java.net.URLDecoder.decode(parts[1], "UTF-8")
                } catch (_: Exception) {}
            }
        }
        return map
    }

    private fun flightToJson(f: com.ilikeplains.app.model.Flight): org.json.JSONObject {
        val obj = org.json.JSONObject()
        obj.put("hex", f.hex)
        obj.put("flight", f.flight)
        obj.put("lat", f.lat ?: org.json.JSONObject.NULL)
        obj.put("lon", f.lon ?: org.json.JSONObject.NULL)
        obj.put("alt_baro", f.altBaro ?: org.json.JSONObject.NULL)
        obj.put("alt_geom", f.altGeom ?: org.json.JSONObject.NULL)
        obj.put("gs", f.gs ?: org.json.JSONObject.NULL)
        obj.put("track", f.track ?: org.json.JSONObject.NULL)
        obj.put("baro_rate", f.baroRate ?: org.json.JSONObject.NULL)
        obj.put("squawk", f.squawk ?: org.json.JSONObject.NULL)
        obj.put("category", f.category ?: org.json.JSONObject.NULL)
        obj.put("r", f.r)
        obj.put("t", f.t)
        obj.put("ownOp", f.ownOp)
        obj.put("seen", f.seen)
        obj.put("dbFlags", f.dbFlags)
        obj.put("emergency", f.emergency ?: org.json.JSONObject.NULL)
        obj.put("origin", f.origin?.let { airportToJson(it) } ?: org.json.JSONObject.NULL)
        obj.put("destination", f.destination?.let { airportToJson(it) } ?: org.json.JSONObject.NULL)
        obj.put("route", f.route ?: org.json.JSONObject.NULL)
        return obj
    }

    private fun airportToJson(a: com.ilikeplains.app.model.Airport?): Any {
        if (a == null) return org.json.JSONObject.NULL
        val obj = org.json.JSONObject()
        obj.put("icao", a.icao ?: org.json.JSONObject.NULL)
        obj.put("iata", a.iata ?: org.json.JSONObject.NULL)
        obj.put("name", a.name ?: org.json.JSONObject.NULL)
        obj.put("lat", a.lat ?: org.json.JSONObject.NULL)
        obj.put("lon", a.lon ?: org.json.JSONObject.NULL)
        obj.put("country", a.country ?: org.json.JSONObject.NULL)
        return obj
    }

    private fun jsonResponse(data: Any, statusCode: Int = 200): WebResourceResponse {
        val json = if (data is org.json.JSONObject || data is org.json.JSONArray) {
            data.toString()
        } else if (data is Map<*, *>) {
            org.json.JSONObject(data as Map<String, Any?>).toString()
        } else {
            data.toString()
        }
        val stream = ByteArrayInputStream(json.toByteArray(Charsets.UTF_8))
        return WebResourceResponse("application/json", "UTF-8", statusCode, "OK", emptyMap(), stream)
    }
}
