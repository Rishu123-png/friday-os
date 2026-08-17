#!/usr/bin/env bash
# Rebuilds the local javac check environment (/tmp is wiped between sessions).
# Usage: bash tools/buildenv.sh   -> then tools/javac-check.sh works.
set -e
mkdir -p /tmp/p34 /tmp/capstubs/src/com/getcapacitor/annotation /tmp/capstubs/src/androidx/core/content /tmp/capstubs/src/com/rishu/fridayos /tmp/capstubs/out /tmp/jout

if [ ! -f /tmp/p34/android-34/android.jar ]; then
  echo "downloading android-34 platform..."
  (cd /tmp/p34 && curl -sL "https://dl.google.com/android/repository/platform-34-ext7_r03.zip" -o p34.zip && unzip -qo p34.zip)
fi
if [ ! -f /tmp/kotlin-stdlib.jar ]; then
  curl -sL "https://repo1.maven.org/maven2/org/jetbrains/kotlin/kotlin-stdlib/1.9.25/kotlin-stdlib-1.9.25.jar" -o /tmp/kotlin-stdlib.jar
fi

cat > /tmp/capstubs/src/com/getcapacitor/JSObject.java << 'EOF'
package com.getcapacitor;
public class JSObject {
    public JSObject() {}
    public JSObject put(String k, String v) { return this; }
    public JSObject put(String k, int v) { return this; }
    public JSObject put(String k, long v) { return this; }
    public JSObject put(String k, boolean v) { return this; }
    public JSObject put(String k, double v) { return this; }
    public JSObject put(String k, Object v) { return this; }
    public String getString(String k) { return null; }
    public String getString(String k, String d) { return d; }
    public Integer getInt(String k) { return null; }
    public Boolean getBoolean(String k) { return null; }
    public boolean has(String k) { return false; }
}
EOF
cat > /tmp/capstubs/src/com/getcapacitor/JSArray.java << 'EOF'
package com.getcapacitor;
public class JSArray {
    public JSArray() {}
    public void put(Object o) {}
    public int length() { return 0; }
    public Object get(int i) { return null; }
}
EOF
cat > /tmp/capstubs/src/com/getcapacitor/PluginCall.java << 'EOF'
package com.getcapacitor;
public class PluginCall {
    public String getString(String k) { return null; }
    public String getString(String k, String d) { return d; }
    public Integer getInt(String k) { return null; }
    public int getInt(String k, int d) { return d; }
    public Boolean getBoolean(String k) { return null; }
    public boolean getBoolean(String k, boolean d) { return d; }
    public Double getDouble(String k) { return null; }
    public Double getDouble(String k, Double d) { return d; }
    public Float getFloat(String k) { return null; }
    public JSArray getArray(String k) { return null; }
    public JSObject getObject(String k) { return null; }
    public JSObject getData() { return null; }
    public void resolve() {}
    public void resolve(JSObject o) {}
    public void reject(String m) {}
    public void reject(String m, Throwable t) {}
    public void reject(String m, String c, Exception e) {}
    public void setKeepAlive(boolean b) {}
}
EOF
cat > /tmp/capstubs/src/com/getcapacitor/Plugin.java << 'EOF'
package com.getcapacitor;
import android.app.Activity;
import android.content.Context;
public class Plugin {
    public void load() {}
    public Activity getActivity() { return null; }
    public Context getContext() { return null; }
    public void notifyListeners(String n, JSObject o) {}
    public void notifyListeners(String n, JSObject o, boolean k) {}
    protected void handleOnDestroy() {}
    protected void handleOnPause() {}
    protected void handleOnResume() {}
    public String getLogTag() { return "Plugin"; }
}
EOF
cat > /tmp/capstubs/src/com/getcapacitor/PluginMethod.java << 'EOF'
package com.getcapacitor;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME) @Target(ElementType.METHOD)
public @interface PluginMethod {
    String RETURN_CALLBACK = "callback";
    String RETURN_NONE = "none";
    String RETURN_PROMISE = "promise";
    String returnType() default RETURN_PROMISE;
}
EOF
cat > /tmp/capstubs/src/com/getcapacitor/annotation/CapacitorPlugin.java << 'EOF'
package com.getcapacitor.annotation;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME) @Target(ElementType.TYPE)
public @interface CapacitorPlugin {
    String name() default "";
    String[] permissions() default {};
}
EOF
cat > /tmp/capstubs/src/androidx/core/content/ContextCompat.java << 'EOF'
package androidx.core.content;
import android.content.Context;
public class ContextCompat {
    public static int checkSelfPermission(Context c, String p) { return 0; }
    public static java.util.concurrent.Executor getMainExecutor(Context c) { return Runnable::run; }
}
EOF
cat > /tmp/capstubs/src/androidx/core/content/FileProvider.java << 'EOF'
package androidx.core.content;
import android.content.Context;
import android.net.Uri;
import java.io.File;
public class FileProvider extends android.content.ContentProvider {
    public static Uri getUriForFile(Context c, String authority, File file) { return Uri.parse("content://" + authority + "/share/" + file.getName()); }
    public boolean onCreate() { return true; }
    public android.database.Cursor query(Uri u, String[] p, String s, String[] a, String o) { return null; }
    public String getType(Uri u) { return "image/jpeg"; }
    public Uri insert(Uri u, android.content.ContentValues v) { return null; }
    public int delete(Uri u, String s, String[] a) { return 0; }
    public int update(Uri u, android.content.ContentValues v, String s, String[] a) { return 0; }
}
EOF
cat > /tmp/capstubs/src/com/rishu/fridayos/R.java << 'EOF'
package com.rishu.fridayos;
public final class R {
    public static final class layout { public static int friday_widget; }
    public static final class id { public static int widget_root; public static int widget_text; public static int widget_meta; }
    public static final class drawable { public static int ic_btn_speak_now; }
}
EOF


