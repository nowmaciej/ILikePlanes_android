package com.ilikeplanes.app.model

data class Metar(
    val icaoId: String? = null,
    val rawOb: String? = null,
    val temp: Double? = null,
    val dewp: Double? = null,
    val windDir: Int? = null,
    val windSpeed: Int? = null,
    val visibility: Double? = null,
    val altimeter: Double? = null,
    val flightCategory: String? = null,
    val wxString: String? = null,
    val lat: Double? = null,
    val lon: Double? = null
)
