import 'package:flutter/material';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'dart:async';
import 'dart:math';
import 'package:lucide_icons/lucide_icons.dart';
import '../theme/app_skin.dart';
import '../services/audio_recorder_service.dart';
import '../services/lan_discovery_service.dart';
import '../services/biometric_service.dart';
import 'editor_webview_screen.dart';

// Riverpod states
final skinProvider = StateProvider<AppSkin>((ref) => AppSkin.memos);
final darkModeProvider = StateProvider<bool>((ref) => false);
final biometricEnabledProvider = StateProvider<bool>((ref) => false);

class MainNavigationShell extends ConsumerStatefulWidget {
  const MainNavigationShell({Key? key}) : super(key: key);

  @override
  ConsumerState<MainNavigationShell> createState() => _MainNavigationShellState();
}

class _MainNavigationShellState extends ConsumerState<MainNavigationShell> {
  int _currentIndex = 0;
  final AudioRecorderService _recorderService = AudioRecorderService();
  final LanDiscoveryService _discoveryService = LanDiscoveryService();
  final BiometricService _biometricService = BiometricService();

  // Audio recording UI state
  bool _isRecording = false;
  int _recordDuration = 0;
  Timer? _recordTimer;
  List<double> _waveformData = List.filled(20, 0.1);
  StreamSubscription? _amplitudeSub;

  // LAN Discovery State
  List<DiscoveredPeer> _lanPeers = [];

  // Mock Data
  final List<Map<String, String>> _notes = [
    {"id": "note-1", "title": "项目启动规划", "excerpt": "关于移动端重构方案的技术分析..."},
    {"id": "note-2", "title": "今日设计灵感", "excerpt": "Obsidian 皮肤的主题颜色应该采用深灰色底..."},
    {"id": "note-3", "title": "局域网备份说明", "excerpt": "不需要云端，直接通过 UDP 广播在本地互相同步..."},
  ];

  final List<Map<String, dynamic>> _tasks = [
    {"title": "验证 Flutter Webview 桥接通信", "done": true},
    {"title": "编写 Says 录音波形图组件", "done": false},
    {"title": "测试 mDNS 服务局域网发现", "done": false},
    {"title": "集成 Android 前台保活 Service", "done": false},
  ];

  final List<Map<String, dynamic>> _says = [
    {"time": "10:30", "content": "今天天气真好，正在用 Flutter 开发超级笔记！", "audio": null},
    {"time": "09:15", "content": "录制了一段Says语音说说：", "audio": "says_voice_1.aac", "duration": "00:15"},
  ];

  @override
  void initState() {
    super.initState();
    // Listen to LAN discovery updates
    _discoveryService.startDiscovery((updatedPeers) {
      if (mounted) {
        setState(() {
          _lanPeers = updatedPeers;
        });
      }
    });
  }

  @override
  void dispose() {
    _recordTimer?.cancel();
    _amplitudeSub?.cancel();
    _recorderService.dispose();
    _discoveryService.stopDiscovery();
    super.dispose();
  }