# v15 Phase 9: androidx.biometric stub (compile-check only; real dep in build.gradle)
mkdir -p /tmp/capstubs/src/androidx/fragment/app
cat > /tmp/capstubs/src/androidx/fragment/app/FragmentActivity.java << 'EOJ'
package androidx.fragment.app;
public class FragmentActivity extends android.app.Activity {}
EOJ
mkdir -p /tmp/capstubs/src/androidx/biometric
cat > /tmp/capstubs/src/androidx/biometric/BiometricPrompt.java << 'EOJ'
package androidx.biometric;
public class BiometricPrompt {
    public static class PromptInfo {
        public static class Builder {
            public Builder() {}
            public Builder setTitle(String t) { return this; }
            public Builder setSubtitle(String s) { return this; }
            public Builder setNegativeButtonText(String s) { return this; }
            public Builder setAllowedAuthenticators(int a) { return this; }
            public PromptInfo build() { return new PromptInfo(); }
        }
    }
    public static class CryptoObject {}
    public static class AuthenticationResult { public CryptoObject getCryptoObject() { return null; } }
    public abstract static class AuthenticationCallback {
        public void onAuthenticationSucceeded(AuthenticationResult r) {}
        public void onAuthenticationError(int c, CharSequence e) {}
        public void onAuthenticationFailed() {}
    }
    public BiometricPrompt(androidx.fragment.app.FragmentActivity a, java.util.concurrent.Executor e, AuthenticationCallback c) {}
    public void authenticate(PromptInfo p) {}
}
EOJ
cat > /tmp/capstubs/src/androidx/biometric/BiometricManager.java << 'EOJ'
package androidx.biometric;
public class BiometricManager {
    public static class Authenticators { public static final int BIOMETRIC_WEAK = 1; public static final int DEVICE_CREDENTIAL = 2; }
}
EOJ
echo "biometric stub added"

