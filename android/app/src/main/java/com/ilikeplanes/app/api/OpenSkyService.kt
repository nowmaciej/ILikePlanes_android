package com.ilikeplanes.app.api

import com.ilikeplanes.app.model.OpenSkyTrack
import com.ilikeplanes.app.model.TrackPoint
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

object OpenSkyService {

    private var cachedToken: String? = null
    private var tokenExpiry: Long = 0
    private var tokenClientId: String = ""
    private var lastError: String? = null

    fun getLastError(): String? = lastError

    suspend fun getToken(clientId: String, clientSecret: String): String? = withContext(Dispatchers.IO) {
        if (clientId.isBlank() || clientSecret.isBlank()) {
            lastError = "missing_credentials"
            return@withContext null
        }
        if (cachedToken != null && tokenClientId == clientId && System.currentTimeMillis() < tokenExpiry - 60000) {
            return@withContext cachedToken
        }

        try {
            val postData = "grant_type=client_credentials&client_id=${URLEncoder.encode(clientId, "UTF-8")}&client_secret=${URLEncoder.encode(clientSecret, "UTF-8")}"
            val url = URL("https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.connectTimeout = 10000
            conn.readTimeout = 10000
            conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")

            OutputStreamWriter(conn.outputStream).use { it.write(postData) }

            val status = conn.responseCode
            if (status in 200..299) {
                val body = BufferedReader(InputStreamReader(conn.inputStream)).readText()
                val json = org.json.JSONObject(body)
                cachedToken = json.getString("access_token")
                tokenExpiry = System.currentTimeMillis() + (json.optInt("expires_in", 1800) * 1000L)
                tokenClientId = clientId
                lastError = null
                return@withContext cachedToken
            }
            lastError = "auth HTTP $status"
        } catch (e: Exception) {
            lastError = e.message ?: "auth_error"
        }

        cachedToken = null
        return@withContext null
    }

    suspend fun fetchTrack(hex: String, token: String): OpenSkyTrack {
        val hexLower = hex.lowercase()
        try {
            val url = URL("https://opensky-network.org/api/tracks/all?icao24=$hexLower&time=0")
            val conn = url.openConnection() as HttpURLConnection
            conn.setRequestProperty("Authorization", "Bearer $token")
            conn.connectTimeout = 10000
            conn.readTimeout = 10000

            val status = conn.responseCode
            val creditsRemaining = conn.getHeaderField("x-rate-limit-remaining")?.toIntOrNull()

            if (status in 200..299) {
                val body = BufferedReader(InputStreamReader(conn.inputStream)).readText()
                val json = org.json.JSONObject(body)
                conn.disconnect()
                lastError = null

                if (!json.has("path")) return OpenSkyTrack(creditsRemaining = creditsRemaining)

                val path = json.getJSONArray("path")
                val trail = mutableListOf<TrackPoint>()
                for (i in 0 until path.length()) {
                    val wp = path.getJSONArray(i)
                    val lat = wp.optDouble(1, Double.NaN)
                    val lon = wp.optDouble(2, Double.NaN)
                    if (lat.isNaN() || lon.isNaN()) continue
                    trail.add(
                        TrackPoint(
                            lat = lat,
                            lon = lon,
                            alt = if (wp.length() > 3 && !wp.isNull(3)) Math.round(wp.getDouble(3) * 3.28084).toInt() else null,
                            track = if (wp.length() > 4 && !wp.isNull(4)) wp.getDouble(4) else null,
                            onGround = if (wp.length() > 5 && !wp.isNull(5)) wp.getBoolean(5) else null,
                            ts = (wp.optLong(0, 0L) * 1000)
                        )
                    )
                }
                return OpenSkyTrack(trail = trail, creditsRemaining = creditsRemaining)
            }
            conn.disconnect()
            lastError = "HTTP $status"
        } catch (e: Exception) {
            lastError = e.message ?: "network_error"
        }

        return OpenSkyTrack(error = lastError)
    }
}
