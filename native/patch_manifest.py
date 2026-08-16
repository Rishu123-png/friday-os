#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Injects permissions, services and receivers into AndroidManifest.xml. Run by Codemagic."""
import io, sys

PATH = 'android/app/src/main/AndroidManifest.xml'

PERMS = [
    "android.permission.INTERNET",
    "android.permission.RECORD_AUDIO",
    "android.permission.CAMERA",
    "android.permission.VIBRATE",
    "android.permission.ACCESS_FINE_LOCATION",
    "android.permission.ACCESS_COARSE_LOCATION",
    "android.permission.POST_NOTIFICATIONS",
    "android.permission.SCHEDULE_EXACT_ALARM",
    "android.permission.USE_EXACT_ALARM",
    "com.android.alarm.permission.SET_ALARM",
    "android.permission.FOREGROUND_SERVICE",
    "android.permission.FOREGROUND_SERVICE_DATA_SYNC",
    "android.permission.FOREGROUND_SERVICE_SPECIAL_USE",
    "android.permission.ACTIVITY_RECOGNITION",
    "android.permission.PACKAGE_USAGE_STATS",
    "android.permission.health.READ_STEPS",
    "android.permission.RECEIVE_BOOT_COMPLETED",
    "android.permission.WAKE_LOCK",
    "android.permission.CALL_PHONE",
    "android.permission.READ_CONTACTS",
    "android.permission.SEND_SMS",
    "android.permission.READ_SMS",
    "android.permission.RECEIVE_SMS",
    "android.permission.READ_PHONE_STATE",
    "android.permission.ANSWER_PHONE_CALLS",
    "android.permission.SYSTEM_ALERT_WINDOW",
    "android.permission.WRITE_SETTINGS",
    "android.permission.ACCESS_NOTIFICATION_POLICY",
    "android.permission.CHANGE_WIFI_STATE",
    "android.permission.ACCESS_WIFI_STATE",
    "android.permission.BLUETOOTH",
    "android.permission.BLUETOOTH_ADMIN",
    "android.permission.BLUETOOTH_CONNECT",
    "android.permission.MODIFY_AUDIO_SETTINGS",
    "android.permission.FLASHLIGHT",
    "android.permission.QUERY_ALL_PACKAGES",
    "android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS",
    "android.permission.ACCESS_BACKGROUND_LOCATION",
    "android.permission.WRITE_EXTERNAL_STORAGE",   # legacy save-to-gallery (< API 29)
]

QUERIES = """    <queries>
        <intent><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent>
        <intent><action android:name="android.intent.action.VIEW"/><data android:scheme="tel"/></intent>
        <intent><action android:name="android.intent.action.VIEW"/><data android:scheme="sms"/></intent>
        <intent><action android:name="android.intent.action.VIEW"/><data android:scheme="https"/></intent>
        <package android:name="com.whatsapp"/>
        <package android:name="com.whatsapp.w4b"/>
    </queries>
"""

