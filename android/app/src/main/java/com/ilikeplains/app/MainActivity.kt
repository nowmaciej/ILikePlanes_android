package com.ilikeplains.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
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
    private var currentLocation: Location? = null
    private var locationPermissionRequested = false

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

        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
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
                    .setDomain("ilikeplains.local")
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

                    if (url.startsWith("https://ilikeplains.local/assets/")) {
                        return assetLoader.shouldInterceptRequest(uri)
                    }

                    return null
                }

                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                    val url = request?.url?.toString() ?: return false
                    return if (url.startsWith("https://ilikeplains.local/")) {
                        false
                    } else {
                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                        startActivity(intent)
                        true
                    }
                }
            }

            loadUrl("https://ilikeplains.local/assets/index.html")
        }

        apiBridge = ApiBridge(webView)
        setContentView(webView)

        val statusBarHeight = run {
            val id = resources.getIdentifier("status_bar_height", "dimen", "android")
            if (id > 0) resources.getDimensionPixelSize(id) else 0
        }

        webView.setPadding(0, statusBarHeight, 0, 0)

        ViewCompat.setOnApplyWindowInsetsListener(webView) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }

        requestLocationPermission()
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
        fusedLocationClient.lastLocation.addOnSuccessListener { location ->
            if (location != null) {
                currentLocation = location
                injectLocationState()
            }
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
                        window.state.locationMode = 'auto';
                        if (typeof window.fetchFlights === 'function') window.fetchFlights();
                    }
                } catch(e) {}
            })();
        """.trimIndent(), null)
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
    }
}
