// Dictado con el reconocimiento de voz del sistema, en el dispositivo si es
// posible (Android 12 o posterior), para que la voz no salga del móvil.
package es.folio.app;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;

@CapacitorPlugin(name = "FolioSpeech", permissions = {@Permission(strings = {Manifest.permission.RECORD_AUDIO}, alias = "microphone")})
public class FolioSpeechPlugin extends Plugin {
    private SpeechRecognizer recognizer;
    private PluginCall pending;

    @PluginMethod
    public void available(PluginCall call) {
        JSObject res = new JSObject();
        boolean any = SpeechRecognizer.isRecognitionAvailable(getContext());
        res.put("any", any);
        res.put("onDevice", Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(getContext()));
        call.resolve(res);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "micPermissionResult");
            return;
        }
        begin(call);
    }

    @PermissionCallback
    private void micPermissionResult(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) begin(call);
        else call.reject("Folio no tiene permiso para usar el micrófono.");
    }

    private void begin(final PluginCall call) {
        getBridge().saveCall(call);
        final String language = call.getString("language", "es-ES");
        final boolean partial = Boolean.TRUE.equals(call.getBoolean("partial", true));
        getActivity().runOnUiThread(() -> {
            // El reconocedor solo puede usarse desde el hilo principal
            destroy();
            if (pending != null) pending.reject("cancelado");
            pending = call;
            recognizer = Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(getContext())
                    ? SpeechRecognizer.createOnDeviceSpeechRecognizer(getContext())
                    : SpeechRecognizer.createSpeechRecognizer(getContext());
            recognizer.setRecognitionListener(new Listener());
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, language);
            intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, partial);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            recognizer.startListening(intent);
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (recognizer != null) recognizer.stopListening();
            call.resolve();
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (recognizer != null) recognizer.cancel();
            if (pending != null) {
                pending.reject("cancelado");
                pending = null;
            }
            destroy();
            call.resolve();
        });
    }

    private void destroy() {
        if (recognizer != null) {
            recognizer.destroy();
            recognizer = null;
        }
    }

    private static String firstResult(Bundle b) {
        ArrayList<String> list = b == null ? null : b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        return list != null && !list.isEmpty() ? list.get(0) : "";
    }

    private static String errorText(int code) {
        switch (code) {
            case SpeechRecognizer.ERROR_NO_MATCH:
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                return "No se ha entendido nada.";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                return "Folio no tiene permiso para usar el micrófono.";
            case SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE:
            case SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED:
                return "Falta el paquete de voz en español. Instálalo en Ajustes > Sistema > Idioma > Reconocimiento de voz sin conexión.";
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                return "El reconocimiento de voz necesita conexión en este móvil o falta el paquete de voz sin conexión.";
            case SpeechRecognizer.ERROR_AUDIO:
                return "No se pudo usar el micrófono.";
            default:
                return "El dictado ha fallado (código " + code + ").";
        }
    }

    private class Listener implements RecognitionListener {
        @Override public void onReadyForSpeech(Bundle params) { }
        @Override public void onBeginningOfSpeech() { }
        @Override public void onRmsChanged(float rmsdB) { }
        @Override public void onBufferReceived(byte[] buffer) { }
        @Override public void onEndOfSpeech() { }
        @Override public void onEvent(int eventType, Bundle params) { }

        @Override
        public void onPartialResults(Bundle partialResults) {
            JSObject e = new JSObject();
            e.put("text", firstResult(partialResults));
            notifyListeners("partial", e);
        }

        @Override
        public void onResults(Bundle results) {
            if (pending != null) {
                JSObject res = new JSObject();
                res.put("text", firstResult(results));
                pending.resolve(res);
                pending = null;
            }
            destroy();
        }

        @Override
        public void onError(int error) {
            if (pending != null) {
                pending.reject(errorText(error));
                pending = null;
            }
            destroy();
        }
    }
}
