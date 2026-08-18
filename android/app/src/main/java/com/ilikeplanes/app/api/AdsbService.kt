package com.ilikeplanes.app.api

import com.ilikeplanes.app.model.Flight

object AdsbService {

    data class AdsbSource(val name: String, val url: String, val endpoint: String, val priority: Int)

    private val sources = listOf(
        AdsbSource("airplanes.live", "https://api.airplanes.live/v2", "/point/{lat}/{lon}/{dist}", 1),
        AdsbSource("adsb.lol", "https://api.adsb.lol/v2", "/lat/{lat}/lon/{lon}/dist/{dist}", 2),
        AdsbSource("adsb.fi", "https://opendata.adsb.fi/api/v3", "/lat/{lat}/lon/{lon}/dist/{dist}", 3)
    )

    private var activeSource: String = sources.first().name

    suspend fun queryFlights(lat: Double, lon: Double, dist: Int): Pair<List<Flight>, String> {
        val sorted = sources.sortedBy { it.priority }
        val errors = mutableListOf<String>()

        for (source in sorted) {
            try {
                val url = buildUrl(source, lat, lon, dist)
                val raw = HttpService.fetchString(url)
                val flights = parseResponse(raw)
                activeSource = source.name
                return Pair(flights, source.name)
            } catch (e: Exception) {
                errors.add("${source.name}: ${e.message}")
            }
        }
        throw Exception("All ADS-B sources failed: $errors")
    }

    suspend fun queryByIcao(hex: String): Pair<List<Flight>, String> {
        val sorted = sources.sortedBy { it.priority }
        val errors = mutableListOf<String>()

        for (source in sorted) {
            try {
                val url = "${source.url}/icao/$hex"
                val raw = HttpService.fetchString(url)
                val flights = parseResponse(raw)
                if (flights.isNotEmpty()) {
                    activeSource = source.name
                    return Pair(flights, source.name)
                }
            } catch (e: Exception) {
                errors.add("${source.name}: ${e.message}")
            }
        }
        throw Exception("All ADS-B sources failed: $errors")
    }

    suspend fun queryRouteByIcao(hex: String): Pair<List<Flight>, String> {
        val sorted = sources.sortedBy { it.priority }
        val errors = mutableListOf<String>()

        for (source in sorted) {
            try {
                val url = "${source.url}/icao/$hex/route"
                val raw = HttpService.fetchString(url)
                val flights = parseResponse(raw)
                if (flights.isNotEmpty()) {
                    activeSource = source.name
                    return Pair(flights, source.name)
                }
            } catch (e: Exception) {
                errors.add("${source.name}: ${e.message}")
            }
        }
        throw Exception("All ADS-B sources failed: $errors")
    }

    private fun buildUrl(source: AdsbSource, lat: Double, lon: Double, dist: Int): String {
        val endpoint = source.endpoint
            .replace("{lat}", lat.toString())
            .replace("{lon}", lon.toString())
            .replace("{dist}", dist.toString())
        return "${source.url}$endpoint"
    }

    private fun parseResponse(raw: String): List<Flight> {
        val json = org.json.JSONObject(raw)
        val arr = when {
            json.has("ac") -> json.getJSONArray("ac")
            json.has("aircraft") -> json.getJSONArray("aircraft")
            else -> return emptyList()
        }

        val flights = mutableListOf<Flight>()
        for (i in 0 until arr.length()) {
            val obj = arr.getJSONObject(i)
            flights.add(normalize(obj))
        }
        return flights
    }

    private fun normalize(obj: org.json.JSONObject): Flight {
        return Flight(
            hex = obj.optString("hex", "") + obj.optString("icao", ""),
            flight = (obj.optString("flight", "") + obj.optString("callsign", "")).trim(),
            lat = if (obj.has("lat") && !obj.isNull("lat")) obj.getDouble("lat") else null,
            lon = if (obj.has("lon") && !obj.isNull("lon")) obj.getDouble("lon") else null,
            altBaro = if (obj.has("alt_baro")) obj.optInt("alt_baro", -1).let { if (it < 0) null else it }
                else if (obj.has("altitude")) obj.optInt("altitude", -1).let { if (it < 0) null else it } else null,
            gs = if (obj.has("gs")) obj.optDouble("gs", Double.NaN).let { if (it.isNaN()) null else it }
                else if (obj.has("ground_speed")) obj.optDouble("ground_speed", Double.NaN).let { if (it.isNaN()) null else it } else null,
            track = if (obj.has("track")) obj.optDouble("track", Double.NaN).let { if (it.isNaN()) null else it }
                else if (obj.has("heading")) obj.optDouble("heading", Double.NaN).let { if (it.isNaN()) null else it } else null,
            baroRate = if (obj.has("baro_rate")) obj.optInt("baro_rate", Int.MAX_VALUE).let { if (it == Int.MAX_VALUE) null else it }
                else if (obj.has("vertical_rate")) obj.optInt("vertical_rate", Int.MAX_VALUE).let { if (it == Int.MAX_VALUE) null else it } else null,
            squawk = if (obj.has("squawk") && !obj.isNull("squawk")) obj.getString("squawk") else null,
            category = if (obj.has("category") && !obj.isNull("category")) obj.getString("category") else null,
            r = obj.optString("r", "") + obj.optString("registration", ""),
            t = obj.optString("t", "") + obj.optString("type", ""),
            ownOp = obj.optString("ownOp", "") + obj.optString("airline", ""),
            seen = obj.optInt("seen", 0),
            dbFlags = obj.optInt("dbFlags", 0)
        )
    }

    fun getSources(): List<String> = sources.map { it.name }
    fun getActiveSource(): String = activeSource
    fun getSourceUrl(name: String): String? = sources.find { it.name == name }?.url
}
