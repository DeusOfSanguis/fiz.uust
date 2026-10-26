package ru.pacer.log;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/**
 * Приём ссылок из Pacer через «Поделиться».
 *
 * Pacer отдаёт ссылку как ACTION_SEND (текст) или ACTION_VIEW (когда тапнули
 * по ссылке в браузере). Здесь она передаётся в приложение параметром ?share=…,
 * а дальше его разбирает уже веб-часть (src/App.tsx) — тот же код, что и в браузере.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        handleIntent(getIntent());
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;

        String action = intent.getAction();
        String payload = null;

        if (Intent.ACTION_SEND.equals(action)) {
            String text = intent.getStringExtra(Intent.EXTRA_TEXT);
            String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
            StringBuilder sb = new StringBuilder();
            if (subject != null && !subject.isEmpty()) sb.append(subject).append('\n');
            if (text != null && !text.isEmpty()) sb.append(text);
            if (sb.length() > 0) payload = sb.toString();
        } else if (Intent.ACTION_VIEW.equals(action) && intent.getData() != null) {
            payload = intent.getData().toString();
        }

        if (payload == null) return;

        String url = "https://localhost/?share=" + URLEncoder.encode(payload, StandardCharsets.UTF_8);
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null) {
            final String target = url;
            webView.post(() -> webView.loadUrl(target));
        }
    }
}
