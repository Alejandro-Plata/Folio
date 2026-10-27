// Puente entre la interfaz y el núcleo Go: cada llamada se ejecuta en un único
// hilo de trabajo (nunca en el principal) para conservar el orden, igual que en
// escritorio, y los eventos del núcleo llegan a la interfaz.
package es.folio.app;

import android.content.pm.PackageInfo;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import es.folio.mobile.EventSink;
import es.folio.mobile.Mobile;
import es.folio.mobile.SecretStore;
import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "FolioCore")
public class FolioCorePlugin extends Plugin {
    private static final String TAG = "FolioCore";
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    @Override
    public void load() {
        Mobile.setEventSink(new EventSink() {
            @Override
            public void emit(String name, String payloadJSON) {
                JSObject e = new JSObject();
                e.put("name", name);
                e.put("payload", payloadJSON);
                notifyListeners("event", e);
            }
        });
        // Sesión de la cuenta (Supabase): mismo almacén cifrado que FolioSecretsPlugin
        Mobile.setSecretStore(new SecretStore() {
            @Override
            public String get(String key) {
                android.content.SharedPreferences p = securePrefs();
                return p == null ? "" : p.getString(key, "");
            }

            @Override
            public void set(String key, String value) {
                android.content.SharedPreferences p = securePrefs();
                if (p != null) p.edit().putString(key, value).apply();
            }

            @Override
            public void delete(String key) {
                android.content.SharedPreferences p = securePrefs();
                if (p != null) p.edit().remove(key).apply();
            }
        });
        final File config = new File(getContext().getFilesDir(), "config");
        final File workspace = new File(getContext().getFilesDir(), "Folio");
        config.mkdirs();
        workspace.mkdirs();
        final String version = versionName();
        // Va el primero en la cola: las llamadas siguientes esperan a que termine
        worker.execute(() -> {
            try {
                Mobile.start(config.getAbsolutePath(), workspace.getAbsolutePath(), version);
            } catch (Exception e) {
                Log.e(TAG, "No se pudo iniciar el núcleo", e);
            }
        });
    }

    private android.content.SharedPreferences prefs;

    private synchronized android.content.SharedPreferences securePrefs() {
        if (prefs == null) {
            try {
                androidx.security.crypto.MasterKey key = new androidx.security.crypto.MasterKey.Builder(getContext())
                        .setKeyScheme(androidx.security.crypto.MasterKey.KeyScheme.AES256_GCM).build();
                prefs = androidx.security.crypto.EncryptedSharedPreferences.create(getContext(), "folio_secrets", key,
                        androidx.security.crypto.EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                        androidx.security.crypto.EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM);
            } catch (Exception e) {
                Log.e(TAG, "Almacén seguro no disponible", e);
            }
        }
        return prefs;
    }

    private String versionName() {
        try {
            PackageInfo p = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            return p.versionName != null ? p.versionName : "1.0";
        } catch (Exception e) {
            return "1.0";
        }
    }

    @PluginMethod
    public void call(final PluginCall call) {
        final String method = call.getString("method");
        if (method == null) {
            call.reject("Falta el método");
            return;
        }
        final String args = call.getString("args", "[]");
        worker.execute(() -> {
            try {
                JSObject out = new JSObject();
                out.put("result", Mobile.call(method, args));
                call.resolve(out);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Error en " + method);
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        worker.execute(Mobile::stop);
    }
}
