# Flutter Technical Design & Implementation Plan for Super-Note Mobile (Android)

This document presents a professional-grade technical design and implementation plan to migrate the existing Capacitor-based Android mobile application for **Super-Note (Ark Notes)** to **Flutter**, while retaining the current React H5 codebase for desktop web and service compatibility.

---

## 1. Architectural Strategy Comparison

To implement all mobile features in Flutter while maintaining 100% data compatibility and seamless synchronization, we must evaluate two main architectural patterns:

```mermaid
graph TD
    subgraph Option A: Hybrid Core Shell (Recommended)
        FShell[Flutter App Shell] -->|Native UI| FNav[Tabs, Says, Tasks, Settings]
        FShell -->|Native Integration| NS[Keep-Alive Service, local_auth, nsd]
        FShell -->|InAppWebView| WebEditor[TipTap & Yjs Collaborative Editor]
        WebEditor -->|Y-IndexedDB| WebIDB[IndexedDB Cache]
    end

    subgraph Option B: Pure Native Dart Shell
        FNShell[Flutter App Shell] -->|Native UI| FAllUI[All Screens & Editors]
        FNShell -->|Native Integration| NS2[Keep-Alive Service, local_auth, nsd]
        FAllUI -->|Isar/Drift| NativeDB[SQLite/Isar Cache]
        FNShell -->|headless_js| HeadlessJS[Background Yjs CRDT Sync Engine]
    end
```

### Option A: Dual-Core Hybrid Shell (Recommended)
* **Design**: Implement the app container, navigation (Home, Says, Tasks, More), native audio/video recording, local notifications, biometrics, and mDNS discovery in **pure Flutter native code**. Specifically embed the **Rich-Text Editor (TipTap/CodeMirror + Yjs + KaTeX + Mermaid)** inside a highly optimized WebView (e.g., `flutter_inappwebview`) pointing to a localized asset server or SPA build.
* **Pros**: 
  - Retains 100% editor layout fidelity (avoiding breaking complex markdown tables, slash menus, mind maps, and math formatting).
  - Reuses the existing `yjs` + `y-indexeddb` client-side sync logic without translating complex Javascript CRDT state-vector merging engines into Dart.
  - Near-instant time to market for a stable mobile editor.
* **Cons**: Editor execution is sandboxed inside a WebView renderer.

### Option B: Pure Native Dart Architecture
* **Design**: Rewrite all UI screens and editor engines from scratch using Flutter widgets (e.g., `flutter_markdown` or `super_editor`). Write custom Yjs protocols or run a background JS runtime (using `flutter_js`) to handle local-first synchronization and bridge it back to Dart.
* **Pros**: Fully native rendering, zero webview overhead.
* **Cons**:
  - Extremely high complexity in translating the collaborative cursor, suggestion popovers, CodeMirror text selections, and block editing to native Dart.
  - Risk of synchronization or formatting divergence between the Web app and the mobile app.

> [!IMPORTANT]
> **Recommendation**: We recommend **Option A (Dual-Core Hybrid Shell)**. It delivers a fast, premium native shell feel (menus, Says timelines, transitions) while keeping the editor engine 100% robust and compatible with the desktop and web versions.

---

## 2. Technology Stack & Package Mapping

Here is the exact replacement path from Capacitor plugins to Flutter packages:

| Capacitor / H5 Library | Flutter Package | Purpose & Functionality |
| :--- | :--- | :--- |
| `capacitor.config.ts` (WebView) | `flutter_inappwebview` | High-performance Webview with JS Bridges |
| `@mhaberler/capacitor-zeroconf-nsd` | `nsd` / `bonjour_dns` | LAN mDNS Service Discovery (`_super-note._tcp`) |
| `@capacitor/local-notifications` | `flutter_local_notifications` | Scheduling task notifications and reminders |
| `@aparajita/capacitor-biometric-auth` | `local_auth` | Fingerprint, Face ID, and PIN verification |
| `@aparajita/capacitor-secure-storage` | `flutter_secure_storage` | Securely storing authorization tokens & encryption keys |
| `@capacitor/haptics` | `vibration` / `services.dart` | Triggering light, medium, and heavy vibrations |
| `KeepAliveService.java` (WakeLock) | `flutter_background_service` | Running data synchronization as an Android foreground service |
| `AndroidDownloadBridge` (MainActivity) | `path_provider` + `dio` | Downloading files to the system public Downloads folder |
| Web Audio API / Camera | `record` + `camera` + `audioplayers` | Voice Says waveform capturing, playback, and photos |
| Zustand (State Management) | `flutter_riverpod` | Lightweight, scalable state container matching Zustand's model |

