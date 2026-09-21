package com.mellocrush.app;

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

/**
 * The shell's only activity (docs/ARCHITECTURE.md §28).
 *
 * Capacitor does everything; the one thing added here is a legible failure. When the WebView cannot show
 * https://www.mellocrush.com it falls back to Chromium's own "This page couldn't load", which names neither the
 * error nor the address — and on a phone, with no desktop to attach chrome://inspect to, that page is the end of
 * the investigation.
 *
 * Two different failures produce that same blank page and they are told apart here, because they point at
 * completely different causes:
 *
 *   - a failed navigation, which arrives at onReceivedError with a net error code;
 *   - the renderer process dying, which arrives at onRenderProcessGone instead and never reaches the error
 *     callbacks at all. The page renders, then vanishes.
 */
public class MainActivity extends BridgeActivity {

    /** The last URL the WebView began and finished loading, so a failure can say how far it got. */
    private String lastStarted = "nothing yet";
    private String lastFinished = "nothing yet";

    /**
     * Installed here rather than in onCreate: `load()` is where BridgeActivity builds the bridge and starts the
     * first navigation, so replacing the client immediately after `super.load()` puts it in place at the earliest
     * supported moment.
     */
    @Override
    protected void load() {
        super.load();
        Bridge bridge = getBridge();
        if (bridge != null) bridge.setWebViewClient(new DiagnosticWebViewClient(bridge));
    }

    /**
     * Capacitor's own client, with failures made visible. Everything else — the local server interception that
     * injects the bridge into the remote page, external-link handling, the plugin callbacks — is inherited
     * untouched through `super`.
     */
    private class DiagnosticWebViewClient extends BridgeWebViewClient {

        private final Bridge bridge;

        DiagnosticWebViewClient(Bridge bridge) {
            super(bridge);
            this.bridge = bridge;
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            super.onPageStarted(view, url, favicon);
            lastStarted = url;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            lastFinished = url;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            super.onReceivedError(view, request, error);
            if (!request.isForMainFrame()) return;
            show(view, "Navigation failed", "net error " + error.getErrorCode() + " · " + error.getDescription(), request);
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
            super.onReceivedHttpError(view, request, errorResponse);
            if (!request.isForMainFrame()) return;
            show(view, "Server refused", "HTTP " + errorResponse.getStatusCode(), request);
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

        /**
         * The renderer died. This WebView can never paint again, so the dead view is replaced wholesale with a
         * plain TextView rather than asked to load an error page into itself. Returning true keeps the app alive:
         * the default is to let Android kill the process, which would look to the user like the app simply
         * closing, with nothing said.
         */
        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            String cause = "renderer gone";
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && detail != null) {
                cause = detail.didCrash() ? "renderer crashed" : "renderer killed by the system (out of memory)";
            }
            TextView message = new TextView(MainActivity.this);
            message.setBackgroundColor(Color.BLACK);
            message.setTextColor(0xFFF4F1EC);
            message.setGravity(Gravity.CENTER);
            message.setPadding(64, 64, 64, 64);
            message.setText("MelloCrush stopped rendering\n\n" + cause + "\n\nlast started: " + lastStarted + "\nlast finished: " + lastFinished);
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
