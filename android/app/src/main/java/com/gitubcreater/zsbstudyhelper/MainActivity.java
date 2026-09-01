package com.gitubcreater.zsbstudyhelper;

import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * 系统语音朗读桥：Android WebView 不实现 speechSynthesis，网页端会判定为
 * "设备不支持"。这里通过系统 TextToSpeech 引擎（与浏览器朗读背后是同一套
 * 系统语音包）向网页暴露同步桥，前端检测到 window.ZsbNativeTts 即走原生通道。
 */
public class MainActivity extends BridgeActivity {

  private TextToSpeech tts;
  private volatile boolean ttsReady = false;
  private CountDownLatch initLatch;
  private WebView hostWebView;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    if (getBridge() != null && getBridge().getWebView() != null) {
      hostWebView = getBridge().getWebView();
      hostWebView.addJavascriptInterface(new NativeTts(), "ZsbNativeTts");
    }
  }

  @Override
  public void onDestroy() {
    if (tts != null) {
      try {
        tts.shutdown();
      } catch (Exception ignored) {
      }
      tts = null;
      ttsReady = false;
    }
    super.onDestroy();
  }

  private void ensureTts() {
    synchronized (this) {
      if (tts != null) return;
      initLatch = new CountDownLatch(1);
      final MainActivity activity = this;
      tts = new TextToSpeech(getApplicationContext(), status -> {
        ttsReady = status == TextToSpeech.SUCCESS;
        if (ttsReady && tts != null) {
          try {
            tts.setLanguage(Locale.SIMPLIFIED_CHINESE);
          } catch (Exception ignored) {
          }
          tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override
            public void onStart(String utteranceId) {
              activity.emitTts("start", utteranceId, "0");
            }

            @Override
            public void onDone(String utteranceId) {
              activity.emitTts("end", utteranceId, "0");
            }

            @Override
            public void onError(String utteranceId) {
              activity.emitTts("error", utteranceId, "synthesis-failed");
            }

            @Override
            public void onStop(String utteranceId, boolean interrupted) {
              // 主动 stop（停止/暂停/切讲解）导致的中断，前端按静默处理。
              activity.emitTts("stopped", utteranceId, "0");
            }

            @Override
            public void onRangeStart(String utteranceId, int start, int end, int frame) {
              activity.emitTts("boundary", utteranceId, String.valueOf(start));
            }
          });
        }
        CountDownLatch latch = initLatch;
        if (latch != null) latch.countDown();
        activity.emitTts("ready", "engine", ttsReady ? "1" : "0");
      });
    }
  }

  /** JS 桥线程内有限等待 TTS 引擎初始化；voices/info 不等待，speak 才等待。 */
  private boolean awaitTtsReady(long timeoutSeconds) {
    ensureTts();
    if (ttsReady) return true;
    CountDownLatch latch = initLatch;
    try {
      return latch != null && latch.await(timeoutSeconds, TimeUnit.SECONDS) && ttsReady;
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      return ttsReady;
    }
  }

  private void emitTts(String type, String utteranceId, String extra) {
    final WebView web = hostWebView;
    if (web == null) return;
    final String safeId = utteranceId == null ? "" : utteranceId.replace("'", "");
    final String script = "window.__zsbTtsEvent && window.__zsbTtsEvent('" + type + "','" + safeId + "','" + extra + "')";
    web.post(() -> {
      try {
        web.evaluateJavascript(script, null);
      } catch (Exception ignored) {
      }
    });
  }

  public class NativeTts {

    /** 引擎就绪状态；不做长等待，未就绪返回 false，前端等 ready 事件后重拉。 */
    @JavascriptInterface
    public String info() {
      ensureTts();
      return "{\"ready\":" + (ttsReady ? "true" : "false") + "}";
    }

    @JavascriptInterface
    public String voices() {
      if (tts == null || !ttsReady) return "[]";
      try {
        JSONArray list = new JSONArray();
        for (Voice voice : tts.getVoices()) {
          if (voice == null) continue;
          Locale locale = voice.getLocale();
          JSONObject item = new JSONObject();
          item.put("voiceURI", voice.getName());
          item.put("name", voice.getName());
          item.put("lang", locale == null ? "zh-CN" : locale.toLanguageTag());
          item.put("default", false);
          item.put("localService", !voice.isNetworkConnectionRequired());
          list.put(item);
        }
        return list.toString();
      } catch (Exception e) {
        return "[]";
      }
    }

    @JavascriptInterface
    public boolean speak(String utteranceId, String text, double rate, String voiceName) {
      if (!awaitTtsReady(4) || tts == null || text == null || text.length() == 0) return false;
      try {
        boolean voiceApplied = false;
        if (voiceName != null && voiceName.length() > 0) {
          for (Voice voice : tts.getVoices()) {
            if (voice != null && voiceName.equals(voice.getName())) {
              if (tts.setVoice(voice) == TextToSpeech.SUCCESS) {
                voiceApplied = true;
              }
              break;
            }
          }
        }
        if (!voiceApplied) {
          tts.setLanguage(Locale.SIMPLIFIED_CHINESE);
        }
        tts.setSpeechRate((float) Math.max(0.5, Math.min(2.0, rate)));
        return tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, utteranceId) == TextToSpeech.SUCCESS;
      } catch (Exception e) {
        return false;
      }
    }

    @JavascriptInterface
    public void stop() {
      if (tts != null) {
        try {
          tts.stop();
        } catch (Exception ignored) {
        }
      }
    }
  }
}