---

## 3. Core Module Design

### 3.1 Custom Skin Design System (Theme Engine)
To replicate the 5 custom skins (**Obsidian, macOS, Notion, Memos, flomo**) in Flutter, we design a custom theme state notifier:

```dart
// lib/theme/app_skin.dart
enum AppSkin { obsidian, macos, notion, memos, flomo }

class SkinThemeData {
  final ThemeData themeData;
  final double buttonRadius;
  final double cardRadius;
  final double windowRadius;
  final Color sidebarBg;
  final Color canvasBg;
  final Color accentPrimary;

  SkinThemeData({
    required this.themeData,
    required this.buttonRadius,
    required this.cardRadius,
    required this.windowRadius,
    required this.sidebarBg,
    required this.canvasBg,
    required this.accentPrimary,
  });
}
```

#### Skin Configuration Mapping:
* **Obsidian**: Sharp corners (`borderRadius: 4.0`), dark charcoal canvas (`#1e1e1e`), sidebar (`#161616`), quiet active purple (`#7a52f4`).
* **macOS**: High transparency/glassmorphism, organic rounded corners (`card: 10.0`, `window: 12.0`), accent system blue (`#007aff`), background (`#ececec`).
* **Notion**: Warm creamy minimalist tone, sharp corners (`borderRadius: 4.0`), notion blue (`#2383e2`), canvas (`#ffffff`), sidebar (`#f1f1ef`).
* **Memos**: Breathable cards, emerald-green accent (`#10b981`), slate canvas (`#f3f4f6`), card background (`#ffffff`), rounded corners (`card: 8.0`).
* **flomo**: Stress-free logging layout, grass green accent (`#32b67a`), warm cream background (`#f4f4f0`), large organic corners (`card: 10.0`, `window: 12.0`).

---

### 3.2 Native Audio Recording & Bouncing Waveform (Says Feature)
For the "Says" audio logger, we use the `record` package to capture audio and fetch amplitude data in real-time to animate the bouncing EQ waves:

```dart
// lib/services/audio_recorder_service.dart
import 'dart:async';
import 'package:record/record.dart';

class AudioRecorderService {
  final _audioRecorder = AudioRecorder();
  StreamController<double> _amplitudeController = StreamController.broadcast();

  Stream<double> get amplitudeStream => _amplitudeController.stream;

  Future<void> startRecording(String path) async {
    if (await _audioRecorder.hasPermission()) {
      await _audioRecorder.start(const RecordConfig(encoder: AudioEncoder.aacFps), path: path);
      
      // Poll amplitude for real-time waveform UI
      Timer.periodic(const Duration(milliseconds: 100), (timer) async {
        if (!await _audioRecorder.isRecording()) {
          timer.cancel();
          return;
        }
        final amp = await _audioRecorder.getAmplitude();
        // Convert dB (-160 to 0) to a normalized value (0.0 to 1.0)
        double norm = (amp.current + 160) / 160;
        _amplitudeController.add(norm.clamp(0.0, 1.0));
      });
    }
  }

  Future<String?> stopRecording() async {
    return await _audioRecorder.stop();
  }
}
```

---

### 3.3 Keep-Alive & Foreground Sync Service (Android)
To keep background synchronization active in the background, we wrap Android's native foreground service architecture into a clean Flutter service using `flutter_background_service`.

#### Android Manifest Requirements (`AndroidManifest.xml`):
```xml
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />

<service
    android:name="com.transistorsoft.flutterbackgroundservice.BackgroundService"
    android:foregroundServiceType="dataSync"
    android:enabled="true"
    android:exported="false" />
```

