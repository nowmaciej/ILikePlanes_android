package com.ilikeplains.app.api

import com.ilikeplains.app.model.Metar

object MetarService {

    suspend fun fetchMetar(lat: Double, lon: Double): List<Metar> {
        val latN = lat + 0.8
        val latS = lat - 0.8
        val lonE = lon + 1.2
        val lonW = lon - 1.2
        val url = "https://aviationweather.gov/api/data/metar?bbox=$latS,$lonW,$latN,$lonE&format=json"

        val arr = HttpService.fetchJsonArray(url, 10000) ?: return emptyList()

        val results = mutableListOf<Metar>()
        for (i in 0 until arr.length()) {
            val obj = arr.getJSONObject(i)
            results.add(
                Metar(
                    icaoId = obj.optString("icaoId", null),
                    rawOb = obj.optString("rawOb", null),
                    temp = obj.optDouble("temp", Double.NaN).let { if (it.isNaN()) null else it },
                    dewp = obj.optDouble("dewp", Double.NaN).let { if (it.isNaN()) null else it },
                    windDir = obj.optInt("windDir", Int.MAX_VALUE).let { if (it == Int.MAX_VALUE) null else it },
                    windSpeed = obj.optInt("windSpeed", Int.MAX_VALUE).let { if (it == Int.MAX_VALUE) null else it },
                    visibility = obj.optDouble("visibility", Double.NaN).let { if (it.isNaN()) null else it },
                    altimeter = obj.optDouble("altimeter", Double.NaN).let { if (it.isNaN()) null else it },
                    flightCategory = obj.optString("flightCategory", null),
                    wxString = obj.optString("wxString", null),
                    lat = obj.optDouble("lat", Double.NaN).let { if (it.isNaN()) null else it },
                    lon = obj.optDouble("lon", Double.NaN).let { if (it.isNaN()) null else it }
                )
            )
        }
        return results
    }
}