  void _startVoiceRecording() async {
    final path = '/sdcard/Download/says_temp.aac'; // Mock path for simplicity
    await _recorderService.startRecording(path);

    _amplitudeSub = _recorderService.amplitudeStream.listen((amp) {
      if (mounted) {
        setState(() {
          // Slide in new amplitudes and render bouncing bars
          _waveformData.removeAt(0);
          _waveformData.add(amp);
        });
      }
    });

    _recordDuration = 0;
    _recordTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (mounted) {
        setState(() {
          _recordDuration++;
        });
      }
    });

    setState(() {
      _isRecording = true;
    });
  }

  void _stopVoiceRecording(bool save) async {
    final path = await _recorderService.stopRecording();
    _recordTimer?.cancel();
    _amplitudeSub?.cancel();

    setState(() {
      _isRecording = false;
      _waveformData = List.filled(20, 0.1);
      if (save && path != null) {
        // Add to Says timeline
        _says.insert(0, {
          "time": "刚刚",
          "content": "语音记录",
          "audio": path,
          "duration": "${(_recordDuration ~/ 60).toString().padLeft(2, '0')}:${(_recordDuration % 60).toString().padLeft(2, '0')}"
        });
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final activeSkin = ref.watch(skinProvider);
    final isDark = ref.watch(darkModeProvider);
    final skin = SkinTheme.getTheme(activeSkin, isDark);

    return Theme(
      data: skin.themeData,
      child: Scaffold(
        backgroundColor: skin.canvasBg,
        appBar: AppBar(
          backgroundColor: skin.sidebarBg,
          title: Text(
            _currentIndex == 0
                ? "我的笔记"
                : _currentIndex == 1
                    ? "今日说说"
                    : _currentIndex == 2
                        ? "待办清单"
                        : "更多设置",
            style: TextStyle(color: skin.textPrimary, fontWeight: FontWeight.bold),
          ),
          elevation: 0,
        ),
        body: _buildBody(skin),
        bottomNavigationBar: BottomNavigationBar(
          currentIndex: _currentIndex,
          selectedItemColor: skin.accentPrimary,
          unselectedItemColor: skin.textSecondary,
          backgroundColor: skin.sidebarBg,
          type: BottomNavigationBarType.fixed,
          onTap: (index) {
            setState(() {
              _currentIndex = index;
            });
          },
          items: const [
            BottomNavigationBarItem(icon: Icon(LucideIcons.bookOpen), label: "笔记"),
            BottomNavigationBarItem(icon: Icon(LucideIcons.messageCircle), label: "说说"),
            BottomNavigationBarItem(icon: Icon(LucideIcons.checkSquare), label: "待办"),
            BottomNavigationBarItem(icon: Icon(LucideIcons.menu), label: "更多"),
          ],
        ),
      ),
    );
  }

  Widget _buildBody(SkinTheme skin) {
    switch (_currentIndex) {
      case 0:
        return _buildNotesTab(skin);
      case 1:
        return _buildSaysTab(skin);
      case 2:
        return _buildTasksTab(skin);
      case 3:
      default:
        return _buildSettingsTab(skin);
    }
  }

  // --- TAB 1: NOTES LIST ---
  Widget _buildNotesTab(SkinTheme skin) {
    return ListView.builder(
      padding: const EdgeInsets.all(12),
      itemCount: _notes.length,
      itemBuilder: (context, index) {
        final note = _notes[index];
        return Card(
          color: skin.sidebarBg,
          elevation: skin.themeData.cardTheme.elevation,
          shape: skin.themeData.cardTheme.shape,
          margin: const EdgeInsets.only(bottom: 12),
          child: ListTile(
            contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            title: Text(
              note["title"]!,
              style: TextStyle(color: skin.textPrimary, fontWeight: FontWeight.bold),
            ),
            subtitle: Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                note["excerpt"]!,
                style: TextStyle(color: skin.textSecondary),
              ),
            ),
            trailing: Icon(Icons.chevron_right, color: skin.accentPrimary),
            onTap: () {
              Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (context) => EditorWebViewScreen(
                    noteId: note["id"]!,
                    serverUrl: "http://localhost:5173", // Point to local dev server or bundle
                    onBack: () => Navigator.pop(context),
                  ),
                ),
              );
            },
          ),
        );
      },
    );
  }

  // --- TAB 2: SAYS AUDIO / POSTS ---
  Widget _buildSaysTab(SkinTheme skin) {
    return Column(
      children: [
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: _says.length,
            itemBuilder: (context, index) {
              final item = _says[index];
              return Card(
                color: skin.sidebarBg,
                shape: skin.themeData.cardTheme.shape,
                margin: const EdgeInsets.only(bottom: 16),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.between,
                        children: [
                          Row(
                            children: [
                              CircleAvatar(
                                backgroundColor: skin.accentPrimary.withOpacity(0.2),
                                radius: 14,
                                child: Icon(LucideIcons.user, size: 14, color: skin.accentPrimary),
                              ),
                              const SizedBox(width: 8),
                              Text("我", style: TextStyle(color: skin.textPrimary, fontWeight: FontWeight.bold)),
                            ],
                          ),
                          Text(item["time"]!, style: TextStyle(color: skin.textSecondary, fontSize: 12)),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Text(item["content"]!, style: TextStyle(color: skin.textPrimary)),
                      if (item["audio"] != null) ...[
                        const SizedBox(height: 12),
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: skin.accentPrimary.withOpacity(0.08),
                            borderRadius: BorderRadius.circular(skin.cardRadius),
                            border: Border.all(color: skin.accentPrimary.withOpacity(0.2)),
                          ),
                          child: Row(
                            children: [
                              IconButton(
                                icon: Icon(Icons.play_arrow, color: skin.accentPrimary),
                                onPressed: () {
                                  // Play selected voice memo
                                },
                              ),
                              Expanded(
                                child: Text(
                                  "语音录音 (${item["duration"]})",
                                  style: TextStyle(color: skin.accentPrimary, fontWeight: FontWeight.bold),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              );
            },
          ),
        ),
        // Recording Control Panel
        _buildRecordingControlPanel(skin),
      ],
    );
  }

  Widget _buildRecordingControlPanel(SkinTheme skin) {
    if (_isRecording) {
      return Container(
        color: skin.sidebarBg,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        border: Border(top: BorderSide(color: skin.accentPrimary.withOpacity(0.2))),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.between,
          children: [
            Row(
              children: [
                // Pulsing red indicator
                const Icon(Icons.fiber_manual_record, color: Colors.red, size: 16),
                const SizedBox(width: 8),
                Text(
                  "录音中... ${(_recordDuration ~/ 60).toString().padLeft(2, '0')}:${(_recordDuration % 60).toString().padLeft(2, '0')}",
                  style: TextStyle(color: skin.textPrimary, fontWeight: FontWeight.bold),
                ),
              ],
            ),
            // Waveform visualizer
            Row(
              children: List.generate(_waveformData.length, (index) {
                final height = max(4.0, _waveformData[index] * 28);
                return Container(
                  width: 3,
                  height: height,
                  margin: const EdgeInsets.symmetric(horizontal: 1),
                  decoration: BoxDecoration(
                    color: skin.accentPrimary,
                    borderRadius: BorderRadius.circular(10),
                  ),
                );
              }),
            ),
            Row(
              children: [
                TextButton(
                  onPressed: () => _stopVoiceRecording(false),
                  child: Text("取消", style: TextStyle(color: skin.textSecondary)),
                ),
                ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: skin.accentPrimary,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(skin.buttonRadius)),
                  ),
                  onPressed: () => _stopVoiceRecording(true),
                  child: const Text("完成", style: TextStyle(color: Colors.white)),
                ),
              ],
            ),
          ],
        ),
      );
    } else {
      return Container(
        color: skin.sidebarBg,
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Expanded(
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                decoration: BoxDecoration(
                  color: skin.canvasBg,
                  borderRadius: BorderRadius.circular(24),
                ),
                child: Text("说说最近的想法吧...", style: TextStyle(color: skin.textSecondary)),
              ),
            ),
            const SizedBox(width: 12),
            GestureDetector(
              onTap: _startVoiceRecording,
              child: CircleAvatar(
                backgroundColor: skin.accentPrimary,
                radius: 22,
                child: const Icon(LucideIcons.mic, color: Colors.white),
              ),
            ),
          ],
        ),
      );
    }
  }

  // --- TAB 3: TASKS LIST ---
  Widget _buildTasksTab(SkinTheme skin) {
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: _tasks.length,
      itemBuilder: (context, index) {
        final task = _tasks[index];
        return Card(
          color: skin.sidebarBg,
          shape: skin.themeData.cardTheme.shape,
          margin: const EdgeInsets.only(bottom: 12),
          child: CheckboxListTile(
            title: Text(
              task["title"],
              style: TextStyle(
                color: skin.textPrimary,
                decoration: task["done"] ? TextDecoration.lineThrough : null,
              ),
            ),
            activeColor: skin.accentPrimary,
            checkColor: Colors.white,
            value: task["done"],
            onChanged: (val) {
              setState(() {
                _tasks[index]["done"] = val;
              });
            },
          ),
        );
      },
    );
  }

  // --- TAB 4: MORE SETTINGS & MDNS PEERS ---
  Widget _buildSettingsTab(SkinTheme skin) {
    final isDark = ref.watch(darkModeProvider);
    final activeSkin = ref.watch(skinProvider);
    final isBiometric = ref.watch(biometricEnabledProvider);

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text("定制主题皮肤", style: TextStyle(color: skin.accentPrimary, fontWeight: FontWeight.bold, fontSize: 16)),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: AppSkin.values.map((s) {
            final isSelected = activeSkin == s;
            return ChoiceChip(
              label: Text(s.toString().split('.').last.toUpperCase()),
              selected: isSelected,
              selectedColor: skin.accentPrimary,
              onSelected: (val) {
                if (val) {
                  ref.read(skinProvider.notifier).state = s;
                }
              },
            );
          }).toList(),
        ),
        const Divider(height: 32),
        SwitchListTile(
          title: Text("深色模式", style: TextStyle(color: skin.textPrimary)),
          value: isDark,
          activeColor: skin.accentPrimary,
          onChanged: (val) {
            ref.read(darkModeProvider.notifier).state = val;
          },
        ),
        SwitchListTile(
          title: Text("启用生物识别认证 (Quick Login)", style: TextStyle(color: skin.textPrimary)),
          value: isBiometric,
          activeColor: skin.accentPrimary,
          onChanged: (val) async {
            if (val) {
              final ok = await _biometricService.authenticate(reason: "启用安全极速登录锁");
              if (ok) {
                ref.read(biometricEnabledProvider.notifier).state = true;
              }
            } else {
              ref.read(biometricEnabledProvider.notifier).state = false;
            }
          },
        ),
        const Divider(height: 32),
        Text("局域网发现的节点 (mDNS)", style: TextStyle(color: skin.accentPrimary, fontWeight: FontWeight.bold, fontSize: 16)),
        const SizedBox(height: 12),
        if (_lanPeers.isEmpty)
          Padding(
            padding: const EdgeInsets.all(8.0),
            child: Text("扫描局域网节点中... 未发现其他客户端", style: TextStyle(color: skin.textSecondary)),
          )
        else
          ..._lanPeers.map((peer) => Card(
                color: skin.sidebarBg,
                shape: skin.themeData.cardTheme.shape,
                margin: const EdgeInsets.only(bottom: 8),
                child: ListTile(
                  leading: Icon(Icons.wifi, color: skin.accentPrimary),
                  title: Text(peer.name, style: TextStyle(color: skin.textPrimary, fontWeight: FontWeight.bold)),
                  subtitle: Text("${peer.ipv4}:${peer.port}", style: TextStyle(color: skin.textSecondary)),
                  trailing: TextButton(
                    onPressed: () {
                      // Trigger sync with discovered local peer IP
                    },
                    child: const Text("手动同步"),
                  ),
                ),
              )),
      ],
    );
  }
}
