package com.ilikeplanes.app.api

import com.ilikeplanes.app.model.Airport
import com.ilikeplanes.app.model.RouteInfo

object RouteService {

    private val routeCache = mutableMapOf<String, RouteInfo?>()
    private val airportCache = mutableMapOf<String, Airport?>()

    suspend fun lookupRoute(callsign: String): RouteInfo? {
        val key = callsign.trim().uppercase()
        if (key.isEmpty()) return null
        routeCache[key]?.let { return it }

        try {
            val json = HttpService.fetchJson("https://hexdb.io/api/v1/route/icao/$key", 5000)
            if (json != null && json.has("route")) {
                val routeStr = json.getString("route")
                val parts = routeStr.split("-")
                val result = RouteInfo(
                    origin = if (parts.size > 0) Airport(icao = parts[0]) else null,
                    destination = if (parts.size > 1) Airport(icao = parts[1]) else null,
                    route = routeStr
                )
                routeCache[key] = result
                return result
            }
        } catch (_: Exception) {}

        routeCache[key] = null
        return null
    }

    suspend fun lookupAirport(icao: String): Airport? {
        if (icao.isBlank()) return null
        val code = icao.trim().uppercase()
        airportCache[code]?.let { return it }

        try {
            val json = HttpService.fetchJson("https://hexdb.io/api/v1/airport/icao/$code", 5000)
            if (json != null) {
                val info = Airport(
                    icao = code,
                    iata = json.optString("iata", ""),
                    name = json.optString("airport", null),
                    lat = if (json.has("latitude")) json.optDouble("latitude", Double.NaN).let { if (it.isNaN()) null else it } else null,
                    lon = if (json.has("longitude")) json.optDouble("longitude", Double.NaN).let { if (it.isNaN()) null else it } else null,
                    country = json.optString("country_code", null)
                )
                airportCache[code] = info
                return info
            }
        } catch (_: Exception) {}

        airportCache[code] = null
        return null
    }

    suspend fun getRouteWithAirports(callsign: String): RouteInfo {
        val routeInfo = lookupRoute(callsign) ?: return RouteInfo()
        val originInfo = routeInfo.origin?.icao?.let { lookupAirport(it) }
        val destInfo = routeInfo.destination?.icao?.let { lookupAirport(it) }

        return RouteInfo(
            origin = originInfo ?: routeInfo.origin,
            destination = destInfo ?: routeInfo.destination,
            route = routeInfo.route
        )
    }

    suspend fun getRoutesBatch(callsigns: List<String>): Map<String, RouteInfo> {
        val results = mutableMapOf<String, RouteInfo>()
        for (cs in callsigns.take(15)) {
            val routeInfo = getRouteWithAirports(cs)
            if (routeInfo.origin != null || routeInfo.destination != null) {
                results[cs.trim().uppercase()] = routeInfo
            }
        }
        return results
    }
}
