package com.ilikeplains.app.model

data class Flight(
    val hex: String = "",
    val flight: String = "",
    val lat: Double? = null,
    val lon: Double? = null,
    val altBaro: Int? = null,
    val altGeom: Int? = null,
    val gs: Double? = null,
    val track: Double? = null,
    val baroRate: Int? = null,
    val squawk: String? = null,
    val category: String? = null,
    val r: String = "",
    val t: String = "",
    val ownOp: String = "",
    val origin: Airport? = null,
    val destination: Airport? = null,
    val route: String? = null,
    val emergency: String? = null,
    val seen: Int = 0,
    val dbFlags: Int = 0
)