# --- Complete the stub set so javac-check.sh compiles ALL native sources ---
mkdir -p /tmp/capstubs/src/androidx/annotation /tmp/capstubs/src/androidx/core/app
mkdir -p /tmp/capstubs/src/com/google/common/util/concurrent
# androidx.annotation
cat > /tmp/capstubs/src/androidx/annotation/NonNull.java << 'EOF'
package androidx.annotation;
import java.lang.annotation.*;
@Retention(RetentionPolicy.CLASS) public @interface NonNull {}
EOF
# androidx.core.app.NotificationCompat (incl. BigTextStyle, style, public version)
cat > /tmp/capstubs/src/androidx/core/app/NotificationCompat.java << 'EOF'
package androidx.core.app;
import android.app.Notification;
import android.app.PendingIntent;
import android.content.Context;
public class NotificationCompat {
    public static class Style { protected CharSequence mBigContentTitle; }
    public static class BigTextStyle extends Style {
        public BigTextStyle bigText(CharSequence t){return this;}
        public BigTextStyle setBigContentTitle(CharSequence t){return this;}
        public BigTextStyle setSummaryText(CharSequence t){return this;}
    }
    public static class Builder {
        public Builder(Context c, String ch) {}
        public Builder(Context c){}
        public Builder setSmallIcon(int i){return this;}
        public Builder setContentTitle(CharSequence t){return this;}
        public Builder setContentText(CharSequence t){return this;}
        public Builder setContentIntent(PendingIntent p){return this;}
        public Builder setPriority(int p){return this;}
        public Builder setOngoing(boolean b){return this;}
        public Builder setOnlyAlertOnce(boolean b){return this;}
        public Builder setProgress(int a,int b,boolean c){return this;}
        public Builder addAction(int i, CharSequence t, PendingIntent p){return this;}
        public Builder setCategory(String c){return this;}
        public Builder setVisibility(int v){return this;}
        public Builder setWhen(long w){return this;}
        public Builder setAutoCancel(boolean b){return this;}
        public Builder setContentInfo(CharSequence c){return this;}
        public Builder setTicker(CharSequence c){return this;}
        public Builder setStyle(Style s){return this;}
        public Builder setPublicVersion(Notification n){return this;}
        public Builder setChannelId(String id){return this;}
        public Notification build(){return new Notification();}
    }
    public static final int PRIORITY_LOW=0, PRIORITY_MIN=-2, PRIORITY_DEFAULT=0, PRIORITY_HIGH=1, PRIORITY_MAX=2;
    public static final int VISIBILITY_PUBLIC=1, VISIBILITY_PRIVATE=0, VISIBILITY_SECRET=-1;
}
EOF
# androidx.work (WorkManager API used by FridayDownloadWorker/Downloads/Diagnostics)
mkdir -p /tmp/capstubs/src/androidx/work
cat > /tmp/capstubs/src/androidx/work/Worker.java << 'EOF'
package androidx.work;
import android.content.Context;
import androidx.annotation.NonNull;
public abstract class Worker {
    public Worker(@NonNull Context c, @NonNull WorkerParameters p){}
    public abstract Result doWork();
    public Context getApplicationContext(){return null;}
    public Data getInputData(){return new Data();}
    public boolean isStopped(){return false;}
    public int getRunAttemptCount(){return 0;}
    public com.google.common.util.concurrent.ListenableFuture<Void> setForegroundAsync(ForegroundInfo i){return null;}
    public com.google.common.util.concurrent.ListenableFuture<Void> setProgressAsync(Data d){return null;}
    @NonNull public ForegroundInfo getForegroundInfo(){return null;}
    public static class Result {
        public static Result success(){return new Result();}
        public static Result failure(){return new Result();}
        public static Result retry(){return new Result();}
        public static Result success(Data d){return new Result();}
        public static Result failure(Data d){return new Result();}
    }
}
EOF
cat > /tmp/capstubs/src/androidx/work/WorkerParameters.java << 'EOF'
package androidx.work;
public class WorkerParameters {}
EOF
cat > /tmp/capstubs/src/androidx/work/Data.java << 'EOF'
package androidx.work;
public class Data {
    public static class Builder {
        public Builder putString(String k,String v){return this;}
        public Builder putInt(String k,int v){return this;}
        public Builder putLong(String k,long v){return this;}
        public Builder putBoolean(String k,boolean v){return this;}
        public Data build(){return new Data();}
    }
    public String getString(String k,String d){return d;}
    public String getString(String k){return null;}
    public int getInt(String k,int d){return d;}
    public int getInt(String k){return 0;}
    public long getLong(String k,long d){return d;}
    public long getLong(String k){return 0;}
    public boolean getBoolean(String k,boolean d){return d;}
    public boolean getBoolean(String k){return false;}
}
EOF
cat > /tmp/capstubs/src/androidx/work/WorkInfo.java << 'EOF'
package androidx.work;
import java.util.UUID;
public class WorkInfo {
    public enum State { ENQUEUED, RUNNING, SUCCEEDED, FAILED, BLOCKED, CANCELLED;
        public boolean isFinished(){return this==SUCCEEDED||this==FAILED||this==CANCELLED;} }
    public State getState(){return State.RUNNING;}
    public UUID getId(){return UUID.randomUUID();}
    public Data getProgress(){return new Data();}
    public Data getOutputData(){return new Data();}
    public java.util.List<String> getTags(){return null;}
}
EOF
cat > /tmp/capstubs/src/androidx/work/WorkManager.java << 'EOF'
package androidx.work;
import android.content.Context;
import com.google.common.util.concurrent.ListenableFuture;
import java.util.List;
import java.util.UUID;
public class WorkManager {
    public static WorkManager getInstance(Context c){return new WorkManager();}
    public Operation enqueue(OneTimeWorkRequest r){return new Operation();}
    public Operation enqueueUniqueWork(String name, ExistingWorkPolicy p, OneTimeWorkRequest r){return new Operation();}
    public void cancelUniqueWork(String name){}
    public void cancelWorkById(UUID id){}
    public ListenableFuture<List<WorkInfo>> getWorkInfosForUniqueWork(String name){return null;}
    public ListenableFuture<List<WorkInfo>> getWorkInfosByTag(String tag){return null;}
    public ListenableFuture<WorkInfo> getWorkInfoById(UUID id){return null;}
    public static class Operation { public ListenableFuture<Void> getResult(){return null;} }
}
EOF
cat > /tmp/capstubs/src/androidx/work/OneTimeWorkRequest.java << 'EOF'
package androidx.work;
import java.util.UUID;
public class OneTimeWorkRequest {
    public UUID getId(){return UUID.randomUUID();}
    public static class Builder {
        public Builder(){}
        public Builder(Class<? extends Worker> c){}
        public Builder setConstraints(Constraints c){return this;}
        public Builder setInputData(Data d){return this;}
        public Builder setBackoffCriteria(BackoffPolicy p, long d, java.util.concurrent.TimeUnit t){return this;}
        public Builder setInitialDelay(long d, java.util.concurrent.TimeUnit t){return this;}
        public Builder addTag(String t){return this;}
        public OneTimeWorkRequest build(){return new OneTimeWorkRequest();}
    }
}
EOF
cat > /tmp/capstubs/src/androidx/work/Constraints.java << 'EOF'
package androidx.work;
public class Constraints {
    public static class Builder {
        public Builder setRequiredNetworkType(NetworkType n){return this;}
        public Builder setRequiresBatteryNotLow(boolean b){return this;}
        public Builder setRequiresCharging(boolean b){return this;}
        public Builder setRequiresStorageNotLow(boolean b){return this;}
        public Builder setRequiresDeviceIdle(boolean b){return this;}
        public Constraints build(){return new Constraints();}
    }
}
EOF
cat > /tmp/capstubs/src/androidx/work/NetworkType.java << 'EOF'
package androidx.work;
public enum NetworkType { CONNECTED, NOT_ROAMING, CONNECTED_UNMETERED, NOT_REQUIRED, NOT_METERED }
EOF
cat > /tmp/capstubs/src/androidx/work/BackoffPolicy.java << 'EOF'
package androidx.work;
public enum BackoffPolicy { EXPONENTIAL, LINEAR }
EOF
cat > /tmp/capstubs/src/androidx/work/ExistingWorkPolicy.java << 'EOF'
package androidx.work;
public enum ExistingWorkPolicy { REPLACE, KEEP, APPEND, APPEND_OR_REPLACE }
EOF
cat > /tmp/capstubs/src/androidx/work/ForegroundInfo.java << 'EOF'
package androidx.work;
import android.app.Notification;
public class ForegroundInfo {
    public ForegroundInfo(int id, Notification n){}
}
EOF
# androidx.appcompat (AppCompatActivity base)
mkdir -p /tmp/capstubs/src/androidx/appcompat/app
cat > /tmp/capstubs/src/androidx/appcompat/app/AppCompatActivity.java << 'EOF'
package androidx.appcompat.app;
public class AppCompatActivity extends androidx.fragment.app.FragmentActivity {}
EOF
# com.google.common ListenableFuture
mkdir -p /tmp/capstubs/src/com/google/common/util/concurrent
cat > /tmp/capstubs/src/com/google/common/util/concurrent/ListenableFuture.java << 'EOF'
package com.google.common.util.concurrent;
public interface ListenableFuture<V> extends java.util.concurrent.Future<V> {}
EOF
# R: add drawable/string/xml/raw members used by native sources
cat > /tmp/capstubs/src/com/rishu/fridayos/R.java << 'EOF'
package com.rishu.fridayos;
public final class R {
    public static final class layout { public static int friday_widget; }
    public static final class id { public static int widget_root; public static int widget_text; public static int widget_meta; }
    public static final class drawable { public static int ic_btn_speak_now; public static int ic_stat_icon; }
    public static final class string { public static int widget_description; }
    public static final class xml { public static int friday_widget_info; }
    public static final class raw { public static int keep; }
}
EOF
# PluginCall: add getLong
cat > /tmp/capstubs/src/com/getcapacitor/PluginCall.java << 'EOF'
package com.getcapacitor;
public class PluginCall {
    public String getString(String k) { return null; }
    public String getString(String k, String d) { return d; }
    public Integer getInt(String k) { return null; }
    public int getInt(String k, int d) { return d; }
    public Long getLong(String k) { return null; }
    public long getLong(String k, long d) { return d; }
    public Boolean getBoolean(String k) { return null; }
    public boolean getBoolean(String k, boolean d) { return d; }
    public Double getDouble(String k) { return null; }
    public Double getDouble(String k, Double d) { return d; }
    public Float getFloat(String k) { return null; }
    public JSArray getArray(String k) { return null; }
    public JSObject getObject(String k) { return null; }
    public JSObject getData() { return null; }
    public void resolve() {}
    public void resolve(JSObject o) {}
    public void reject(String m) {}
    public void reject(String m, Throwable t) {}
    public void reject(String m, String c, Exception e) {}
    public void setKeepAlive(boolean b) {}
}
EOF

echo "full stub set added"
javac -cp /tmp/p34/android-34/android.jar -d /tmp/capstubs/out $(find /tmp/capstubs/src -name '*.java')
echo "BUILDENV READY"
