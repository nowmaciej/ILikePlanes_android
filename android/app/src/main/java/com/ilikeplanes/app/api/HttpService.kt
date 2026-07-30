package com.ilikeplanes.app.api

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

object HttpService {

    suspend fun fetchString(url: String, timeoutMs: Int = 8000): String = withContext(Dispatchers.IO) {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = timeoutMs
        conn.readTimeout = timeoutMs
        conn.setRequestProperty("User-Agent", "I Like Planes/1.0")
        try {
            conn.connect()
            val status = conn.responseCode
            if (status in 200..299) {
                val reader = BufferedReader(InputStreamReader(conn.inputStream))
                reader.readText()
            } else {
                throw Exception("HTTP $status")
            }
        } finally {
            conn.disconnect()
        }
    }

    suspend fun fetchJson(url: String, timeoutMs: Int = 8000): org.json.JSONObject? = withContext(Dispatchers.IO) {
        try {
            val raw = fetchString(url, timeoutMs)
            org.json.JSONObject(raw)
        } catch (e: Exception) {
            null
        }
    }

    suspend fun fetchJsonArray(url: String, timeoutMs: Int = 8000): org.json.JSONArray? = withContext(Dispatchers.IO) {
        try {
            val raw = fetchString(url, timeoutMs)
            org.json.JSONArray(raw)
        } catch (e: Exception) {
            null
        }
    }
}
