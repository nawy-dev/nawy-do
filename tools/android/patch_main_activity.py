#!/usr/bin/env python3
"""Makes the generated MainActivity accept text shared from other apps (ADR 0048).

The android/ folder is generated in CI by `npx cap add android` and never committed. Android hands
shared text to an app as an ACTION_SEND intent; Capacitor's App plugin only reports links (VIEW).
So MainActivity turns a SEND into a link `nawydo://share?share_title=..&share_text=..` before
Capacitor sees it, and the web app reads it like the PWA's share_target query.
The same script adds the «new intention» shortcut on the app icon (long-press): a static shortcut
whose intent is the link `nawydo://new`.
Usage: patch_main_activity.py <MainActivity.java> <AndroidManifest.xml>
"""
import os
import sys

JAVA = """package todo.nawy.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        setIntent(asLink(getIntent()));
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(asLink(intent));
    }

    /** Shared text (ACTION_SEND) becomes a nawydo://share link; anything else passes through. */
    private static Intent asLink(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return intent;
        // Reopened from the recent-apps list: the share was handled when it first arrived.
        if ((intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return intent;
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        String title = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        if (text == null && title == null) return intent;
        Uri.Builder link = new Uri.Builder().scheme("nawydo").authority("share");
        if (title != null) link.appendQueryParameter("share_title", title);
        if (text != null) link.appendQueryParameter("share_text", text);
        return new Intent(Intent.ACTION_VIEW, link.build());
    }
}
"""

FILTER = """
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="text/plain" />
            </intent-filter>
"""


META = """
            <meta-data android:name="android.app.shortcuts" android:resource="@xml/shortcuts" />
"""

SHORTCUTS = """<?xml version="1.0" encoding="utf-8"?>
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
    <shortcut
        android:shortcutId="new_task"
        android:enabled="true"
        android:icon="@mipmap/ic_launcher"
        android:shortcutShortLabel="@string/shortcut_new_short"
        android:shortcutLongLabel="@string/shortcut_new_long">
        <intent
            android:action="android.intent.action.VIEW"
            android:data="nawydo://new"
            android:targetPackage="todo.nawy.app"
            android:targetClass="todo.nawy.app.MainActivity" />
    </shortcut>
</shortcuts>
"""

STRINGS = {
    "values": ("نية جديدة", "نية جديدة في ناوي دو"),
    "values-en": ("New intention", "New intention in Nawy To Do"),
}


def write(path: str, text: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "w", encoding="utf-8").write(text)


def main(java_path: str, manifest_path: str) -> None:
    write(java_path, JAVA)
    res = os.path.join(os.path.dirname(manifest_path), "res")
    write(os.path.join(res, "xml", "shortcuts.xml"), SHORTCUTS)
    for folder, (short, long) in STRINGS.items():
        write(
            os.path.join(res, folder, "nawy_shortcuts.xml"),
            '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
            f'    <string name="shortcut_new_short">{short}</string>\n'
            f'    <string name="shortcut_new_long">{long}</string>\n</resources>\n',
        )
    text = open(manifest_path, encoding="utf-8").read()
    if "android.intent.action.SEND" not in text:
        # Into the first <activity> (MainActivity), before it closes.
        text = text.replace("</activity>", FILTER + META + "        </activity>", 1)
        open(manifest_path, "w", encoding="utf-8").write(text)
    print("MainActivity patched; SEND filter present:", "android.intent.action.SEND" in text)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
