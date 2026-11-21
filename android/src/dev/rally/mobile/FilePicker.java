package dev.rally.mobile;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Log;
import android.webkit.MimeTypeMap;
import android.widget.Toast;
import org.mozilla.geckoview.GeckoResult;
import org.mozilla.geckoview.GeckoSession.PromptDelegate;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.nio.charset.StandardCharsets;

/** SAF providers need not expose filesystem paths. Stage their bytes before confirming to Gecko. */
final class FilePicker {
    private static final long MAX_BYTES = 1024L * 1024 * 1024;
    private static final int MAX_FILES = 10;
    private static final ExecutorService IO = Executors.newSingleThreadExecutor();
    private static boolean cleaned;
    private static int nextCode = 1000;
    private final Activity activity;
    private final File directory;
    private Pending pending;
    private boolean closed;

    private static final class Pending {
        final PromptDelegate.FilePrompt prompt;
        final GeckoResult<PromptDelegate.PromptResponse> result = new GeckoResult<>();
        final int code;
        volatile boolean cancelled;
        Pending(PromptDelegate.FilePrompt prompt, int code) { this.prompt = prompt; this.code = code; }
    }

    FilePicker(Activity activity) {
        this.activity = activity;
        File parent = new File(activity.getCacheDir(), "file-picker");
        // All cleanup and copies share one queue; stale process caches are removed before new copies.
        if (!cleaned) { cleaned = true; IO.execute(() -> remove(parent)); }
        directory = new File(parent, UUID.randomUUID().toString());
    }

    GeckoResult<PromptDelegate.PromptResponse> open(PromptDelegate.FilePrompt prompt) {
        cancel();
        if (closed) return GeckoResult.fromValue(prompt.dismiss());
        if (nextCode >= 65535) nextCode = 1000;
        Pending request = new Pending(prompt, nextCode++);
        pending = request;
        prompt.setDelegate(new PromptDelegate.PromptInstanceDelegate() {
            @Override public void onPromptDismiss(PromptDelegate.BasePrompt dismissed) {
                if (pending == request) cancel();
            }
        });
        Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
        if (prompt.mimeTypes != null) {
            String[] types = Arrays.stream(prompt.mimeTypes).filter(type -> type.contains("/")).toArray(String[]::new);
            if (types.length == 1) pick.setType(types[0]);
            else if (types.length > 1) pick.putExtra(Intent.EXTRA_MIME_TYPES, types);
        }
        pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, prompt.type == PromptDelegate.FilePrompt.Type.MULTIPLE);
        try { activity.startActivityForResult(pick, request.code); }
        catch (Exception error) { fail(request, "无法打开系统文件选择器"); }
        return request.result;
    }

    boolean onResult(int code, int status, Intent data) {
        Pending request = pending;
        if (request == null || code != request.code) return false;
        if (status != Activity.RESULT_OK || data == null) { cancel(); return true; }
        List<Uri> uris = new ArrayList<>();
        if (data.getClipData() != null) {
            for (int i = 0; i < data.getClipData().getItemCount(); i++) uris.add(data.getClipData().getItemAt(i).getUri());
        } else if (data.getData() != null) uris.add(data.getData());
        if (uris.isEmpty()) { cancel(); return true; }
        if (uris.size() > MAX_FILES) { fail(request, "每次最多选择 10 个附件"); return true; }
        if (request.prompt.type != PromptDelegate.FilePrompt.Type.MULTIPLE && uris.size() != 1) {
            fail(request, "请选择一个文件"); return true;
        }
        IO.execute(() -> {
            File batch = new File(directory, UUID.randomUUID().toString());
            try {
                List<Uri> files = new ArrayList<>();
                for (int i = 0; i < uris.size(); i++) files.add(Uri.fromFile(copy(uris.get(i), new File(batch, String.valueOf(i)), request)));
                activity.runOnUiThread(() -> {
                    if (closed || pending != request || request.cancelled || request.prompt.isComplete()) {
                        IO.execute(() -> remove(batch)); return;
                    }
                    try {
                        request.result.complete(request.prompt.confirm(activity, files.toArray(new Uri[0])));
                        pending = null;
                        // Keep staged files for the lifetime of this page: File/Blob may read lazily,
                        // and failed uploads must remain retryable after opening another picker.
                    } catch (Exception error) {
                        fail(request, "无法读取所选文件，请重新选择"); IO.execute(() -> remove(batch));
                    }
                });
            } catch (Exception error) {
                remove(batch);
                activity.runOnUiThread(() -> { if (!request.cancelled && pending == request) fail(request, error.getMessage()); });
            }
        });
        return true;
    }

    private File copy(Uri uri, File folder, Pending request) throws IOException {
        if (request.cancelled) throw new IOException("选择已取消");
        if (uri == null || !("content".equals(uri.getScheme()) || "file".equals(uri.getScheme()))) throw new IOException("文件来源无效");
        String name = "attachment";
        try (Cursor cursor = activity.getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int n = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME), size = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (n >= 0 && !cursor.isNull(n)) name = cursor.getString(n);
                if (size >= 0 && !cursor.isNull(size) && cursor.getLong(size) > MAX_BYTES) throw new IOException("文件超过 1 GiB");
            }
        } catch (IOException error) { throw error; }
        catch (RuntimeException ignored) { /* Providers may omit metadata; enforce size while reading. */ }
        name = name.replaceAll("[\\\\/\\p{Cntrl}]", "_");
        if (name.trim().isEmpty() || name.equals(".") || name.equals("..")) name = "attachment";
        while (name.getBytes(StandardCharsets.UTF_8).length > 200) name = name.substring(Character.charCount(name.codePointAt(0)));
        if (!name.contains(".")) {
            String ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(activity.getContentResolver().getType(uri));
            if (ext != null) name += "." + ext;
        }
        if (!folder.mkdirs()) throw new IOException("无法创建附件缓存，请检查存储空间");
        File file = new File(folder, name);
        try (InputStream input = activity.getContentResolver().openInputStream(uri); FileOutputStream output = new FileOutputStream(file)) {
            if (input == null) throw new IOException("无法打开所选文件");
            byte[] bytes = new byte[64 * 1024]; long total = 0; int count;
            while ((count = input.read(bytes)) != -1) {
                if (request.cancelled) throw new IOException("选择已取消");
                total += count;
                if (total > MAX_BYTES) throw new IOException("文件超过 1 GiB");
                output.write(bytes, 0, count);
            }
        }
        return file;
    }

    private void fail(Pending request, String message) {
        Log.w("Rally", "File selection failed");
        if (pending != request) return;
        cancel();
        if (!activity.isDestroyed()) Toast.makeText(activity, message == null ? "无法读取附件，请重试" : message, Toast.LENGTH_LONG).show();
    }

    private void cancel() {
        Pending request = pending; pending = null;
        if (request == null) return;
        request.cancelled = true;
        if (!request.prompt.isComplete()) request.result.complete(request.prompt.dismiss());
    }

    void close() {
        closed = true; cancel(); IO.execute(() -> remove(directory));
    }

    private static void remove(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) remove(child);
        file.delete();
    }
}
