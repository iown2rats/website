package com.mellocrush.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.util.Base64;
import android.webkit.WebView;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * A flight recorder for the shell (docs/ARCHITECTURE.md §28).
 *
 * The previous attempt at this reported from three WebViewClient callbacks, on a background thread, holding
 * nothing on disk. It captured nothing at all, twice, and the reason is structural rather than incidental:
 *
 *   - every one of those callbacks belongs to the WebView. A failure above it — an uncaught exception, the
 *     process being torn down — fires none of them, so the instrument was blind to an entire class of fault;
 *   - a report that exists only in a thread's stack dies with the process that was about to lose it, which is
 *     precisely the moment worth recording.
 *
 * So this writes first and sends later. Every breadcrumb goes to disk with commit(), which blocks until the
 * write lands, before the call returns. Delivery reads that file and clears it ONLY after the server has
 * confirmed every chunk; anything undelivered is simply still there on the next launch. A process can be killed
 * at any point and lose at most the breadcrumb it was mid-way through writing.
 *
 * Nothing here restarts, reloads or recreates anything. The last build's recovery loop is gone deliberately: a
 * diagnostic that changes the behaviour it is measuring is worse than none.
 */
final class Diagnostics {

    private static final String PREFS = "mellocrush.diagnostics";
    private static final String KEY_LOG = "log";

    /** Bounded so an undeliverable log cannot grow without limit; the oldest entries are dropped first. */
    private static final int MAX_CHARS = 6000;

    /** Path prefix. These 404 — the point is that the request line lands in the server's log where I can read it. */
    private static final String ENDPOINT = "https://www.mellocrush.com/__diag/";

    /** Kept under the URL length every layer in the path is comfortable with. */
    private static final int CHUNK = 160;

    private static SharedPreferences prefs;
    private static long startedAt;
    private static String runId = "0";
    private static boolean sending = false;

    private Diagnostics() {}

    /** Call once, as early in the process as possible, before anything that might throw. */
    static synchronized void start(Context context) {
        try {
            prefs = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        } catch (Throwable ignored) {
            return;
        }
        startedAt = System.currentTimeMillis();
        runId = Long.toString(startedAt % 1000000L);
        write("=== run " + runId + " " + device() + " ===");
        installCrashHandler();
    }

    /**
     * Records one event. Synchronous by design: commit() blocks until the write is on disk, so a process that
     * dies immediately afterwards still leaves the breadcrumb behind. The cost is a few milliseconds on the main
     * thread, which is the right trade for a build whose only job is to explain a disappearance.
     */
    static synchronized void breadcrumb(String event) {
        write(elapsed() + " " + event);
    }

    private static void write(String line) {
        if (prefs == null) return;
        try {
            String log = prefs.getString(KEY_LOG, "");
            log = log.isEmpty() ? line : log + "\n" + line;
            if (log.length() > MAX_CHARS) log = log.substring(log.length() - MAX_CHARS);
            prefs.edit().putString(KEY_LOG, log).commit();
        } catch (Throwable ignored) {
            // Never let recording a fault become a fault.
        }
    }

    /** Everything recorded and not yet delivered, for the on-screen fallback. */
    static synchronized String trail() {
        if (prefs == null) return "(diagnostics never started)";
        try {
            String log = prefs.getString(KEY_LOG, "");
            return log.isEmpty() ? "(nothing recorded)" : log;
        } catch (Throwable t) {
            return "(trail unreadable: " + t + ")";
        }
    }

    /**
     * Captures what no WebView callback can see. The trace is written before the previous handler runs, so the
     * evidence is on disk before Android tears the process down.
     */
    private static void installCrashHandler() {
        final Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
            try {
                StringWriter out = new StringWriter();
                error.printStackTrace(new PrintWriter(out));
                String trace = out.toString();
                if (trace.length() > 1800) trace = trace.substring(0, 1800);
                breadcrumb("FATAL on " + thread.getName() + ": " + trace.replace('\n', '|'));
            } catch (Throwable ignored) {
                // Nothing useful remains to be done here.
            }
            if (previous != null) previous.uncaughtException(thread, error);
        });
    }

    /**
     * Ships the log, in order, as a sequence of request paths. Cleared only once the server has answered every
     * chunk — an interrupted delivery therefore leaves the evidence intact for the next launch rather than
     * destroying it. One delivery at a time; further calls while one is running are ignored.
     */
    static synchronized void deliver(String reason) {
        if (prefs == null || sending) return;
        final String log = trail();
        if (log.startsWith("(")) return;
        sending = true;

        new Thread(() -> {
            boolean ok = false;
            try {
                String encoded = Base64.encodeToString(
                    log.getBytes(StandardCharsets.UTF_8),
                    Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING
                );
                int total = (encoded.length() + CHUNK - 1) / CHUNK;
                ok = get(ENDPOINT + runId + "/begin-" + total + "-" + safe(reason));
                for (int i = 0; i < total && ok; i++) {
                    int from = i * CHUNK;
                    int to = Math.min(from + CHUNK, encoded.length());
                    ok = get(ENDPOINT + runId + "/p" + i + "/" + encoded.substring(from, to));
                }
                if (ok) ok = get(ENDPOINT + runId + "/end");
            } catch (Throwable ignored) {
                ok = false;
            }
            if (ok) {
                synchronized (Diagnostics.class) {
                    try {
                        if (prefs != null) prefs.edit().putString(KEY_LOG, "").commit();
                    } catch (Throwable ignored) {
                        // Keep it; a duplicate report is harmless and losing one is not.
                    }
                }
            }
            synchronized (Diagnostics.class) {
                sending = false;
            }
        })
            .start();
    }

    /** A 404 is success: it means the request line reached the server and is in its log. */
    private static boolean get(String url) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            conn.setInstanceFollowRedirects(false);
            int code = conn.getResponseCode();
            return code > 0;
        } catch (Throwable t) {
            return false;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String safe(String value) {
        return value == null ? "none" : value.replaceAll("[^A-Za-z0-9_-]", "-");
    }

    private static String elapsed() {
        return "+" + (System.currentTimeMillis() - startedAt) + "ms";
    }

    /** The parts of the device that matter when a WebView renderer dies: who made it, and which WebView it is. */
    private static String device() {
        String webview = "unknown";
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                PackageInfo info = WebView.getCurrentWebViewPackage();
                if (info != null) webview = info.packageName + "@" + info.versionName;
            }
        } catch (Throwable ignored) {
            // Some devices refuse this; the rest of the line is still worth having.
        }
        return Build.MANUFACTURER + "/" + Build.MODEL + " android-" + Build.VERSION.RELEASE +
            " sdk-" + Build.VERSION.SDK_INT + " webview-" + webview;
    }
}