SERVICES = """
        <service
            android:name=".FridayService"
            android:enabled="true"
            android:exported="false"
            android:foregroundServiceType="specialUse">
            <property
                android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"
                android:value="Personal assistant background processing"/>
        </service>

        <service
            android:name=".FridayBubbleService"
            android:enabled="true"
            android:exported="false"
            android:foregroundServiceType="specialUse">
            <property
                android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"
                android:value="Assistant overlay bubble"/>
        </service>

        <service
            android:name=".FridayNotificationService"
            android:label="FRIDAY"
            android:exported="true"
            android:permission="android.permission.BIND_NOTIFICATION_LISTENER_SERVICE">
            <intent-filter>
                <action android:name="android.service.notification.NotificationListenerService"/>
            </intent-filter>
        </service>

        <service
            android:name=".FridayAccessibility"
            android:label="FRIDAY Control"
            android:exported="true"
            android:permission="android.permission.BIND_ACCESSIBILITY_SERVICE">
            <intent-filter>
                <action android:name="android.accessibilityservice.AccessibilityService"/>
            </intent-filter>
            <meta-data
                android:name="android.accessibilityservice"
                android:resource="@xml/friday_accessibility"/>
        </service>

        <receiver
            android:name=".FridayBootReceiver"
            android:enabled="true"
            android:exported="true">
            <intent-filter android:priority="1000">
                <action android:name="android.intent.action.BOOT_COMPLETED"/>
                <action android:name="android.intent.action.QUICKBOOT_POWERON"/>
            </intent-filter>
        </receiver>

        <receiver
            android:name=".FridayGeofenceReceiver"
            android:enabled="true"
            android:exported="false"/>

        <!-- v10.3 HERALD: Call Guard (decline+explainer; works even when app asleep) -->
        <receiver
            android:name=".FridayCallGuard"
            android:enabled="true"
            android:exported="true">
            <intent-filter android:priority="1000">
                <action android:name="android.intent.action.PHONE_STATE"/>
            </intent-filter>
        </receiver>

        <receiver
            android:name=".FridayWidgetProvider"
            android:exported="false"
            android:label="FRIDAY Brief"
            android:icon="@mipmap/ic_launcher">
            <intent-filter>
                <action android:name="android.appwidget.action.APPWIDGET_UPDATE"/>
            </intent-filter>
            <meta-data
                android:name="android.appwidget.provider"
                android:resource="@xml/friday_widget_info"/>
        </receiver>

        <service
            android:name=".FridayTileService"
            android:exported="true"
            android:label="FRIDAY"
            android:icon="@mipmap/ic_launcher"
            android:permission="android.permission.BIND_QUICK_SETTINGS_TILE">
            <intent-filter>
                <action android:name="android.service.quicksettings.action.QS_TILE"/>
            </intent-filter>
        </service>
"""


def main():
    s = io.open(PATH, encoding='utf-8').read()

    add = ""
    for perm in PERMS:
        if 'android:name="%s"' % perm not in s:
            add += '    <uses-permission android:name="%s"/>\n' % perm

    if 'android.hardware.camera' not in s:
        add += '    <uses-feature android:name="android.hardware.camera" android:required="false"/>\n'

    if '<queries>' not in s:
        add += QUERIES

    if add:
        s = s.replace('<application', add + '\n    <application', 1)

    if 'FridayService' not in s:
        i = s.rindex('</application>')
        s = s[:i] + SERVICES + '\n    ' + s[i:]

    # v14.1: FileProvider for sharing images (ACTION_SEND with content:// URIs)
    if '.fileprovider' not in s:
        i = s.rindex('</application>')
        provider = (
            '\n        <provider\n'
            '            android:name="androidx.core.content.FileProvider"\n'
            '            android:authorities="com.rishu.fridayos.fileprovider"\n'
            '            android:exported="false"\n'
            '            android:grantUriPermissions="true">\n'
            '            <meta-data\n'
            '                android:name="android.support.FILE_PROVIDER_PATHS"\n'
            '                android:resource="@xml/file_paths"/>\n'
            '        </provider>\n'
        )
        s = s[:i] + provider + '    ' + s[i:]
        print('FileProvider added to manifest')

    # v9.0 APEX (A2): turn MainActivity into a share target - any app can
    # share text or images straight to FRIDAY ("Summarize this" flow).
    if 'android.intent.action.SEND' not in s and '.MainActivity' in s:
        act = s.index('.MainActivity')
        close = s.index('</activity>', act)
        block = s[act:close]
        insert_at = block.rindex('</intent-filter>') + len('</intent-filter>') if '</intent-filter>' in block else block.index('>')
        share = ('\n            <intent-filter>\n'
                 '                <action android:name="android.intent.action.SEND"/>\n'
                 '                <category android:name="android.intent.category.DEFAULT"/>\n'
                 '                <data android:mimeType="text/plain"/>\n'
                 '                <data android:mimeType="image/*"/>\n'
                 '            </intent-filter>')
        s = s[:act + insert_at] + share + s[act + insert_at:]
        print('Share target intent-filter added to MainActivity')

    io.open(PATH, 'w', encoding='utf-8').write(s)
    print('Manifest patched OK')
    print('Permissions:', s.count('<uses-permission'))
    print('Services   :', s.count('<service'))
    print('Receivers  :', s.count('<receiver'))


if __name__ == '__main__':
    main()
