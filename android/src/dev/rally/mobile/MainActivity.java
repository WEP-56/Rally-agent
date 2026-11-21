package dev.rally.mobile;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
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
                Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*");
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

        Bridge(GeckoSession page, String profile) { this.page = page; this.profile = profile; }
        void close() { active = false; if (port != null) port.disconnect(); for (HttpURLConnection connection : connections) connection.disconnect(); }
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
            pool.execute(() -> {
                if (!active) return;
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
            if (status == RESULT_OK && data != null && data.getData() != null && !filePrompt.isComplete()) fileResult.complete(filePrompt.confirm(this, data.getData()));
            cancelFile();
        }
    }
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
