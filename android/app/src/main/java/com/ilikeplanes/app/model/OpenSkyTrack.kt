package com.ilikeplanes.app.model

data class OpenSkyTrack(
    val trail: List<TrackPoint> = emptyList(),
    val creditsRemaining: Int? = null,
    val error: String? = null
)

data class TrackPoint(
    val lat: Double,
    val lon: Double,
    val alt: Int?,
    val track: Double?,
    val onGround: Boolean?,
    val ts: Long
)
