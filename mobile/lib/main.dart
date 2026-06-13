import 'package:flutter/material';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'theme/app_skin.dart';
import 'services/background_sync.dart';
import 'views/main_navigation_shell.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  
  // Initialize background keep-alive sync service
  try {
    await BackgroundSyncService.initialize();
  } catch (e) {
    print("[main] Background sync initialization failed: $e");
  }

  runApp(
    const ProviderScope(
      child: SuperNoteMobileApp(),
    ),
  );
}

class SuperNoteMobileApp extends ConsumerWidget {
  const SuperNoteMobileApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final activeSkin = ref.watch(skinProvider);
    final isDark = ref.watch(darkModeProvider);
    final skin = SkinTheme.getTheme(activeSkin, isDark);

    return MaterialApp(
      title: 'Ark Notes',
      debugShowCheckedModeBanner: false,
      theme: skin.themeData,
      home: const MainNavigationShell(),
    );
  }
}
