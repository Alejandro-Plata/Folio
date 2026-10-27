// Credenciales de la sincronización (contraseña de WebDAV, tokens) en el
// almacén cifrado de Android. Nunca se guardan en los ajustes ni en la nube.
package es.folio.app;

import android.content.SharedPreferences;
import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "FolioSecrets")
public class FolioSecretsPlugin extends Plugin {
    private SharedPreferences prefs;

    private synchronized SharedPreferences prefs() throws Exception {
        if (prefs == null) {
            MasterKey key = new MasterKey.Builder(getContext()).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build();
            prefs = EncryptedSharedPreferences.create(getContext(), "folio_secrets", key,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM);
        }
        return prefs;
    }

    @PluginMethod
    public void get(PluginCall call) {
        try {
            JSObject res = new JSObject();
            res.put("value", prefs().getString(call.getString("key", ""), null));
            call.resolve(res);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void set(PluginCall call) {
        try {
            prefs().edit().putString(call.getString("key", ""), call.getString("value", "")).apply();
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        try {
            prefs().edit().remove(call.getString("key", "")).apply();
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }
}
