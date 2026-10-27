// Autorización de Google Drive con Google Play services. Solo pide el ámbito
// drive.file: Folio únicamente ve los archivos que crea él mismo.
package es.folio.app;

import android.app.Activity;
import android.content.Intent;
import android.content.IntentSender;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.Scope;
import java.util.Collections;

@CapacitorPlugin(name = "FolioAuth")
public class FolioAuthPlugin extends Plugin {
    private static final int REQUEST_AUTH = 4711;
    private PluginCall pending;

    @PluginMethod
    public void googleToken(final PluginCall call) {
        AuthorizationRequest request = AuthorizationRequest.builder()
                .setRequestedScopes(Collections.singletonList(new Scope("https://www.googleapis.com/auth/drive.file")))
                .build();
        Identity.getAuthorizationClient(getActivity()).authorize(request)
                .addOnSuccessListener(result -> {
                    if (result.hasResolution() && result.getPendingIntent() != null) {
                        // Hace falta que la persona acepte: se abre la pantalla de Google
                        pending = call;
                        getBridge().saveCall(call);
                        try {
                            getActivity().startIntentSenderForResult(result.getPendingIntent().getIntentSender(), REQUEST_AUTH, null, 0, 0, 0);
                        } catch (IntentSender.SendIntentException e) {
                            pending = null;
                            call.reject("No se pudo abrir la pantalla de Google");
                        }
                    } else {
                        resolveToken(call, result);
                    }
                })
                .addOnFailureListener(e -> call.reject("No se pudo vincular con Google: " + e.getMessage()));
    }

    private void resolveToken(PluginCall call, AuthorizationResult result) {
        if (result.getAccessToken() == null) {
            call.reject("Google no ha devuelto permiso de acceso");
            return;
        }
        JSObject res = new JSObject();
        res.put("token", result.getAccessToken());
        call.resolve(res);
    }

    @Override
    protected void handleOnActivityResult(int requestCode, int resultCode, Intent data) {
        super.handleOnActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_AUTH || pending == null) return;
        PluginCall call = pending;
        pending = null;
        if (resultCode != Activity.RESULT_OK || data == null) {
            call.reject("Has cancelado la vinculación con Google");
            return;
        }
        try {
            resolveToken(call, Identity.getAuthorizationClient(getActivity()).getAuthorizationResultFromIntent(data));
        } catch (Exception e) {
            call.reject("No se pudo vincular con Google: " + e.getMessage());
        }
    }
}
