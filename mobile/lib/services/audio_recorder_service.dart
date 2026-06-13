import 'dart:async';
import 'package:record/record.dart';
import 'package:audioplayers/audioplayers.dart';

class AudioRecorderService {
  final AudioRecorder _audioRecorder = AudioRecorder();
  final AudioPlayer _audioPlayer = AudioPlayer();
  
  StreamController<double> _amplitudeController = StreamController<double>.broadcast();
  Timer? _amplitudeTimer;

  Stream<double> get amplitudeStream => _amplitudeController.stream;
  AudioPlayer get audioPlayer => _audioPlayer;

  /// Start recording voice notes
  Future<void> startRecording(String path) async {
    try {
      if (await _audioRecorder.hasPermission()) {
        await _audioRecorder.start(
          const RecordConfig(
            encoder: AudioEncoder.aacLc,
            sampleRate: 44100,
            bitRate: 128000,
          ),
          path: path,
        );

        // Cancel previous timer if any
        _amplitudeTimer?.cancel();
        
        // Poll amplitude every 80ms for responsive visualizer bouncing EQ waves
        _amplitudeTimer = Timer.periodic(const Duration(milliseconds: 80), (timer) async {
          if (!await _audioRecorder.isRecording()) {
            timer.cancel();
            return;
          }
          final amp = await _audioRecorder.getAmplitude();
          // Convert dB (-160.0 to 0.0) into a normalized 0.0 - 1.0 amplitude value
          double normalized = (amp.current + 160.0) / 160.0;
          _amplitudeController.add(normalized.clamp(0.0, 1.0));
        });
      }
    } catch (e) {
      print("[AudioRecorderService] startRecording error: $e");
    }
  }

  /// Stop recording. Returns the path of the recorded file.
  Future<String?> stopRecording() async {
    _amplitudeTimer?.cancel();
    try {
      final path = await _audioRecorder.stop();
      return path;
    } catch (e) {
      print("[AudioRecorderService] stopRecording error: $e");
      return null;
    }
  }

  /// Check if actively recording
  Future<bool> isRecording() async {
    return await _audioRecorder.isRecording();
  }

  /// Dispose services
  void dispose() {
    _amplitudeTimer?.cancel();
    _audioRecorder.dispose();
    _audioPlayer.dispose();
    _amplitudeController.close();
  }
}
