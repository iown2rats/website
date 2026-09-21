package com.mellocrush.app;

import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.http.SslError;
import android.os.Build;
import android.view.Gravity;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.widget.TextView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/**
 * The shell's only activity (docs/ARCHITECTURE.md §28).
 *
 * Capacitor does the work. What is added here is everything needed for a failure to be survivable and legible,
 * because the first device test produced Chromium's "This page couldn't load" with no way to see behind it.
 *
 * Three failures produce that same blank page and they need different answers:
 *
 *   - a failed navigation reaches onReceivedError with a net error code;
 *   - a refused certificate reaches onReceivedSslError;
 *   - the renderer process dying reaches onRenderProcessGone and NONE of the error callbacks. The page paints,
 *     then vanishes. That is the one the sign-in screen was hitting, and it is recovered from rather than
 *     reported, because a rebuilt WebView usually comes back fine.
 */
public class MainActivity extends BridgeActivity {

    /** Where a failure reports itself, as a path, so it is visible in the server's request log. */
    private static final String DIAGNOSTIC_BASE = "https://www.mellocrush.com/__diag/android/";

    /**
     * Renderer deaths survived so far. Static so it outlives the activity that recreate() replaces — without it
     * a page that reliably kills the renderer would restart the app forever instead of ever saying so.
     */
    private static int rendererDeaths = 0;

    private static final int MAX_RENDERER_RECOVERIES = 2;

    private String lastStarted = "nothing yet";
    private String lastFinished = "nothing yet";

    /**
     * Installed from load() rather than onCreate: load() is where BridgeActivity builds the bridge and starts the
     * first navigation, so this is the earliest supported moment to replace the client.
     */
    @Override
    protected void load() {
        super.load();
        Bridge bridge = getBridge();
        if (bridge != null) bridge.setWebViewClient(new DiagnosticWebViewClient(bridge));
    }

    /**
     * Reports an event by requesting a path that does not exist. The response is discarded and failure is
     * ignored: this is a debug build talking to its own server about itself, and nothing about the app should
     * depend on it. No identifiers, no page content — just what went wrong.
     */
    private static void report(String event) {
        new Thread(() -> {
            try {
                URL url = new URL(DIAGNOSTIC_BASE + URLEncoder.encode(event, StandardCharsets.UTF_8.name()));
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("GET");
                conn.setConnectTimeout(5000);
                conn.setReadTimeout(5000);
                conn.getResponseCode();
                conn.disconnect();
            } catch (Exception ignored) {
                // A diagnostic that breaks the app it is diagnosing would be worse than no diagnostic.
            }
        })
            .start();
    }

    /**
     * Capacitor's own client, with failures handled. Everything else — the local server interception that injects
     * the bridge into the remote page, external-link handling, the plugin callbacks — is inherited through super.
     */
    private class DiagnosticWebViewClient extends BridgeWebViewClient {

        private final Bridge bridge;

        DiagnosticWebViewClient(Bridge bridge) {
            super(bridge);
            this.bridge = bridge;
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            super.onPageStarted(view, url, favicon);
            lastStarted = url;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            lastFinished = url;
            // A page that survives to here is a page that loaded, so the recovery budget is returned.
            rendererDeaths = 0;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            super.onReceivedError(view, request, error);
            if (!request.isForMainFrame()) return;
            report("net-" + error.getErrorCode());
            show(view, "Navigation failed", "net error " + error.getErrorCode() + " · " + error.getDescription(), request);
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
            super.onReceivedHttpError(view, request, errorResponse);
            if (!request.isForMainFrame()) return;
            report("http-" + errorResponse.getStatusCode());
            show(view, "Server refused", "HTTP " + errorResponse.getStatusCode(), request);
        }

        /**
         * Reported, never bypassed: a certificate this device does not trust is exactly the kind of thing worth
         * seeing, and proceeding anyway would hand the session to whoever presented it.
         */
        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
            handler.cancel();
            report("ssl-" + error.getPrimaryError());
            show(view, "Certificate rejected", "SSL error " + error.getPrimaryError() + " · " + error.getUrl(), null);
        }

        /**
         * The renderer died. The WebView is unusable from here, so the activity is rebuilt around a fresh one and
         * the site reloaded — a single crash then costs a blink rather than the whole session. The budget exists
         * because a page that kills the renderer every time would otherwise restart the app in a loop forever;
         * once it is spent the app says what happened and stops.
         *
         * Returning true is what keeps the process alive. The default is to let Android kill the app, which to
         * the user is indistinguishable from it closing on its own.
         */
        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            boolean crashed = true;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && detail != null) crashed = detail.didCrash();
            rendererDeaths++;
            report((crashed ? "renderer-crashed-" : "renderer-reclaimed-") + rendererDeaths);

            if (rendererDeaths <= MAX_RENDERER_RECOVERIES) {
                recreate();
                return true;
            }

            TextView message = new TextView(MainActivity.this);
            message.setBackgroundColor(Color.BLACK);
            message.setTextColor(0xFFF4F1EC);
            message.setGravity(Gravity.CENTER);
            message.setPadding(64, 64, 64, 64);
            message.setText(
                "MelloCrush kept stopping\n\n" +
                (crashed ? "the page renderer crashed" : "the system reclaimed the page renderer") +
                " " + rendererDeaths + " times\n\nlast started: " + lastStarted + "\nlast finished: " + lastFinished
            );
            setContentView(message);
            return true;
        }

        private void show(WebView view, String title, String detail, WebResourceRequest request) {
            String address = request != null ? request.getUrl().toString() : bridge.getServerUrl();
            String html =
                "<!doctype html><html><head><meta name='viewport' content='width=device-width, initial-scale=1'>" +
                "<style>" +
                "body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#000;" +
                "color:#f4f1ec;font-family:-apple-system,Roboto,sans-serif;text-align:center}" +
                "main{max-width:22rem}h1{font-size:19px;font-weight:600;margin:0 0 10px}" +
                "p{font-size:13px;line-height:1.55;color:#a09a94;margin:0 0 8px;word-break:break-word}" +
                "code{font-size:12.5px;color:#fd7979}" +
                "a{display:block;margin-top:20px;height:48px;line-height:48px;border-radius:999px;" +
                "background:#fd7979;color:#fff;font-size:15px;font-weight:500;text-decoration:none}" +
                "</style></head><body><main>" +
                "<h1>" + escape(title) + "</h1>" +
                "<p><code>" + escape(detail) + "</code></p>" +
                "<p>" + escape(address) + "</p>" +
                "<p>last finished: " + escape(lastFinished) + "</p>" +
                "<a href='" + escape(bridge.getServerUrl()) + "'>Try again</a>" +
                "</main></body></html>";
            view.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
        }

        /** Enough escaping for text that lands inside an element: the strings here are error text and a URL. */
        private String escape(String value) {
            if (value == null) return "unknown";
            return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("'", "&#39;");
        }
    }
}
