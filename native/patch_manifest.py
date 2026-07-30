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
    "android.permission.FOREGROUND_SERVICE_SPECIAL_USE",
    "android.permission.RECEIVE_BOOT_COMPLETED",
    "android.permission.WAKE_LOCK",
    "android.permission.CALL_PHONE",
    "android.permission.READ_CONTACTS",
    "android.permission.SEND_SMS",
    "android.permission.READ_SMS",
    "android.permission.RECEIVE_SMS",
    "android.permission.READ_PHONE_STATE",
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

    io.open(PATH, 'w', encoding='utf-8').write(s)
    print('Manifest patched OK')
    print('Permissions:', s.count('<uses-permission'))
    print('Services   :', s.count('<service'))
    print('Receivers  :', s.count('<receiver'))


if __name__ == '__main__':
    main()
