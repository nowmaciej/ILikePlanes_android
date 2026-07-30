package com.ilikeplanes.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationServices

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var apiBridge: ApiBridge
    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private lateinit var sensorManager: SensorManager
    private var currentLocation: Location? = null
    private var locationPermissionRequested = false
    private var deviceHeading = 0f
    private val rotationMatrix = FloatArray(9)
    private val orientationAngles = FloatArray(3)

    private val sensorListener = object : SensorEventListener {
        override fun onSensorChanged(event: SensorEvent) {
            if (event.sensor.type == Sensor.TYPE_ROTATION_VECTOR) {
                SensorManager.getRotationMatrixFromVector(rotationMatrix, event.values)
                SensorManager.getOrientation(rotationMatrix, orientationAngles)
                deviceHeading = Math.toDegrees(orientationAngles[0].toDouble()).toFloat()
                    .let { if (it < 0) it + 360f else it }
            }
        }
        override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
    }

    private val locationPermissionRequest = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val fine = permissions[Manifest.permission.ACCESS_FINE_LOCATION] ?: false
        val coarse = permissions[Manifest.permission.ACCESS_COARSE_LOCATION] ?: false
        if (fine || coarse) {
            getLastLocation()
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        WindowCompat.setDecorFitsSystemWindows(window, false)
        @Suppress("DEPRECATION")
        window.statusBarColor = android.graphics.Color.TRANSPARENT
        @Suppress("DEPRECATION")
        window.navigationBarColor = android.graphics.Color.TRANSPARENT

        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)
        sensorManager = getSystemService(SENSOR_SERVICE) as SensorManager

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.setGeolocationEnabled(true)
            settings.cacheMode = android.webkit.WebSettings.LOAD_DEFAULT
            settings.allowFileAccess = true
            settings.allowContentAccess = true
            settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            settings.textZoom = 100
            settings.loadWithOverviewMode = true
            settings.useWideViewPort = true
            settings.builtInZoomControls = true
            settings.displayZoomControls = false

            addJavascriptInterface(LocationJSInterface(), "AndroidLocation")

            webViewClient = object : WebViewClient() {
                private val assetLoader = WebViewAssetLoader.Builder()
                    .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this@MainActivity))
                    .setDomain("ilikeplanes.local")
                    .build()

                override fun shouldInterceptRequest(
                    view: WebView?,
                    request: WebResourceRequest?
                ): WebResourceResponse? {
                    val uri = request?.url ?: return null
                    val url = uri.toString()

                    if (url.contains("/api/")) {
                        val response = apiBridge.handleRequest(url)
                        if (response != null) return response
                    }

                    if (url.startsWith("https://ilikeplanes.local/assets/")) {
                        return assetLoader.shouldInterceptRequest(uri)
                    }

                    return null
                }

                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                    val url = request?.url?.toString() ?: return false
                    return if (url.startsWith("https://ilikeplanes.local/")) {
                        false
                    } else {
                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                        startActivity(intent)
                        true
                    }
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    injectSavedLocation()
                    if (currentLocation == null) showLocationLoading()
                    webView.post { ViewCompat.requestApplyInsets(window.decorView) }
                }
            }

            loadUrl("https://ilikeplanes.local/assets/index.html")
        }

        apiBridge = ApiBridge(webView)

        val root = FrameLayout(this).apply {
            addView(webView, FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            ))
            ViewCompat.setOnApplyWindowInsetsListener(this) { _, insets ->
                val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
                webView.setPadding(bars.left, bars.top, bars.right, bars.bottom)
                if (bars.top > 0) {
                    webView.evaluateJavascript(
                        "document.documentElement.style.setProperty('--safe-top','${bars.top}px')", null
                    )
                }
                insets
            }
        }

        setContentView(root)

        loadLastLocation()
        requestLocationPermission()

        onBackPressedDispatcher.addCallback(
            this,
            object : androidx.activity.OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    handleBackPress()
                }
            }
        )
    }

    private var backPressedTime = 0L
    private fun handleBackPress() {
        webView.evaluateJavascript("handleBack();") { result ->
            val handled = result?.trim()?.trim('"') == "true"
            if (!handled) {
                val now = System.currentTimeMillis()
                if (now - backPressedTime < 2000) {
                    finish()
                } else {
                    backPressedTime = now
                    showExitToast()
                }
            }
        }
    }

    private fun showExitToast() {
        webView.evaluateJavascript("""
            (function() {
                try {
                    var el = document.getElementById('exit-toast');
                    if (!el) {
                        el = document.createElement('div');
                        el.id = 'exit-toast';
                        el.style.cssText = 'position:fixed;bottom:36px;left:50%;transform:translateX(-50%);background:var(--bg2,rgba(13,17,23,0.9));color:var(--fg2,#aaa);padding:10px 20px;border-radius:24px;font-size:14px;z-index:99999;backdrop-filter:blur(12px);border:1px solid var(--border2,rgba(255,255,255,0.12));white-space:nowrap;pointer-events:none;transition:opacity .3s;';
                        document.body.appendChild(el);
                    }
                    el.textContent = (typeof window.t === 'function') ? window.t('main.exitToast') : '\u23F2 Press again to close';
                    el.style.display = '';
                    el.style.opacity = '1';
                    setTimeout(function() { el.style.opacity = '0'; }, 1800);
                } catch(e) {}
            })();
        """.trimIndent(), null)
    }

    override fun onResume() {
        super.onResume()
        sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)?.let {
            sensorManager.registerListener(sensorListener, it, SensorManager.SENSOR_DELAY_UI)
        }
    }

    override fun onPause() {
        super.onPause()
        sensorManager.unregisterListener(sensorListener)
    }

    private fun requestLocationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            getLastLocation()
            return
        }

        val fine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
        val coarse = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION)

        if (fine == PackageManager.PERMISSION_GRANTED || coarse == PackageManager.PERMISSION_GRANTED) {
            getLastLocation()
            return
        }

        if (shouldShowRequestPermissionRationale(Manifest.permission.ACCESS_FINE_LOCATION) ||
            shouldShowRequestPermissionRationale(Manifest.permission.ACCESS_COARSE_LOCATION)) {
            AlertDialog.Builder(this)
                .setTitle(R.string.location_permission_dialog_title)
                .setMessage(R.string.location_permission_dialog_message)
                .setPositiveButton(android.R.string.ok) { _, _ ->
                    showLocationLoading()
                    locationPermissionRequest.launch(
                        arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
                    )
                }
                .setNegativeButton(android.R.string.cancel, null)
                .show()
        } else if (!locationPermissionRequested) {
            locationPermissionRequested = true
            locationPermissionRequest.launch(
                arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
            )
        }
    }

    @SuppressLint("MissingPermission")
    private fun getLastLocation() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            return
        }
        showLocationLoading()
        fusedLocationClient.lastLocation.addOnSuccessListener { location ->
            if (location != null) {
                currentLocation = location
                saveLastLocation()
                injectLocationState()
            }
            hideLocationLoading()
        }
        fusedLocationClient.lastLocation.addOnFailureListener {
            hideLocationLoading()
        }
    }

    private fun injectLocationState() {
        val lat = currentLocation?.latitude ?: 52.2297
        val lon = currentLocation?.longitude ?: 21.0122
        webView.evaluateJavascript("""
            (function() {
                try {
                    if (window.state) {
                    window.state.position = { lat: $lat, lon: $lon };
                    if (typeof window.fetchFlights === 'function') window.fetchFlights();
                    }
                } catch(e) {}
            })();
        """.trimIndent(), null)
    }

    private fun injectSavedLocation() {
        if (currentLocation == null) {
            currentLocation = Location("").apply {
                latitude = 52.2297
                longitude = 21.0122
            }
        }
        webView.evaluateJavascript("window.state && window.state.position != null") { hasPosition ->
            if (hasPosition != "true") injectLocationState()
            hideLocationLoading()
        }

        val insetTop = run {
            val insets = WindowInsetsCompat.toWindowInsetsCompat(window.decorView.rootWindowInsets, window.decorView)
            insets.getInsets(WindowInsetsCompat.Type.systemBars()).top
        }
        if (insetTop > 0) {
            webView.evaluateJavascript("""
                (function() {
                    try { document.documentElement.style.setProperty('--safe-top', '${insetTop}px'); } catch(e) {}
                })();
            """.trimIndent(), null)
        }
    }

    private fun saveLastLocation() {
        val loc = currentLocation ?: return
        getSharedPreferences("location", 0).edit()
            .putFloat("lat", loc.latitude.toFloat())
            .putFloat("lon", loc.longitude.toFloat())
            .apply()
    }

    private fun loadLastLocation() {
        val prefs = getSharedPreferences("location", 0)
        val lat = prefs.getFloat("lat", 0f).toDouble()
        val lon = prefs.getFloat("lon", 0f).toDouble()
        if (lat != 0.0 || lon != 0.0) {
            currentLocation = Location("").apply {
                this.latitude = lat
                this.longitude = lon
            }
        }
    }

    private fun showLocationLoading() {
        webView.evaluateJavascript("try { window.updateLocationStatus('waiting'); } catch(e) {}", null)
    }

    private fun hideLocationLoading() {
        webView.evaluateJavascript("try { window.updateLocationStatus('ok', 3000); } catch(e) {}", null)
        webView.postDelayed({ webView.evaluateJavascript("try { window.updateLocationStatus('clear'); } catch(e) {}", null) }, 3500)
    }

    override fun onDestroy() {
        apiBridge.destroy()
        super.onDestroy()
    }

    inner class LocationJSInterface {
        @android.webkit.JavascriptInterface
        fun getLatitude(): Double = currentLocation?.latitude ?: 52.2297

        @android.webkit.JavascriptInterface
        fun getLongitude(): Double = currentLocation?.longitude ?: 21.0122

        @android.webkit.JavascriptInterface
        fun isLocationAvailable(): Boolean = currentLocation != null

        @android.webkit.JavascriptInterface
        fun getDeviceHeading(): Float = deviceHeading
    }
}
