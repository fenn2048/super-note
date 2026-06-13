import 'package:flutter/material';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter/services.dart';
import '../services/download_service.dart';

class EditorWebViewScreen extends StatefulWidget {
  final String noteId;
  final String serverUrl;
  final VoidCallback onBack;

  const EditorWebViewScreen({
    Key? key,
    required this.noteId,
    required this.serverUrl,
    required this.onBack,
  }) : super(key: key);

  @override
  State<EditorWebViewScreen> createState() => _EditorWebViewScreenState();
}

class _EditorWebViewScreenState extends State<EditorWebViewScreen> {
  InAppWebViewController? _webViewController;
  bool _isLoading = true;
  final DownloadService _downloadService = DownloadService();

  @override
  Widget build(BuildContext context) {
    // Generate WebView URL. In production, this can point to a local asset
    // (e.g., file:///android_asset/flutter_assets/assets/web/index.html)
    // or the server live reload developer server url during development.
    final String editorUrl = "${widget.serverUrl}/#/?noteId=${widget.noteId}&mode=editor";

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () {
            // Check if web editor can go back or needs to save draft
            _webViewController?.evaluateJavascript(source: "window.superMobileBridge?.onBackPress();");
            widget.onBack();
          },
        ),
        title: const Text("编辑笔记"),
        actions: [
          IconButton(
            icon: const Icon(Icons.sync),
            onPressed: () {
              _webViewController?.reload();
            },
          ),
        ],
      ),
      body: Stack(
        children: [
          InAppWebView(
            initialUrlRequest: URLRequest(url: WebUri(editorUrl)),
            initialSettings: InAppWebViewSettings(
              allowMixedContent: true,
              cleartextTraffic: true,
              domStorageEnabled: true,
              javaScriptEnabled: true,
              supportMultipleWindows: false,
              useWideViewPort: true,
            ),
            onWebViewCreated: (controller) {
              _webViewController = controller;

              // Bridge 1: Download attachment or note export from web context
              controller.addJavaScriptHandler(
                handlerName: 'downloadFile',
                callback: (args) async {
                  final String base64Data = args[0];
                  final String filename = args[1];
                  final String mimeType = args[2];

                  final List<int> bytes = Uri.parse(base64Data).data!.contentAsBytes();
                  final path = await _downloadService.saveFileToDownloads(bytes, filename);
                  
                  if (path != null) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text('文件已保存至下载目录: $filename')),
                    );
                  }
                },
              );

              // Bridge 2: Trigger native haptics vibration from rich actions
              controller.addJavaScriptHandler(
                handlerName: 'triggerHaptic',
                callback: (args) {
                  final String style = args[0]; // "light", "medium", "heavy"
                  if (style == "light") {
                    HapticFeedback.lightImpact();
                  } else if (style == "medium") {
                    HapticFeedback.mediumImpact();
                  } else if (style == "heavy") {
                    HapticFeedback.vibrate();
                  }
                },
              );

              // Bridge 3: Notify editor loading completion
              controller.addJavaScriptHandler(
                handlerName: 'editorReady',
                callback: (args) {
                  setState(() {
                    _isLoading = false;
                  });
                },
              );
            },
            onLoadStop: (controller, url) {
              setState(() {
                _isLoading = false;
              });
            },
          ),
          if (_isLoading)
            const Center(
              child: CircularProgressIndicator(),
            ),
        ],
      ),
    );
  }
}
