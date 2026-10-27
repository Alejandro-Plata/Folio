// Imprimir y crear PDF en Android: el HTML de exportación se carga en un
// WebView fuera de pantalla y se pasa por el sistema de impresión.
package es.folio.app;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.print.PdfWriter;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.webkit.WebView;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

@CapacitorPlugin(name = "FolioPrint")
public class FolioPrintPlugin extends Plugin {
    private interface Ready {
        void run(WebView web);
    }

    /** Carga el HTML en un WebView sin mostrar y avisa cuando está listo (con las fuentes e imágenes). */
    private void load(final String html, final Ready ready) {
        getActivity().runOnUiThread(() -> {
            final WebView web = new WebView(getContext());
            web.getSettings().setJavaScriptEnabled(true);
            web.setWebViewClient(new FolioWebViewClient(getBridge()) {
                @Override
                public void onPageFinished(WebView view, String url) {
                    // Margen para que se apliquen fuentes e imágenes antes de paginar
                    new Handler(Looper.getMainLooper()).postDelayed(() -> ready.run(view), 300);
                }
            });
            web.loadDataWithBaseURL("https://localhost/", html, "text/html", "utf-8", null);
        });
    }

    @PluginMethod
    public void print(final PluginCall call) {
        final String html = call.getString("html", "");
        final String title = call.getString("title", "Folio");
        load(html, web -> {
            PrintManager pm = (PrintManager) getContext().getSystemService(Context.PRINT_SERVICE);
            pm.print(title, web.createPrintDocumentAdapter(title), new PrintAttributes.Builder().build());
            call.resolve();
        });
    }

    @PluginMethod
    public void toPdf(final PluginCall call) {
        final String html = call.getString("html", "");
        final String path = call.getString("path");
        final String paper = call.getString("paper", "A4");
        final boolean landscape = Boolean.TRUE.equals(call.getBoolean("landscape", false));
        if (path == null) {
            call.reject("Falta la ruta del PDF");
            return;
        }
        load(html, web -> {
            PrintAttributes.MediaSize size;
            switch (paper) {
                case "A5": size = PrintAttributes.MediaSize.ISO_A5; break;
                case "Letter": size = PrintAttributes.MediaSize.NA_LETTER; break;
                case "Legal": size = PrintAttributes.MediaSize.NA_LEGAL; break;
                default: size = PrintAttributes.MediaSize.ISO_A4;
            }
            // Los márgenes los pone el propio HTML (@page), igual que en escritorio
            PrintAttributes attrs = new PrintAttributes.Builder()
                    .setMediaSize(landscape ? size.asLandscape() : size)
                    .setResolution(new PrintAttributes.Resolution("pdf", "pdf", 600, 600))
                    .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                    .build();
            PdfWriter.write(web.createPrintDocumentAdapter("folio"), attrs, new File(path), new PdfWriter.Done() {
                @Override
                public void ok() {
                    call.resolve();
                }

                @Override
                public void fail(String message) {
                    call.reject("No se pudo crear el PDF: " + message);
                }
            });
        });
    }
}
