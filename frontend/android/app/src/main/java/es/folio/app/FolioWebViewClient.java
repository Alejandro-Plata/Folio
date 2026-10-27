// Sirve las imágenes de los documentos («/files/<doc>/<hash>.png») desde el
// espacio de trabajo, igual que el servidor de archivos de Wails en escritorio.
package es.folio.app;

import android.webkit.MimeTypeMap;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import es.folio.mobile.Mobile;
import java.io.File;
import java.io.FileInputStream;
import java.util.HashMap;
import java.util.Map;

public class FolioWebViewClient extends BridgeWebViewClient {
    public FolioWebViewClient(Bridge bridge) {
        super(bridge);
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        String path = request.getUrl().getPath();
        if (path == null || !path.startsWith("/files/")) {
            return super.shouldInterceptRequest(view, request);
        }
        try {
            File file = new File(Mobile.assetPath(path));
            String ext = file.getName().contains(".") ? file.getName().substring(file.getName().lastIndexOf('.') + 1).toLowerCase() : "";
            String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
            WebResourceResponse res = new WebResourceResponse(mime != null ? mime : "application/octet-stream", null, new FileInputStream(file));
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "max-age=31536000, immutable");
            res.setResponseHeaders(headers);
            return res;
        } catch (Exception e) {
            return new WebResourceResponse("text/plain", "utf-8", 404, "No encontrado", new HashMap<>(), null);
        }
    }
}
