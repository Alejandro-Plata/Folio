// Escribe en un archivo el PDF que genera un PrintDocumentAdapter (sin diálogo).
// Va en el paquete android.print porque los callbacks de diseño y escritura
// solo se pueden crear ahí.
package android.print;

import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import java.io.File;

public class PdfWriter {
    public interface Done {
        void ok();

        void fail(String message);
    }

    public static void write(final PrintDocumentAdapter adapter, PrintAttributes attrs, final File out, final Done done) {
        adapter.onLayout(null, attrs, new CancellationSignal(), new PrintDocumentAdapter.LayoutResultCallback() {
            @Override
            public void onLayoutFinished(PrintDocumentInfo info, boolean changed) {
                try {
                    final ParcelFileDescriptor fd = ParcelFileDescriptor.open(out,
                            ParcelFileDescriptor.MODE_CREATE | ParcelFileDescriptor.MODE_TRUNCATE | ParcelFileDescriptor.MODE_READ_WRITE);
                    adapter.onWrite(new PageRange[]{PageRange.ALL_PAGES}, fd, new CancellationSignal(),
                            new PrintDocumentAdapter.WriteResultCallback() {
                                @Override
                                public void onWriteFinished(PageRange[] pages) {
                                    try {
                                        fd.close();
                                    } catch (Exception ignored) {
                                    }
                                    done.ok();
                                }

                                @Override
                                public void onWriteFailed(CharSequence error) {
                                    done.fail(String.valueOf(error));
                                }
                            });
                } catch (Exception e) {
                    done.fail(String.valueOf(e.getMessage()));
                }
            }

            @Override
            public void onLayoutFailed(CharSequence error) {
                done.fail(String.valueOf(error));
            }
        }, null);
    }
}
