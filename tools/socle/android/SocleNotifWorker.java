package __PACKAGE__;

// Relève du fil de notifications en arrière-plan (base commune des applications IAM : source
// iam-erp/tools/socle ; ne pas modifier ici). Planifiée par WorkManager toutes les 15 minutes quand
// le téléphone a du réseau ; survit au redémarrage du téléphone et à la fermeture de l'application.

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

public class SocleNotifWorker extends Worker {
    static final String WORK = "socle-notifications";
    static final String CHANNEL = "socle_notifications";
    static final String EXTRA_URL = "socle_url";

    public SocleNotifWorker(@NonNull Context ctx, @NonNull WorkerParameters params) {
        super(ctx, params);
    }

    static void schedule(Context ctx) {
        Constraints c = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(SocleNotifWorker.class, 15, TimeUnit.MINUTES).setConstraints(c).build();
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.UPDATE, req);
    }

    static void cancel(Context ctx) {
        WorkManager.getInstance(ctx).cancelUniqueWork(WORK);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        SharedPreferences p = SocleNotifPlugin.prefs(ctx);
        String server = p.getString("server", "");
        String token = p.getString("token", "");
        if (server.isEmpty() || token.isEmpty()) return Result.success();
        long last = p.getLong("last", -1);
        HttpURLConnection con = null;
        try {
            con = (HttpURLConnection) new URL(server + "/api/socle/notifications?since=" + last).openConnection();
            con.setConnectTimeout(15000);
            con.setReadTimeout(20000);
            con.setRequestProperty("Authorization", "Bearer " + token);
            con.setRequestProperty("Accept", "application/json");
            int status = con.getResponseCode();
            // Session fermée ou expirée : plus rien à relever tant que l'application ne s'est pas reconnectée
            if (status == 401) {
                p.edit().remove("token").apply();
                return Result.success();
            }
            if (status != 200) return Result.retry();
            JSONObject data = new JSONObject(read(con.getInputStream())).getJSONObject("data");
            JSONArray items = data.optJSONArray("items");
            if (items != null) for (int i = 0; i < items.length(); i++) show(ctx, items.getJSONObject(i));
            p.edit().putLong("last", data.optLong("last", last)).apply();
            return Result.success();
        } catch (Exception e) {
            return Result.retry();
        } finally {
            if (con != null) con.disconnect();
        }
    }

    private static String read(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        in.close();
        return out.toString(StandardCharsets.UTF_8.name());
    }

    private static void show(Context ctx, JSONObject n) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = ctx.getSystemService(NotificationManager.class);
            if (nm != null && nm.getNotificationChannel(CHANNEL) == null)
                nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Notifications", NotificationManager.IMPORTANCE_DEFAULT));
        }
        int id = (int) (n.optLong("id", System.currentTimeMillis()) & 0x7fffffff);
        Intent open = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        open.putExtra(EXTRA_URL, n.optString("url", "/"));
        PendingIntent pi = PendingIntent.getActivity(ctx, id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String body = n.optString("body", "");
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(ctx.getApplicationInfo().icon)
            .setContentTitle(n.optString("title", ""))
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(pi);
        String tag = n.optString("tag", "");
        try {
            if (tag.isEmpty()) NotificationManagerCompat.from(ctx).notify(id, b.build());
            else NotificationManagerCompat.from(ctx).notify(tag, 0, b.build());
        } catch (SecurityException ignored) {
            // Notifications refusées par l'utilisateur
        }
    }
}
