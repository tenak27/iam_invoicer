package __PACKAGE__;

// Notifications en arrière-plan (base commune des applications IAM : source iam-erp/tools/socle,
// recopiée par sync.mjs ; ne pas modifier ici). L'interface transmet l'adresse du serveur et le
// jeton de session ; SocleNotifWorker relève ensuite le fil toutes les 15 minutes, application
// fermée et téléphone en veille, et affiche les nouveautés comme notifications du système.

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(name = "SocleNotif", permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) })
public class SocleNotifPlugin extends Plugin {
    static final String PREFS = "socle_notifications";

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void configure(PluginCall call) {
        String server = call.getString("server", "");
        String token = call.getString("token", "");
        if (server.isEmpty() || token.isEmpty()) {
            call.reject("Adresse du serveur et session nécessaires.");
            return;
        }
        SharedPreferences p = prefs(getContext());
        // Autre compte ou autre serveur : on repart du dernier numéro (rien d'ancien n'est rejoué)
        boolean changed = !server.equals(p.getString("server", "")) || !token.equals(p.getString("token", ""));
        SharedPreferences.Editor e = p.edit().putString("server", server).putString("token", token).putString("app", call.getString("app", ""));
        if (changed) e.putLong("last", -1);
        e.apply();
        SocleNotifWorker.schedule(getContext());
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        prefs(getContext()).edit().remove("token").putLong("last", -1).apply();
        SocleNotifWorker.cancel(getContext());
        call.resolve();
    }

    @PluginMethod
    public void check(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
        call.resolve(r);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "permissionDone");
            return;
        }
        check(call);
    }

    @PermissionCallback
    private void permissionDone(PluginCall call) {
        check(call);
    }

    /** Écran demandé par la notification touchée au lancement de l'application (puis oublié). */
    @PluginMethod
    public void launchUrl(PluginCall call) {
        JSObject r = new JSObject();
        Intent intent = getActivity() != null ? getActivity().getIntent() : null;
        String url = intent != null ? intent.getStringExtra(SocleNotifWorker.EXTRA_URL) : null;
        if (url != null) intent.removeExtra(SocleNotifWorker.EXTRA_URL);
        r.put("url", url == null ? "" : url);
        call.resolve(r);
    }

    /** Notification touchée alors que l'application était ouverte en arrière-plan. */
    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        String url = intent.getStringExtra(SocleNotifWorker.EXTRA_URL);
        if (url == null) return;
        JSObject r = new JSObject();
        r.put("url", url);
        notifyListeners("open", r, true);
    }
}
