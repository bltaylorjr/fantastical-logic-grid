package com.fantasticallogicgrid.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.res.AssetFileDescriptor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * The Android app: one full-screen WebView that runs the game from the APK's
 * assets (assets/www is the web build). Pages are served from
 * https://appassets.androidplatform.net so the game gets a secure origin
 * (IndexedDB, module workers and WebAssembly all work offline). The native
 * bridge (assets/native-bridge.js) adds printing, saving files, keeping the
 * screen on, the device voice and the back button.
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/";
    private static final String BRIDGE_PATH = "/__native/bridge.js";
    private static final int REQ_SAVE = 1;
    private static final int REQ_OPEN = 2;

    private FrameLayout root;
    private WebView web;
    private TextToSpeech tts;
    private boolean ttsReady;
    private boolean voicesWanted;
    private final List<JSONObject> speechQueue = new ArrayList<>();
    private byte[] pendingSave;
    private ValueCallback<Uri[]> fileCallback;
    private int barColor;
    private boolean barDark;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        boolean night = (getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK)
                == android.content.res.Configuration.UI_MODE_NIGHT_YES;
        barColor = getResources().getColor(R.color.bar, getTheme());
        barDark = night;

        root = new FrameLayout(this);
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        setUpWindow();

        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportMultipleWindows(false);
        web.addJavascriptInterface(new Bridge(), "FLGAndroid");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());

        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                    new OnBackInvokedCallback() {
                        @Override
                        public void onBackInvoked() {
                            handleBack();
                        }
                    });
        }

        tts = new TextToSpeech(this, new TextToSpeech.OnInitListener() {
            @Override
            public void onInit(int status) {
                ttsReady = status == TextToSpeech.SUCCESS;
                if (!ttsReady) return;
                tts.setOnUtteranceProgressListener(new Speech());
                if (voicesWanted) sendVoices();
                for (JSONObject o : speechQueue) speak(o);
                speechQueue.clear();
            }
        });

        web.loadUrl(START_URL);
    }

    // ---- Window, system bars and insets ----

    private void setUpWindow() {
        Window w = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            // Draw behind the system bars and pad the WebView by their size,
            // so the game never sits under the status bar, the camera cut-out,
            // the gesture bar or the keyboard.
            w.setDecorFitsSystemWindows(false);
            if (Build.VERSION.SDK_INT < 35) {
                w.setStatusBarColor(Color.TRANSPARENT);
                w.setNavigationBarColor(Color.TRANSPARENT);
            }
            w.setNavigationBarContrastEnforced(false);
            root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
                @Override
                public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                    android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                    android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
                    v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
                    return WindowInsets.CONSUMED;
                }
            });
        }
        applyBars();
    }

    private void applyBars() {
        Window w = getWindow();
        root.setBackgroundColor(barColor);
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = w.getInsetsController();
            if (c != null) {
                int light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                c.setSystemBarsAppearance(barDark ? 0 : light, light);
            }
        } else {
            w.setStatusBarColor(barColor);
            w.setNavigationBarColor(barColor);
            int flags = w.getDecorView().getSystemUiVisibility();
            int light = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= 26) light |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            w.getDecorView().setSystemUiVisibility(barDark ? flags & ~light : flags | light);
        }
    }

    // ---- Back button ----

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        handleBack();
    }

    private void handleBack() {
        web.evaluateJavascript("window.__flgBack ? window.__flgBack() : false", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String handled) {
                // Nothing left to close: leave the game running in the background
                // (it autosaves), like the home button.
                if (!"true".equals(handled)) moveTaskToBack(true);
            }
        });
    }

    // ---- Serving the web build from the APK ----

    private class Client extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (!HOST.equals(url.getHost())) return null;
            return serve(url.getPath(), request.getRequestHeaders());
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (HOST.equals(url.getHost())) return false;
            // Links to other sites (for example where to get a voice key) open in the browser.
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, url).addCategory(Intent.CATEGORY_BROWSABLE));
            } catch (ActivityNotFoundException e) {
                Toast.makeText(MainActivity.this, R.string.no_app_for_link, Toast.LENGTH_SHORT).show();
            }
            return true;
        }

        @Override
        public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
            // The page's process was stopped (usually to free memory). Start again;
            // the game reopens the puzzle from its autosave.
            recreate();
            return true;
        }
    }

    private WebResourceResponse serve(String path, Map<String, String> requestHeaders) {
        if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-cache");
        try {
            if (path.contains("..")) throw new IOException("Bad path");
            // Everything is already on the device, so the offline service worker is not needed.
            if (path.equals("/sw.js")) throw new IOException("No service worker in the app");
            if (path.equals(BRIDGE_PATH)) {
                return new WebResourceResponse("text/javascript", "utf-8", 200, "OK", headers, getAssets().open("native-bridge.js"));
            }
            String asset = "www" + path;
            String mime = mimeType(path);
            if (path.equals("/index.html")) {
                // Load the native bridge before any of the game's own scripts.
                String html = new String(readAll(getAssets().open(asset)), StandardCharsets.UTF_8);
                html = html.replaceFirst("<head>", "<head>\n<script src=\"" + BRIDGE_PATH + "\"></script>");
                return new WebResourceResponse(mime, "utf-8", 200, "OK", headers, new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8)));
            }
            String encoding = mime.startsWith("text/") || mime.endsWith("javascript") || mime.endsWith("json") ? "utf-8" : null;
            String range = header(requestHeaders, "Range");
            if (range != null && range.startsWith("bytes=")) {
                WebResourceResponse partial = serveRange(asset, mime, range.substring(6), headers);
                if (partial != null) return partial;
            }
            return new WebResourceResponse(mime, encoding, 200, "OK", headers, getAssets().open(asset));
        } catch (IOException e) {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers, new ByteArrayInputStream(new byte[0]));
        }
    }

    // Video seeking asks for byte ranges. Works for files stored uncompressed in the APK (media).
    private WebResourceResponse serveRange(String asset, String mime, String spec, Map<String, String> headers) {
        long length;
        try {
            AssetFileDescriptor fd = getAssets().openFd(asset);
            length = fd.getLength();
            fd.close();
        } catch (IOException e) {
            return null;
        }
        try {
            String[] parts = spec.split(",")[0].trim().split("-", -1);
            long start;
            long end;
            if (parts[0].isEmpty()) {
                start = Math.max(0, length - Long.parseLong(parts[1]));
                end = length - 1;
            } else {
                start = Long.parseLong(parts[0]);
                end = parts.length > 1 && !parts[1].isEmpty() ? Math.min(Long.parseLong(parts[1]), length - 1) : length - 1;
            }
            if (start >= length || start > end) return null;
            InputStream in = getAssets().open(asset);
            long skipped = 0;
            while (skipped < start) {
                long n = in.skip(start - skipped);
                if (n <= 0) break;
                skipped += n;
            }
            headers.put("Accept-Ranges", "bytes");
            headers.put("Content-Range", "bytes " + start + "-" + end + "/" + length);
            headers.put("Content-Length", String.valueOf(end - start + 1));
            return new WebResourceResponse(mime, null, 206, "Partial Content", headers, new Bounded(in, end - start + 1));
        } catch (IOException | NumberFormatException e) {
            return null;
        }
    }

    private static String header(Map<String, String> headers, String name) {
        if (headers == null) return null;
        for (Map.Entry<String, String> e : headers.entrySet()) {
            if (e.getKey() != null && e.getKey().equalsIgnoreCase(name)) return e.getValue();
        }
        return null;
    }

    private static String mimeType(String path) {
        String p = path.toLowerCase(Locale.ROOT);
        int dot = p.lastIndexOf('.');
        String ext = dot < 0 ? "" : p.substring(dot + 1);
        switch (ext) {
            case "html": return "text/html";
            case "js": case "mjs": return "text/javascript";
            case "css": return "text/css";
            case "json": return "application/json";
            case "webmanifest": return "application/manifest+json";
            case "svg": return "image/svg+xml";
            case "png": return "image/png";
            case "jpg": case "jpeg": return "image/jpeg";
            case "webp": return "image/webp";
            case "ico": return "image/x-icon";
            case "woff2": return "font/woff2";
            case "woff": return "font/woff";
            case "wasm": return "application/wasm";
            case "mp4": return "video/mp4";
            case "webm": return "video/webm";
            case "mp3": return "audio/mpeg";
            case "ogg": return "audio/ogg";
            case "wav": return "audio/wav";
            case "vtt": return "text/vtt";
            case "txt": return "text/plain";
            default: return "application/octet-stream";
        }
    }

    private static byte[] readAll(InputStream in) throws IOException {
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        } finally {
            in.close();
        }
    }

    /** Reads at most {@code left} bytes from a stream. */
    private static final class Bounded extends InputStream {
        private final InputStream in;
        private long left;

        Bounded(InputStream in, long left) {
            this.in = in;
            this.left = left;
        }

        @Override
        public int read() throws IOException {
            if (left <= 0) return -1;
            int b = in.read();
            if (b >= 0) left--;
            return b;
        }

        @Override
        public int read(byte[] b, int off, int len) throws IOException {
            if (left <= 0) return -1;
            int n = in.read(b, off, (int) Math.min(len, left));
            if (n > 0) left -= n;
            return n;
        }

        @Override
        public void close() throws IOException {
            in.close();
        }
    }

    // ---- Opening puzzle files (<input type="file">) ----

    private class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            // Puzzle files (.flg.json) show up with different types depending on
            // where they are stored, so let the player pick any file.
            Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
            try {
                startActivityForResult(pick, REQ_OPEN);
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                return false;
            }
            return true;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_OPEN) {
            if (fileCallback != null) fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
        } else if (requestCode == REQ_SAVE) {
            byte[] bytes = pendingSave;
            pendingSave = null;
            if (resultCode != RESULT_OK || data == null || data.getData() == null || bytes == null) return;
            try {
                OutputStream out = getContentResolver().openOutputStream(data.getData(), "wt");
                if (out == null) throw new IOException("No output");
                try {
                    out.write(bytes);
                } finally {
                    out.close();
                }
                Toast.makeText(this, R.string.saved_file, Toast.LENGTH_SHORT).show();
            } catch (IOException | SecurityException e) {
                Toast.makeText(this, R.string.save_failed, Toast.LENGTH_LONG).show();
            }
        }
    }

    // ---- Calls from the page (native-bridge.js) ----

    private class Bridge {
        @JavascriptInterface
        public void post(final String type, final String json) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        handle(type, new JSONObject(json == null || json.isEmpty() ? "{}" : json));
                    } catch (JSONException | RuntimeException e) {
                        android.util.Log.w("FLG", "Bridge call " + type + " failed", e);
                    }
                }
            });
        }
    }

    private void handle(String type, JSONObject o) {
        switch (type) {
            case "print": {
                String title = o.optString("title", getString(R.string.app_name));
                PrintManager pm = (PrintManager) getSystemService(PRINT_SERVICE);
                if (pm != null) pm.print(title, web.createPrintDocumentAdapter(title), new PrintAttributes.Builder().build());
                break;
            }
            case "save": {
                pendingSave = Base64.decode(o.optString("data", ""), Base64.DEFAULT);
                Intent save = new Intent(Intent.ACTION_CREATE_DOCUMENT)
                        .addCategory(Intent.CATEGORY_OPENABLE)
                        .setType(o.optString("mime", "application/octet-stream"))
                        .putExtra(Intent.EXTRA_TITLE, o.optString("name", "puzzle.flg.json"));
                try {
                    startActivityForResult(save, REQ_SAVE);
                } catch (ActivityNotFoundException e) {
                    pendingSave = null;
                    Toast.makeText(this, R.string.save_failed, Toast.LENGTH_LONG).show();
                }
                break;
            }
            case "keepAwake":
                if (o.optBoolean("on")) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                break;
            case "speak":
                if (ttsReady) speak(o);
                else speechQueue.add(o);
                break;
            case "stopSpeaking":
                speechQueue.clear();
                if (ttsReady) tts.stop();
                break;
            case "voices":
                voicesWanted = true;
                if (ttsReady) sendVoices();
                break;
            case "bars":
                try {
                    barColor = Color.parseColor(o.optString("color", "#ffffff"));
                    barDark = o.optBoolean("dark");
                    applyBars();
                } catch (IllegalArgumentException e) {
                    // Ignore a colour Android cannot read.
                }
                break;
            default:
                break;
        }
    }

    // ---- Device voice (Android text-to-speech) ----

    private void speak(JSONObject o) {
        String id = o.optString("id");
        String voiceName = o.optString("voice", "");
        String lang = o.optString("lang", "");
        boolean voiceSet = false;
        if (!voiceName.isEmpty() && tts.getVoices() != null) {
            for (Voice v : tts.getVoices()) {
                if (v.getName().equals(voiceName)) {
                    voiceSet = tts.setVoice(v) == TextToSpeech.SUCCESS;
                    break;
                }
            }
        }
        if (!voiceSet && !lang.isEmpty()) tts.setLanguage(Locale.forLanguageTag(lang));
        tts.setSpeechRate((float) o.optDouble("rate", 1));
        tts.setPitch((float) o.optDouble("pitch", 1));
        if (tts.speak(o.optString("text", ""), TextToSpeech.QUEUE_ADD, null, id) != TextToSpeech.SUCCESS) speechEvent(id, "error");
    }

    private void sendVoices() {
        JSONArray list = new JSONArray();
        try {
            if (tts.getVoices() != null) {
                Voice def = tts.getDefaultVoice();
                for (Voice v : tts.getVoices()) {
                    if (v.getFeatures() != null && v.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)) continue;
                    JSONObject j = new JSONObject();
                    j.put("name", v.getName());
                    j.put("lang", v.getLocale().toLanguageTag());
                    j.put("network", v.isNetworkConnectionRequired());
                    j.put("default", def != null && def.getName().equals(v.getName()));
                    list.put(j);
                }
            }
        } catch (JSONException | RuntimeException e) {
            android.util.Log.w("FLG", "Could not list voices", e);
        }
        web.evaluateJavascript("window.__flgVoices && window.__flgVoices(" + list + ")", null);
    }

    private void speechEvent(final String id, final String type) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                web.evaluateJavascript("window.__flgSpeech && window.__flgSpeech(" + JSONObject.quote(id) + "," + JSONObject.quote(type) + ")", null);
            }
        });
    }

    private class Speech extends UtteranceProgressListener {
        @Override
        public void onStart(String id) {
            speechEvent(id, "start");
        }

        @Override
        public void onDone(String id) {
            speechEvent(id, "end");
        }

        @Override
        @SuppressWarnings("deprecation")
        public void onError(String id) {
            speechEvent(id, "error");
        }

        @Override
        public void onStop(String id, boolean interrupted) {
            speechEvent(id, "end");
        }
    }

    // ---- Lifecycle ----

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        if (tts != null) tts.shutdown();
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
