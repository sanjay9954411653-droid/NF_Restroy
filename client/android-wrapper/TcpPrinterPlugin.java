package com.auraos.pos;

import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;

/**
 * Sends raw ESC/POS bytes to a WiFi / LAN (Ethernet) thermal printer over TCP,
 * normally port 9100. Used by the web app through Capacitor.
 */
@CapacitorPlugin(name = "TcpPrinter")
public class TcpPrinterPlugin extends Plugin {

    /** Opens and closes a connection, to confirm the printer is reachable. */
    @PluginMethod
    public void check(final PluginCall call) {
        final String host = call.getString("host");
        final int port = call.getInt("port", 9100);
        final int timeout = call.getInt("timeoutMs", 4000);
        if (host == null || host.isEmpty()) { call.reject("host is required"); return; }

        new Thread(() -> {
            try (Socket socket = new Socket()) {
                socket.connect(new InetSocketAddress(host, port), timeout);
                call.resolve(new JSObject());
            } catch (Exception e) {
                call.reject("Cannot reach " + host + ":" + port + " - " + e.getMessage());
            }
        }).start();
    }

    /** Sends base64-encoded bytes to the printer. */
    @PluginMethod
    public void print(final PluginCall call) {
        final String host = call.getString("host");
        final int port = call.getInt("port", 9100);
        final int timeout = call.getInt("timeoutMs", 6000);
        final String data = call.getString("data");
        if (host == null || host.isEmpty()) { call.reject("host is required"); return; }
        if (data == null) { call.reject("data is required"); return; }

        new Thread(() -> {
            try (Socket socket = new Socket()) {
                socket.connect(new InetSocketAddress(host, port), timeout);
                socket.setSoTimeout(timeout);
                OutputStream out = socket.getOutputStream();
                out.write(Base64.decode(data, Base64.DEFAULT));
                out.flush();
                call.resolve(new JSObject());
            } catch (Exception e) {
                call.reject("Print failed: " + e.getMessage());
            }
        }).start();
    }
}
