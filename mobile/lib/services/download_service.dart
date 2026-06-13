import 'dart:io';
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';

class DownloadService {
  /// Save binary file to Android public Downloads directory or iOS Documents
  Future<String?> saveFileToDownloads(List<int> bytes, String filename) async {
    try {
      if (Platform.isAndroid) {
        // Request Storage permission (SDK <= 28) or Manage External Storage (SDK >= 30) depending on requirements.
        // For general files, Android 10+ (Q) allows writing to Downloads without permissions via MediaStore,
        // but for direct directory access, we can request storage permissions as fallback.
        var status = await Permission.storage.status;
        if (!status.isGranted) {
          status = await Permission.storage.request();
        }

        if (status.isGranted || await Permission.manageExternalStorage.request().isGranted) {
          final dir = Directory('/storage/emulated/0/Download');
          if (!await dir.exists()) {
            await dir.create(recursive: true);
          }
          final file = File('${dir.path}/$filename');
          await file.writeAsBytes(bytes);
          return file.path;
        } else {
          // Fallback to app documents directory if permissions denied
          final dir = await getApplicationDocumentsDirectory();
          final file = File('${dir.path}/$filename');
          await file.writeAsBytes(bytes);
          return file.path;
        }
      } else if (Platform.isIOS) {
        // iOS: Save to Application Documents (which can be visible in Files app if configured in Info.plist)
        final dir = await getApplicationDocumentsDirectory();
        final file = File('${dir.path}/$filename');
        await file.writeAsBytes(bytes);
        return file.path;
      }
    } catch (e) {
      print("[DownloadService] saveFileToDownloads error: $e");
    }
    return null;
  }
}
