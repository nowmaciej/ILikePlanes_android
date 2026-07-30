package com.ilikeplanes.app.model

data class Airport(
    val icao: String? = null,
    val iata: String? = null,
    val name: String? = null,
    val lat: Double? = null,
    val lon: Double? = null,
    val country: String? = null
)
