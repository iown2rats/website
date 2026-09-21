package com.mellocrush.app;

import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.widget.ScrollView;
import android.widget.TextView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

/**
 * The shell's only activity (docs/ARCHITECTURE.md §28).
 *
 * This build changes no application behaviour. It only watches, because four attempts at the real fault were
 * made without ever seeing it, and every one of them was a guess.
 *
 * The lesson from the last build is written into the design here: it instrumented the three WebViewClient error
 * callbacks and recorded nothing, twice. Silence was indistinguishable from "no fault", so the absence of a
 * report taught us nothing. Two things follow.
 *
 *   - A WATCHDOG. If the page has not finished loading within fifteen seconds, that silence is itself recorded
 *     and reported. The failure mode that defeated the last build — nothing firing at all — now produces
 *     evidence rather than an empty log.
 *   - NO RECOVERY. The previous build called recreate() on a dead renderer, which risked restarting the app
 *     faster than it could report. Nothing here restarts, reloads or recreates. A diagnostic that perturbs what
 *     it measures is worth less than no diagnostic.
 */
public class MainActivity extends BridgeActivity {

    /** How long a load may take before its silence is treated as the finding. */
    private static final long WATCHDOG_MS = 15_000L;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private Runnable watchdog;
    private boolean trailShown = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Before anything else in the process, so that whatever happens next is already being recorded.
        Diagnostics.start(this);
        Diagnostics.breadcrumb("onCreate");
        super.onCreate(savedInstanceState);
        Diagnostics.breadcrumb("onCreate returned");
        // Anything the previous run left undelivered goes out now, while this process is alive and settled.
        Diagnostics.deliver("launch");
    }

    @Override
    protected void load() {
        Diagnostics.breadcrumb("load start");
        super.load();
        Bridge bridge = getBridge();
        if (bridge == null) {
            Diagnostics.breadcrumb("load: bridge is null");
            return;
        }
        bridge.setWebViewClient(new RecordingWebViewClient(bridge));
        Diagnostics.breadcrumb("load: client installed, serverUrl=" + bridge.getServerUrl());
        armWatchdog();
    }

    /** Fifteen seconds of nothing is a result, and this is what turns it into one. */
    private void armWatchdog() {
        cancelWatchdog();
        watchdog = () -> {
            Diagnostics.breadcrumb("WATCHDOG: no page finished after " + WATCHDOG_MS + "ms");
            Diagnostics.deliver("watchdog");
            showTrail("Nothing completed");
        };
        handler.postDelayed(watchdog, WATCHDOG_MS);
    }

    private void cancelWatchdog() {
        if (watchdog != null) handler.removeCallbacks(watchdog);
        watchdog = null;
    }

    @Override
    public void onStop() {
        Diagnostics.breadcrumb("onStop");
        super.onStop();
    }

    @Override
    public void onDestroy() {
        Diagnostics.breadcrumb("onDestroy finishing=" + isFinishing());
        super.onDestroy();
    }

    /**
     * The recorded trail, on screen, for the case where the network is the thing that is broken. Shown once: a
     * screen that keeps rebuilding itself would be its own kind of loop.
     */
    private void showTrail(String title) {
        if (trailShown) return;
        trailShown = true;
        cancelWatchdog();

        TextView text = new TextView(this);
        text.setBackgroundColor(Color.BLACK);
        text.setTextColor(0xFFF4F1EC);
        text.setTextIsSelectable(true);
        text.setPadding(48, 96, 48, 96);
        text.setTextSize(11f);
        text.setText(title + "\n\n" + Diagnostics.trail());

        ScrollView scroller = new ScrollView(this);
        scroller.setBackgroundColor(Color.BLACK);
        scroller.addView(text);
        setContentView(scroller);
    }

    /**
     * Capacitor's own client with every callback recorded. Nothing is intercepted or altered — the local server
     * interception that injects the bridge, external-link handling and the plugin callbacks all run through
     * super exactly as before.
     */
    private class RecordingWebViewClient extends BridgeWebViewClient {

        RecordingWebViewClient(Bridge bridge) {
            super(bridge);
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            Diagnostics.breadcrumb("pageStarted " + url);
            super.onPageStarted(view, url, favicon);
        }

        @Override
        public void onPageCommitVisible(WebView view, String url) {
            Diagnostics.breadcrumb("pageCommitVisible " + url);
            super.onPageCommitVisible(view, url);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            Diagnostics.breadcrumb("pageFinished " + url + " progress=" + view.getProgress());
            super.onPageFinished(view, url);
            cancelWatchdog();
            // Delivered on a load that worked too: a successful run is the control this investigation lacks.
            Diagnostics.deliver("page-finished");
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            Diagnostics.breadcrumb(
                (request.isForMainFrame() ? "MAIN-FRAME error " : "subresource error ") +
                error.getErrorCode() + " " + error.getDescription() + " " + request.getUrl()
            );
            super.onReceivedError(view, request, error);
            if (!request.isForMainFrame()) return;
            Diagnostics.deliver("net-error");
            showTrail("Navigation failed");
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
            Diagnostics.breadcrumb(
                (request.isForMainFrame() ? "MAIN-FRAME http " : "subresource http ") +
                errorResponse.getStatusCode() + " " + request.getUrl()
            );
            super.onReceivedHttpError(view, request, errorResponse);
            if (!request.isForMainFrame()) return;
            Diagnostics.deliver("http-error");
            showTrail("Server refused");
        }

        /** Reported and cancelled, never proceeded through. */
        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler sslHandler, SslError error) {
            Diagnostics.breadcrumb("SSL error " + error.getPrimaryError() + " " + error.getUrl());
            sslHandler.cancel();
            Diagnostics.deliver("ssl-error");
            showTrail("Certificate rejected");
        }

        /**
         * The renderer died. Recorded and reported, and then the app stops — no rebuild, no reload. Returning
         * true keeps this process alive, which is what lets the report finish sending and the trail be read.
         */
        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            String cause = "renderer gone";
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && detail != null) {
                cause = detail.didCrash()
                    ? "RENDERER CRASHED"
                    : "RENDERER KILLED BY SYSTEM (priority " + detail.rendererPriorityAtExit() + ")";
            }
            Diagnostics.breadcrumb(cause);
            Diagnostics.deliver("renderer-gone");
            showTrail(cause);
            return true;
        }
    }
}
