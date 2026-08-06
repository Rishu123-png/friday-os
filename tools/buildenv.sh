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
javac -cp /tmp/p34/android-34/android.jar -d /tmp/capstubs/out $(find /tmp/capstubs/src -name '*.java')
echo "BUILDENV READY"
