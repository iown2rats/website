package com.mellocrush.app;

import android.net.http.SslError;
import android.os.Bundle;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

/**
 * The shell's only activity (docs/ARCHITECTURE.md §28).
 *
 * Capacitor does everything; the one thing added here is a legible failure. When the WebView cannot show
 * https://www.mellocrush.com it falls back to Chromium's own "This page couldn't load", which names neither the
 * error nor the address — and on a phone, with no desktop to attach chrome://inspect to, that page is the end of
 * the investigation. The client below keeps every Capacitor behaviour and overrides only the three error
 * callbacks, so a failure states its own cause on screen.
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Bridge bridge = getBridge();
        bridge.setWebViewClient(new DiagnosticWebViewClient(bridge));
    }

    /**
     * Capacitor's own client, with failures made visible. Everything else — the local server interception that
     * injects the bridge into the remote page, external-link handling, the plugin callbacks — is inherited
     * untouched via `super`.
     */
    private static class DiagnosticWebViewClient extends BridgeWebViewClient {

        private final Bridge bridge;

        DiagnosticWebViewClient(Bridge bridge) {
            super(bridge);
            this.bridge = bridge;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            super.onReceivedError(view, request, error);
            if (!request.isForMainFrame()) return;
            show(view, "Network error", "code " + error.getErrorCode() + " · " + error.getDescription(), request);
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
            super.onReceivedHttpError(view, request, errorResponse);
            if (!request.isForMainFrame()) return;
            show(view, "Server error", "HTTP " + errorResponse.getStatusCode(), request);
        }

        /**
         * Reported, never bypassed: a certificate this device does not trust is exactly the kind of thing worth
         * seeing, and proceeding anyway would hand the session to whoever presented it. The handler is cancelled
         * first, as the default implementation would do.
         */
        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
            handler.cancel();
            show(view, "Certificate rejected", "SSL error " + error.getPrimaryError() + " · " + error.getUrl(), null);
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
                "<a href='" + escape(bridge.getServerUrl()) + "'>Try again</a>" +
                "</main></body></html>";
            view.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
        }

        /** Enough escaping for text that lands inside an element: the strings here are error text and a URL. */
        private static String escape(String value) {
            if (value == null) return "unknown";
            return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("'", "&#39;");
        }
    }
}
