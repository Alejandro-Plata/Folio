// Archivos en Android con el Storage Access Framework: elegir, guardar como,
// compartir y abrir con otra app, más los PDF que llegan con «Compartir con Folio».
// Los archivos elegidos se copian a la caché de la app para que el núcleo Go los lea por ruta.
package es.folio.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import androidx.core.content.IntentCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "FolioFiles")
public class FolioFilesPlugin extends Plugin {
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    /** PDF recibidos con «Compartir con Folio», pendientes de que la interfaz los recoja. */
    private final List<Uri> shared = new ArrayList<>();

    @Override
    public void load() {
        collectShared(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        collectShared(intent);
    }

    private void collectShared(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        synchronized (shared) {
            if (Intent.ACTION_SEND.equals(action)) {
                Uri u = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri.class);
                if (u != null) shared.add(u);
            } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
                List<Uri> list = IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri.class);
                if (list != null) shared.addAll(list);
            }
        }
        // Que no se vuelva a procesar al girar la pantalla
        intent.setAction(Intent.ACTION_MAIN);
    }

    // ---------- Utilidades ----------

    private static String safeName(String name) {
        String n = name == null || name.trim().isEmpty() ? "archivo" : name.trim();
        return n.replaceAll("[\\\\/:*?\"<>|]", "-");
    }

    private String displayName(Uri uri) {
        try (Cursor c = getContext().getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) {
        }
        String last = uri.getLastPathSegment();
        return last != null ? last : "archivo";
    }

    /** Copia el contenido de una Uri a la caché y devuelve {path, name, size}. */
    private JSObject copyToCache(Uri uri, File dir) throws Exception {
        String name = safeName(displayName(uri));
        File out = new File(dir, name);
        try (InputStream in = getContext().getContentResolver().openInputStream(uri);
             OutputStream os = new FileOutputStream(out)) {
            if (in == null) throw new Exception("No se pudo abrir " + name);
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
        }
        JSObject o = new JSObject();
        o.put("path", out.getAbsolutePath());
        o.put("name", name);
        o.put("size", out.length());
        return o;
    }

    private File newImportDir() {
        File dir = new File(getContext().getCacheDir(), "import/" + System.currentTimeMillis());
        dir.mkdirs();
        return dir;
    }

    private void copyAll(final List<Uri> uris, final PluginCall call) {
        io.execute(() -> {
            try {
                File dir = newImportDir();
                JSArray files = new JSArray();
                for (Uri u : uris) files.put(copyToCache(u, dir));
                JSObject res = new JSObject();
                res.put("files", files);
                call.resolve(res);
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    private Uri fileUri(String path) {
        Context ctx = getContext();
        return FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", new File(path));
    }

    // ---------- Métodos ----------

    @PluginMethod
    public void pick(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        JSArray types = call.getArray("mimeTypes");
        if (types != null && types.length() > 0) {
            try {
                String[] mimes = new String[types.length()];
                for (int i = 0; i < mimes.length; i++) mimes[i] = types.getString(i);
                intent.putExtra(Intent.EXTRA_MIME_TYPES, mimes);
            } catch (Exception ignored) {
            }
        }
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, Boolean.TRUE.equals(call.getBoolean("multiple", false)));
        startActivityForResult(call, intent, "pickResult");
    }

    @ActivityCallback
    private void pickResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        List<Uri> uris = new ArrayList<>();
        Intent data = result.getData();
        if (result.getResultCode() == Activity.RESULT_OK && data != null) {
            ClipData clip = data.getClipData();
            if (clip != null) {
                for (int i = 0; i < clip.getItemCount(); i++) uris.add(clip.getItemAt(i).getUri());
            } else if (data.getData() != null) {
                uris.add(data.getData());
            }
        }
        if (uris.isEmpty()) {
            JSObject res = new JSObject();
            res.put("files", new JSArray());
            call.resolve(res);
            return;
        }
        copyAll(uris, call);
    }

    @PluginMethod
    public void saveAs(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(call.getString("mimeType", "application/octet-stream"));
        intent.putExtra(Intent.EXTRA_TITLE, call.getString("name", "Folio"));
        startActivityForResult(call, intent, "saveResult");
    }

    @ActivityCallback
    private void saveResult(final PluginCall call, ActivityResult result) {
        if (call == null) return;
        final Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            JSObject res = new JSObject();
            res.put("saved", false);
            call.resolve(res);
            return;
        }
        final String path = call.getString("path");
        io.execute(() -> {
            try (InputStream in = new java.io.FileInputStream(path);
                 OutputStream os = getContext().getContentResolver().openOutputStream(data.getData(), "wt")) {
                if (os == null) throw new Exception("No se pudo escribir el archivo");
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
                JSObject res = new JSObject();
                res.put("saved", true);
                call.resolve(res);
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    @PluginMethod
    public void share(PluginCall call) {
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType(call.getString("mimeType", "application/octet-stream"));
        send.putExtra(Intent.EXTRA_STREAM, fileUri(call.getString("path")));
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        getActivity().startActivity(Intent.createChooser(send, call.getString("title", "Compartir")));
        call.resolve();
    }

    @PluginMethod
    public void open(PluginCall call) {
        Intent view = new Intent(Intent.ACTION_VIEW);
        view.setDataAndType(fileUri(call.getString("path")), call.getString("mimeType", "*/*"));
        view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            getActivity().startActivity(view);
            call.resolve();
        } catch (Exception e) {
            call.reject("No hay ninguna aplicación para abrir este archivo");
        }
    }

    /** Abre una dirección web en el navegador del sistema (inicio de sesión con Google). */
    @PluginMethod
    public void openUrl(PluginCall call) {
        try {
            Intent view = new Intent(Intent.ACTION_VIEW, Uri.parse(call.getString("url")));
            view.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(view);
            call.resolve();
        } catch (Exception e) {
            call.reject("No hay ningún navegador para abrir la página");
        }
    }

    @PluginMethod
    public void tempPath(PluginCall call) {
        File dir = new File(getContext().getCacheDir(), "out");
        dir.mkdirs();
        JSObject res = new JSObject();
        res.put("path", new File(dir, safeName(call.getString("name"))).getAbsolutePath());
        call.resolve(res);
    }

    @PluginMethod
    public void consumeShared(PluginCall call) {
        final List<Uri> uris;
        synchronized (shared) {
            uris = new ArrayList<>(shared);
            shared.clear();
        }
        if (uris.isEmpty()) {
            JSObject res = new JSObject();
            res.put("files", new JSArray());
            call.resolve(res);
            return;
        }
        copyAll(uris, call);
    }
}
