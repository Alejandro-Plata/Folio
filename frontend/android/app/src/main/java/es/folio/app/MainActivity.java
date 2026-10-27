// Actividad principal: registra los plugins de Folio y sustituye el cliente del
// WebView por el que sirve las imágenes de los documentos.
package es.folio.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FolioCorePlugin.class);
        registerPlugin(FolioFilesPlugin.class);
        registerPlugin(FolioPrintPlugin.class);
        registerPlugin(FolioSpeechPlugin.class);
        registerPlugin(FolioAuthPlugin.class);
        registerPlugin(FolioSecretsPlugin.class);
        super.onCreate(savedInstanceState);
        bridge.setWebViewClient(new FolioWebViewClient(bridge));
        // Respeta el tamaño de letra que el usuario ha elegido en el sistema
        bridge.getWebView().getSettings().setTextZoom((int) (getResources().getConfiguration().fontScale * 100));
    }
}