#### Flutter Initialization (`lib/services/background_sync.dart`):
```dart
import 'package:flutter_background_service/flutter_background_service.dart';

Future<void> initializeBackgroundService() async {
  final service = FlutterBackgroundService();
  await service.configure(
    androidConfiguration: AndroidConfiguration(
      onStart: onStart,
      autoStart: true,
      isForegroundMode: true,
      foregroundServiceTypes: [AndroidForegroundType.dataSync],
      notificationChannelId: 'super_note_sync',
      initialNotificationTitle: 'Super Note 正在运行',
      initialNotificationContent: '保持同步 service 连接活跃中...',
    ),
    iosConfiguration: IosConfiguration(
      autoStart: true,
      onForeground: onStart,
    ),
  );
}

@pragma('vm:entry-point')
void onStart(ServiceInstance service) {
  // Sync loop execution & WakeLock retention
  // Periodically resolves synchronization with remote or local peer nodes
}
```

---

### 3.4 LAN Service Discovery (mDNS)
To scan local network note-taking databases without requiring cloud servers, we implement the `nsd` service browser in Flutter:

```dart
// lib/services/lan_discovery_service.dart
import 'package:nsd/nsd.dart';

class LanDiscoveryService {
  Discovery? _discovery;
  final List<Service> discoveredServices = [];

  Future<void> startDiscovery(Function(List<Service>) onUpdated) async {
    _discovery = await startDiscovery('_super-note._tcp');
    _discovery!.addListener(() {
      discoveredServices.clear();
      discoveredServices.addAll(_discovery!.services);
      onUpdated(discoveredServices);
    });
  }

  Future<void> stopDiscovery() async {
    if (_discovery != null) {
      await stopDiscovery(_discovery!);
    }
  }
}
```

---

### 3.5 File Download Bridge
Replacing `AndroidDownloadBridge` in Java, we implement file downloads natively in Dart, saving documents/exports directly to Android's public `Downloads` directory:

```dart
// lib/services/download_service.dart
import 'dart:io';
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';

class DownloadService {
  Future<bool> saveFileToDownloads(List<int> bytes, String filename) async {
    if (Platform.isAndroid) {
      if (await Permission.storage.request().isGranted || await Permission.manageExternalStorage.request().isGranted) {
        // Safe target for Android downloads
        final dir = Directory('/storage/emulated/0/Download');
        if (!await dir.exists()) {
          await dir.create(recursive: true);
        }
        final file = File('${dir.path}/$filename');
        await file.writeAsBytes(bytes);
        return true;
      }
    }
    return false;
  }
}
```

---

## 4. Implementation Roadmap

```mermaid
gantt
    title Flutter Mobile Migration Roadmap
    dateFormat  YYYY-MM-DD
    section Phase 1: Environment Setup
    Create Flutter App & Config AndroidManifest  :2026-06-15, 3d
    Configure Plugins (local_auth, secure_storage, nsd) :after, 2d
    section Phase 2: Shell & Themes
    Implement Multi-Skin Theme Engine           :5d
    Design Bottom Navigation & Navigation Drawer :after, 4d
    section Phase 3: Hybrid Editor & Webview
    Integrate InAppWebView & Asset Bundling    :7d
    Establish JS-Dart Communication Bridge      :after, 4d
    section Phase 4: Native Services
    Says Voice Waveform Recorder & Player       :6d
    Keep-Alive Foreground Sync Service          :after, 5d
    mDNS Discovery & Local Notification Sync    :after, 5d
    section Phase 5: Testing & QA
    Verify Sync Compatibility & Peer-to-Peer    :5d
    Performance Optimization & Memory Profile   :after, 4d
```

---

## 5. Verification Plan

### Automated Tests
- **Unit Testing**: Run `flutter test` to verify skin state transitions, date formatting, and local task synchronization models.
- **Integration Testing**: Use `flutter drive` or `integration_test` to verify webview loading stability, local storage encryption read/writes, and biometric authentication popups.

### Manual Verification
- Deploy to an Android device running Android Q (API 29) and Android 15 (API 35) to verify:
  1. **Edge-to-Edge display padding** against status bar overlays.
  2. **Background Sync persistence** when the device locks or enters battery-saving mode.
  3. **Real-time audio visualizer** inside the Says tab.
  4. **P2P discovery and note editing** under the same local Wi-Fi router.
