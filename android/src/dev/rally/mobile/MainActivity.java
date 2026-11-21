package dev.rally.mobile;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.os.Build;
import android.os.Bundle;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.util.Log;
import android.view.WindowInsets;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Button;
import android.widget.ArrayAdapter;
import android.widget.ListView;
import android.view.View;
import android.view.ViewGroup;
import android.view.Gravity;
import org.mozilla.geckoview.AllowOrDeny;
import org.mozilla.geckoview.GeckoResult;
import org.mozilla.geckoview.GeckoRuntime;
import org.mozilla.geckoview.GeckoRuntimeSettings;
import org.mozilla.geckoview.GeckoSession;
import org.mozilla.geckoview.GeckoSessionSettings;
import org.mozilla.geckoview.GeckoView;
import org.mozilla.geckoview.WebExtension;
import org.mozilla.geckoview.WebRequestError;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import java.io.*;
import java.net.*;
import java.security.*;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;
import static java.nio.charset.StandardCharsets.UTF_8;

/** Bundled UI only. The native bridge owns networking and encrypted device credentials. */
public final class MainActivity extends Activity {
    private static GeckoRuntime runtime;
    private static WebExtension extension;
    private GeckoSession.PromptDelegate.FilePrompt filePrompt;
    private GeckoResult<GeckoSession.PromptDelegate.PromptResponse> fileResult;
    private AlertDialog choiceDialog;
    private GeckoSession.PromptDelegate.ChoicePrompt choicePrompt;
    private GeckoResult<GeckoSession.PromptDelegate.PromptResponse> choiceResult;
    private SharedPreferences prefs;
    private GeckoView view;
    private volatile GeckoSession session;
    private Bridge bridge;
    private Bridge.Download pickingDownload;
    private FrameLayout root;
    private final ExecutorService pool = Executors.newFixedThreadPool(4);

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        prefs = getSharedPreferences("connections", MODE_PRIVATE);
        root = new FrameLayout(this);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((v, insets) -> {
                android.graphics.Insets edges = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                v.setPadding(edges.left, edges.top, edges.right, edges.bottom);
                return insets;
            });
        } else root.setFitsSystemWindows(true);
        root.setBackgroundColor(0xfff4f3f1);
        getWindow().getDecorView().setSystemUiVisibility(android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        setContentView(root);
        showStatus("正在启动 Rally…", false);
        if (runtime == null) {
            boolean debug = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
            runtime = GeckoRuntime.create(getApplicationContext(), new GeckoRuntimeSettings.Builder().consoleOutput(debug).remoteDebuggingEnabled(debug).build());
        }
        if (extension != null) open();
        else runtime.getWebExtensionController().installBuiltIn("resource://android/assets/extension/").accept(installed -> {
            if (isDestroyed()) return;
            extension = installed;
            open();
        }, error -> showStatus("无法启动界面：" + error.getMessage(), true));
    }

    private String get(String key) { return prefs.getString(key, ""); }

    private void showStatus(String message, boolean retry) {
        if (isDestroyed()) return;
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL); panel.setGravity(Gravity.CENTER); panel.setPadding(40, 40, 40, 40);
        TextView text = new TextView(this); text.setText(message); text.setTextSize(18); text.setTextColor(0xff16161f);
        panel.addView(text);
        if (retry) { Button button = new Button(this); button.setText("重新打开"); button.setOnClickListener(v -> recreate()); panel.addView(button); }
        root.removeAllViews(); root.addView(panel, new FrameLayout.LayoutParams(-1, -1));
    }

    private void cancelFile() {
        if (filePrompt != null && !filePrompt.isComplete()) fileResult.complete(filePrompt.dismiss());
        filePrompt = null; fileResult = null;
    }

    private void cancelChoice() {
        if (choicePrompt != null && !choicePrompt.isComplete()) choiceResult.complete(choicePrompt.dismiss());
        choicePrompt = null; choiceResult = null;
        if (choiceDialog != null) { choiceDialog.setOnDismissListener(null); choiceDialog.dismiss(); choiceDialog = null; }
    }

    private void flattenChoices(GeckoSession.PromptDelegate.ChoicePrompt.Choice[] items, String group, boolean disabled,
            List<GeckoSession.PromptDelegate.ChoicePrompt.Choice> choices, List<String> labels, List<Boolean> enabled) {
        for (GeckoSession.PromptDelegate.ChoicePrompt.Choice item : items) {
            if (item.items != null) flattenChoices(item.items, group + item.label + " · ", disabled || item.disabled, choices, labels, enabled);
            else if (!item.separator) { choices.add(item); labels.add(group + item.label); enabled.add(!disabled && !item.disabled); }
        }
    }

    private void showChoices(GeckoSession.PromptDelegate.ChoicePrompt prompt, GeckoResult<GeckoSession.PromptDelegate.PromptResponse> result) {
        if (choiceDialog != null) { choiceDialog.setOnDismissListener(null); choiceDialog.dismiss(); }
        choicePrompt = prompt; choiceResult = result;
        List<GeckoSession.PromptDelegate.ChoicePrompt.Choice> choices = new ArrayList<>();
        List<String> labels = new ArrayList<>(); List<Boolean> enabled = new ArrayList<>();
        flattenChoices(prompt.choices, "", false, choices, labels, enabled);
        boolean multiple = prompt.type == GeckoSession.PromptDelegate.ChoicePrompt.Type.MULTIPLE;
        ListView list = new ListView(this);
        list.setChoiceMode(multiple ? ListView.CHOICE_MODE_MULTIPLE : ListView.CHOICE_MODE_SINGLE);
        list.setAdapter(new ArrayAdapter<String>(this, multiple ? android.R.layout.simple_list_item_multiple_choice : android.R.layout.simple_list_item_single_choice, labels) {
            @Override public boolean areAllItemsEnabled() { return false; }
            @Override public boolean isEnabled(int position) { return enabled.get(position); }
            @Override public View getView(int position, View recycled, ViewGroup parent) {
                View row = super.getView(position, recycled, parent); row.setEnabled(isEnabled(position)); return row;
            }
        });
        for (int i = 0; i < choices.size(); i++) list.setItemChecked(i, choices.get(i).selected);
        AlertDialog.Builder dialog = new AlertDialog.Builder(this).setTitle(prompt.title).setView(list).setNegativeButton("取消", (d, which) -> cancelChoice());
        if (multiple) dialog.setPositiveButton("确定", (d, which) -> {
            List<String> ids = new ArrayList<>();
            for (int i = 0; i < choices.size(); i++) if (list.isItemChecked(i)) ids.add(choices.get(i).id);
            if (!prompt.isComplete()) result.complete(prompt.confirm(ids.toArray(new String[0])));
        });
        choiceDialog = dialog.create();
        list.setOnItemClickListener((parent, row, index, id) -> {
            if (!multiple && enabled.get(index) && !prompt.isComplete()) { result.complete(prompt.confirm(choices.get(index))); cancelChoice(); }
        });
        choiceDialog.setOnDismissListener(d -> { if (choicePrompt == prompt) cancelChoice(); });
        prompt.setDelegate(new GeckoSession.PromptDelegate.PromptInstanceDelegate() {
            @Override public void onPromptDismiss(GeckoSession.PromptDelegate.BasePrompt dismissed) { if (choicePrompt == prompt) cancelChoice(); }
            @Override public void onPromptUpdate(GeckoSession.PromptDelegate.BasePrompt updated) {
                if (choicePrompt == prompt && updated instanceof GeckoSession.PromptDelegate.ChoicePrompt) showChoices((GeckoSession.PromptDelegate.ChoicePrompt) updated, result);
            }
        });
        choiceDialog.show();
    }

    private void open() {
        if (isDestroyed()) return;
        if (bridge != null) bridge.close();
        cancelFile();
        cancelChoice();
        if (view != null) view.releaseSession();
        if (session != null) session.close();
        String profile = get("profile");
        GeckoSession page = new GeckoSession(new GeckoSessionSettings.Builder().contextId(profile.isEmpty() ? "setup" : profile).build());
        session = page;
        final String entry = extension.metaData.baseUrl + "ui/index.html";
        page.setNavigationDelegate(new GeckoSession.NavigationDelegate() {
            @Override public GeckoResult<AllowOrDeny> onLoadRequest(GeckoSession source, LoadRequest request) {
                if (request.uri.equals(entry) || request.uri.startsWith(entry + "#")) return GeckoResult.fromValue(AllowOrDeny.ALLOW);
                if (request.hasUserGesture) external(request.uri);
                return GeckoResult.fromValue(AllowOrDeny.DENY);
            }
            @Override public GeckoResult<AllowOrDeny> onSubframeLoadRequest(GeckoSession source, LoadRequest request) { return GeckoResult.fromValue(AllowOrDeny.DENY); }
            @Override public GeckoResult<String> onLoadError(GeckoSession source, String uri, WebRequestError error) {
                showStatus("界面资源加载失败：" + error.code, true);
                return null;
            }
        });
        page.setPromptDelegate(new GeckoSession.PromptDelegate() {
            @Override public GeckoResult<PromptResponse> onChoicePrompt(GeckoSession source, ChoicePrompt prompt) {
                cancelChoice(); GeckoResult<PromptResponse> result = new GeckoResult<>(); showChoices(prompt, result); return result;
            }
            @Override public GeckoResult<PromptResponse> onFilePrompt(GeckoSession source, FilePrompt prompt) {
                cancelFile(); filePrompt = prompt; fileResult = new GeckoResult<>();
                GeckoResult<PromptResponse> result = fileResult;
                Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                if (prompt.mimeTypes != null && prompt.mimeTypes.length > 0) {
                    String[] types = Arrays.stream(prompt.mimeTypes).filter(type -> type.contains("/")).toArray(String[]::new);
                    if (types.length == 1) pick.setType(types[0]);
                    else if (types.length > 1) pick.putExtra(Intent.EXTRA_MIME_TYPES, types);
                }
                pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, prompt.type == FilePrompt.Type.MULTIPLE);
                try { startActivityForResult(pick, 70); } catch (Exception error) { cancelFile(); }
                return result;
            }
        });
        bridge = new Bridge(page, profile);
        page.getWebExtensionController().setMessageDelegate(extension, bridge, "rally");
        extension.setMessageDelegate(bridge, "rally");
        view = new GeckoView(this);
        root.removeAllViews(); root.addView(view, new FrameLayout.LayoutParams(-1, -1));
        page.open(runtime); view.setSession(page); page.loadUri(entry);
    }

    private void external(String text) {
        if (text == null) return;
        Uri url = Uri.parse(text);
        if (!"https".equals(url.getScheme()) && !"http".equals(url.getScheme())) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW, url)); } catch (Exception ignored) { }
    }

    private synchronized SecretKey cryptoKey() throws Exception {
        KeyStore db = KeyStore.getInstance("AndroidKeyStore"); db.load(null);
        if (!db.containsAlias("rally-device")) {
            KeyGenerator generator = KeyGenerator.getInstance("AES", "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder("rally-device", KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT).setBlockModes("GCM").setEncryptionPaddings("NoPadding").build());
            generator.generateKey();
        }
        return (SecretKey) db.getKey("rally-device", null);
    }

    private String seal(String token) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, cryptoKey());
        return Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(cipher.doFinal(token.getBytes(UTF_8)), Base64.NO_WRAP);
    }

    private String token(String profile) throws Exception {
        String[] bits = get(profile + ".token").split(":");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, cryptoKey(), new GCMParameterSpec(128, Base64.decode(bits[0], Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(bits[1], Base64.NO_WRAP)), UTF_8);
    }

    private String normalizeUrl(String input) throws Exception {
        URI url = new URI(input.trim());
        String scheme = url.getScheme() == null ? "" : url.getScheme().toLowerCase(Locale.ROOT);
        if ((!scheme.equals("https") && !scheme.equals("http")) || url.getHost() == null || url.getUserInfo() != null || url.getRawQuery() != null || url.getRawFragment() != null || (!url.getPath().isEmpty() && !url.getPath().equals("/"))) throw new IOException("请填写 HTTP 或 HTTPS 服务地址，不带路径");
        int port = url.getPort();
        if (port > 65535 || port == 0) throw new IOException("端口无效");
        if (port == (scheme.equals("https") ? 443 : 80)) port = -1;
        return scheme + "://" + url.getHost().toLowerCase(Locale.ROOT) + (port == -1 ? "" : ":" + port);
    }

    public final class Bridge implements WebExtension.MessageDelegate, WebExtension.PortDelegate {
        private final GeckoSession page;
        private final String profile;
        private WebExtension.Port port;
        private volatile boolean active = true;
        private final Set<HttpURLConnection> connections = ConcurrentHashMap.newKeySet();
        private final Map<String, Download> downloads = new ConcurrentHashMap<>();

        private final class Download {
            final String id;
            final CompletableFuture<Uri> target = new CompletableFuture<>();
            volatile boolean cancelled;
            volatile HttpURLConnection connection;
            Download(String id) { this.id = id; }
            void check() throws IOException { if (cancelled || !active) throw new IOException("已取消保存"); }
            void cancel() { cancelled = true; target.complete(null); if (connection != null) connection.disconnect(); }
        }

        Bridge(GeckoSession page, String profile) { this.page = page; this.profile = profile; }
        void close() { active = false; for (Download download : downloads.values()) download.cancel(); if (port != null) port.disconnect(); for (HttpURLConnection connection : connections) connection.disconnect(); }
        @Override public void onConnect(WebExtension.Port connection) {
            WebExtension.MessageSender sender = connection.sender;
            if (!active || sender.session != page || !sender.isTopLevel() || !sender.url.equals(extension.metaData.baseUrl + "ui/index.html")) { connection.disconnect(); return; }
            port = connection; port.setDelegate(this);
        }
        @Override public void onPortMessage(Object message, WebExtension.Port source) {
            if (!active || source != port || !(message instanceof JSONObject)) return;
            String json = ((JSONObject) message).optString("json");
            if (json.length() > 1024 * 1024) return;
            try {
                JSONObject value = new JSONObject(json);
                if (value.optString("type").equals("back")) { if (!value.optBoolean("handled", true)) finish(); return; }
                JSONArray args = value.optJSONArray("args");
                if (args != null) call(value.optString("id"), value.optString("method"), args.toString());
            } catch (JSONException ignored) { }
        }
        @Override public void onDisconnect(WebExtension.Port source) { if (source == port) port = null; }
        void back() {
            if (port == null) { finish(); return; }
            try { port.postMessage(new JSONObject().put("type", "back")); } catch (JSONException ignored) { }
        }

        private Object post(String url, String key, String route, JSONObject body) throws Exception {
            if (!active) throw new IOException("连接已切换");
            if (!key.matches("[A-Za-z0-9_-]{32,128}")) throw new IOException("请输入控制台生成的设备接入密钥");
            HttpURLConnection connection = (HttpURLConnection) new URL(url + "/v1/" + route).openConnection();
            connections.add(connection);
            try {
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(10000); connection.setReadTimeout(60000);
                connection.setRequestMethod("POST"); connection.setDoOutput(true);
                connection.setRequestProperty("Authorization", "Bearer " + key);
                connection.setRequestProperty("Content-Type", "application/json");
                byte[] encoded = body.toString().getBytes(UTF_8);
                connection.setFixedLengthStreamingMode(encoded.length);
                try (OutputStream output = connection.getOutputStream()) { output.write(encoded); }
                int status = connection.getResponseCode();
                InputStream stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
                if (stream == null) throw new IOException("服务器拒绝请求：" + status);
                Object result;
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, UTF_8))) {
                    StringBuilder text = new StringBuilder(); char[] buffer = new char[8192]; int count;
                    while ((count = reader.read(buffer)) != -1) {
                        if (text.length() + count > 32 * 1024 * 1024) throw new IOException("服务器响应过大");
                        text.append(buffer, 0, count);
                    }
                    result = new JSONTokener(text.toString()).nextValue();
                }
                if (status != 200) throw new IOException(result instanceof JSONObject ? ((JSONObject) result).optString("error", "服务器拒绝请求：" + status) : "服务器拒绝请求：" + status);
                if (!active) throw new IOException("连接已切换");
                return result;
            } finally { connections.remove(connection); connection.disconnect(); }
        }

        private void call(String id, String method, String args) {
            if (!active || id == null || !id.matches("[0-9a-f-]{36}") || args == null || args.length() > 1024 * 1024) return;
            // Cancellation must not wait behind network reads in the four-worker pool.
            if (method.equals("cancelSave")) {
                try { Download download = downloads.get(new JSONArray(args).getString(0)); if (download != null) download.cancel(); reply(id, true, null); }
                catch (Exception error) { reply(id, false, "无效下载编号"); }
                return;
            }
            // Register on the message thread, before queuing network work, so immediate cancel sees it.
            final Download scheduledDownload;
            try {
                if (method.equals("saveResource") && !profile.isEmpty()) {
                    JSONArray values = new JSONArray(args);
                    String resourceId = values.getString(0), downloadId = values.getString(1);
                    if (!resourceId.matches("[a-f0-9-]{36}") || !downloadId.matches("[a-f0-9-]{36}")) throw new IOException("无效下载编号");
                    synchronized (downloads) {
                        if (downloads.size() >= 2 || downloads.containsKey(downloadId)) throw new IOException("下载已在进行或下载过多");
                        scheduledDownload = new Download(downloadId); downloads.put(downloadId, scheduledDownload);
                    }
                } else scheduledDownload = null;
            } catch (Exception error) { reply(id, false, error.getMessage()); return; }
            pool.execute(() -> {
                if (!active) { if (scheduledDownload != null) downloads.remove(scheduledDownload.id); return; }
                try {
                    JSONArray values = new JSONArray(args);
                    JSONObject info = new JSONObject().put("instance", get(profile + ".instance")).put("protocol", 1);
                    Object result;
                    if (method.equals("state")) {
                        JSONArray profiles = new JSONArray();
                        for (String key : prefs.getAll().keySet()) if (key.startsWith("url:")) profiles.put(key.substring(4));
                        result = info.put("platform", "android").put("engine", "GeckoView 160.0").put("mode", profile.isEmpty() ? "choose" : "cloud").put("url", get(profile + ".url")).put("profiles", profiles);
                    } else if (method.equals("request") && !profile.isEmpty()) {
                        String route = values.getString(0);
                        if (!route.equals("rpc") && !route.equals("events")) throw new IOException("不支持此接口");
                        JSONObject body = values.getJSONObject(1).put("instance", get(profile + ".instance")).put("protocol", 1);
                        result = post(get(profile + ".url"), token(profile), route, body);
                    } else if (method.equals("upload") && !profile.isEmpty()) {
                        result = upload(values.getString(0), values.getLong(1), values.getString(2));
                    } else if (method.equals("saveResource") && !profile.isEmpty()) {
                        result = saveResource(values.getString(0), scheduledDownload);
                    } else if (method.equals("select") && values.getString(0).equals("cloud")) {
                        String url = normalizeUrl(values.getString(1)), key = values.getString(2), next = get("url:" + url);
                        SharedPreferences.Editor edit = prefs.edit();
                        if (key.isEmpty() && !next.isEmpty()) {
                            post(url, token(next), "rpc", new JSONObject().put("instance", get(next + ".instance")).put("protocol", 1).put("channel", "app:info").put("args", new JSONArray()));
                        } else {
                            cryptoKey(); // Check storage before consuming the one-use invitation.
                            JSONObject pair = (JSONObject) post(url, key, "pair", new JSONObject().put("protocol", 1));
                            if (pair.getInt("protocol") != 1 || !pair.getString("token").matches("[A-Za-z0-9_-]{43}") || !pair.getString("instance").matches("[a-f0-9-]{36}")) throw new IOException("服务端配对响应无效");
                            if (next.isEmpty() || !get(next + ".instance").equals(pair.getString("instance"))) next = UUID.randomUUID().toString();
                            edit.putString("url:" + url, next).putString(next + ".url", url).putString(next + ".instance", pair.getString("instance")).putString(next + ".token", seal(pair.getString("token")));
                        }
                        if (!active) return;
                        if (!edit.putString("profile", next).commit()) throw new IOException("无法保存连接，请重新生成接入密钥");
                        runOnUiThread(() -> { if (page == session) open(); });
                        return;
                    } else throw new IOException("不支持此操作");
                    reply(id, true, result);
                } catch (Exception error) { reply(id, false, error.getMessage() == null ? "连接失败" : error.getMessage()); }
            });
        }

        private HttpURLConnection resourceConnection(String path) throws Exception {
            if (!active) throw new IOException("连接已切换");
            HttpURLConnection connection = (HttpURLConnection) new URL(get(profile + ".url") + path).openConnection();
            connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(10000); connection.setReadTimeout(120000);
            connection.setRequestProperty("Authorization", "Bearer " + token(profile));
            connection.setRequestProperty("X-Rally-Instance", get(profile + ".instance"));
            connection.setRequestProperty("X-Rally-Protocol", "1");
            return connection;
        }

        private Object upload(String id, long offset, String encoded) throws Exception {
            if (!id.matches("[a-f0-9-]{36}") || offset < 0 || encoded.length() > 350000) throw new IOException("上传分块无效");
            byte[] bytes = Base64.decode(encoded, Base64.NO_WRAP);
            if (bytes.length == 0 || bytes.length > 256 * 1024) throw new IOException("上传分块过大");
            HttpURLConnection connection = resourceConnection("/v1/uploads/" + id + "?offset=" + offset); connections.add(connection);
            try {
                connection.setRequestMethod("PUT"); connection.setDoOutput(true); connection.setFixedLengthStreamingMode(bytes.length);
                connection.setRequestProperty("Content-Type", "application/octet-stream");
                try (OutputStream output = connection.getOutputStream()) { output.write(bytes); }
                int status = connection.getResponseCode();
                InputStream stream = status == 200 ? connection.getInputStream() : connection.getErrorStream();
                if (stream == null) throw new IOException("上传失败：" + status);
                StringBuilder text = new StringBuilder();
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, UTF_8))) {
                    char[] buffer = new char[4096]; int count;
                    while ((count = reader.read(buffer)) != -1) { if (text.length() + count > 65536) throw new IOException("上传响应过大"); text.append(buffer, 0, count); }
                }
                JSONObject value = new JSONObject(text.toString());
                if (status != 200) throw new IOException(value.optString("error", "上传失败：" + status));
                if (!active) throw new IOException("连接已切换");
                return value;
            } finally { connections.remove(connection); connection.disconnect(); }
        }

        private boolean saveResource(String resourceId, Download download) throws Exception {
            String downloadId = download.id;
            File temporary = null; Uri target = null; boolean saved = false;
            try {
                download.check();
                JSONObject resource = (JSONObject) post(get(profile + ".url"), token(profile), "rpc", new JSONObject().put("instance", get(profile + ".instance")).put("protocol", 1).put("channel", "resources:get").put("args", new JSONArray().put(resourceId)));
                long size = resource.getLong("size"); String hash = resource.getString("sha256");
                if (size < 0 || size > 1024L * 1024 * 1024 || !hash.matches("[a-f0-9]{64}")) throw new IOException("资源元数据无效");
                download.check();
                runOnUiThread(() -> {
                    if (!active || download.cancelled) { download.target.complete(null); return; }
                    if (pickingDownload != null) { download.target.completeExceptionally(new IOException("请先完成当前保存位置选择")); return; }
                    pickingDownload = download;
                    Intent save = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(resource.optString("mime", "application/octet-stream"));
                    save.putExtra(Intent.EXTRA_TITLE, resource.optString("name", "attachment").replaceAll("[\\x00-\\x1f/\\\\]", "_"));
                    try { startActivityForResult(save, 71); } catch (Exception error) { pickingDownload = null; download.target.completeExceptionally(error); }
                });
                target = download.target.get(); if (target == null) return false; download.check();
                temporary = File.createTempFile("rally-resource-", ".partial", getCacheDir());
                HttpURLConnection connection = resourceConnection("/v1/resources/" + resourceId + "/content"); download.connection = connection; connections.add(connection);
                try {
                    if (connection.getResponseCode() != 200) throw new IOException("下载失败：" + connection.getResponseCode());
                    MessageDigest digest = MessageDigest.getInstance("SHA-256"); long received = 0, lastProgress = 0;
                    try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(temporary)) {
                        byte[] buffer = new byte[65536]; int count;
                        while ((count = input.read(buffer)) != -1) {
                            download.check(); received += count; if (received > size) throw new IOException("下载文件大小不一致");
                            digest.update(buffer, 0, count); output.write(buffer, 0, count);
                            if (System.currentTimeMillis() - lastProgress > 200 || received == size) { progress(downloadId, received, size); lastProgress = System.currentTimeMillis(); }
                        }
                        output.getFD().sync();
                    }
                    StringBuilder actual = new StringBuilder(); for (byte value : digest.digest()) actual.append(String.format(Locale.ROOT, "%02x", value & 255));
                    if (received != size || !actual.toString().equals(hash)) throw new IOException("下载校验不一致，请重试");
                } finally { download.connection = null; connections.remove(connection); connection.disconnect(); }
                download.check();
                try (InputStream input = new FileInputStream(temporary); OutputStream output = getContentResolver().openOutputStream(target, "wt")) {
                    if (output == null) throw new IOException("无法打开所选保存位置");
                    byte[] buffer = new byte[65536]; int count;
                    while ((count = input.read(buffer)) != -1) { download.check(); output.write(buffer, 0, count); }
                    output.flush(); download.check();
                }
                saved = true; return true;
            } catch (Exception error) { if (download.cancelled || !active) return false; throw error; }
            finally {
                downloads.remove(downloadId); if (temporary != null) temporary.delete();
                // ACTION_CREATE_DOCUMENT returns a new document; remove incomplete files on cancellation.
                if (!saved && target != null) deleteDocument(target);
            }
        }

        private void progress(String id, long received, long size) {
            runOnUiThread(() -> {
                if (!active || page != session || port == null) return;
                try { port.postMessage(new JSONObject().put("type", "resource-save-progress").put("json", new JSONObject().put("id", id).put("received", received).put("size", size).toString())); }
                catch (JSONException error) { Log.e("Rally", "Cannot encode download progress", error); }
            });
        }

        private void reply(String id, boolean ok, Object result) {
            runOnUiThread(() -> {
                if (!active || page != session || port == null) return;
                try {
                    JSONObject response = new JSONObject().put("id", id).put("ok", ok).put("value", result == null ? JSONObject.NULL : result);
                    port.postMessage(new JSONObject().put("json", response.toString()));
                }
                catch (JSONException error) { Log.e("Rally", "Cannot encode native reply", error); }
            });
        }
    }

    @Override protected void onActivityResult(int code, int status, Intent data) {
        super.onActivityResult(code, status, data);
        if (code == 70 && filePrompt != null) {
            if (status == RESULT_OK && data != null && !filePrompt.isComplete()) {
                List<Uri> files = new ArrayList<>();
                if (data.getClipData() != null) for (int i = 0; i < data.getClipData().getItemCount(); i++) files.add(data.getClipData().getItemAt(i).getUri());
                else if (data.getData() != null) files.add(data.getData());
                if (!files.isEmpty()) fileResult.complete(filePrompt.type == GeckoSession.PromptDelegate.FilePrompt.Type.MULTIPLE ? filePrompt.confirm(this, files.toArray(new Uri[0])) : filePrompt.confirm(this, files.get(0)));
            }
            cancelFile();
        }
        if (code == 71 && pickingDownload != null) {
            Bridge.Download download = pickingDownload; pickingDownload = null;
            Uri uri = status == RESULT_OK && data != null ? data.getData() : null;
            if (!download.target.complete(uri) && uri != null) deleteDocument(uri);
        }
    }
    private void deleteDocument(Uri uri) { try { DocumentsContract.deleteDocument(getContentResolver(), uri); } catch (Exception ignored) { } }
    @Override protected void onPause() { if (session != null) session.setActive(false); super.onPause(); }
    @Override protected void onResume() { super.onResume(); if (session != null) session.setActive(true); }
    @Override public void onBackPressed() {
        if (bridge != null) bridge.back(); else super.onBackPressed();
    }
    @Override public void onDestroy() {
        if (bridge != null) bridge.close();
        pool.shutdownNow();
        cancelFile();
        cancelChoice();
        if (view != null) view.releaseSession();
        if (session != null) session.close();
        super.onDestroy();
    }
}
