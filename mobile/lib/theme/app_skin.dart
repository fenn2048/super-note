import 'package:flutter/material';

enum AppSkin { obsidian, macos, notion, memos, flomo }

class SkinTheme {
  final ThemeData themeData;
  final double buttonRadius;
  final double cardRadius;
  final double windowRadius;
  final Color sidebarBg;
  final Color canvasBg;
  final Color accentPrimary;
  final Color textPrimary;
  final Color textSecondary;

  SkinTheme({
    required this.themeData,
    required this.buttonRadius,
    required this.cardRadius,
    required this.windowRadius,
    required this.sidebarBg,
    required this.canvasBg,
    required this.accentPrimary,
    required this.textPrimary,
    required this.textSecondary,
  });

  static SkinTheme getTheme(AppSkin skin, bool isDark) {
    switch (skin) {
      case AppSkin.obsidian:
        return SkinTheme(
          themeData: ThemeData(
            useMaterial3: true,
            brightness: isDark ? Brightness.dark : Brightness.light,
            colorScheme: ColorScheme.fromSeed(
              seedColor: const Color(0xFF7A52F4),
              brightness: isDark ? Brightness.dark : Brightness.light,
              primary: const Color(0xFF7A52F4),
              background: isDark ? const Color(0xFF1E1E1E) : const Color(0xFFFFFFFF),
            ),
            cardTheme: const CardTheme(
              elevation: 0,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.all(Radius.circular(4.0)),
              ),
            ),
          ),
          buttonRadius: 4.0,
          cardRadius: 4.0,
          windowRadius: 4.0,
          sidebarBg: isDark ? const Color(0xFF161616) : const Color(0xFFF6F6F6),
          canvasBg: isDark ? const Color(0xFF1E1E1E) : const Color(0xFFFFFFFF),
          accentPrimary: const Color(0xFF7A52F4),
          textPrimary: isDark ? const Color(0xFFE0E0E0) : const Color(0xFF202020),
          textSecondary: isDark ? const Color(0xFF909090) : const Color(0xFF606060),
        );

      case AppSkin.macos:
        return SkinTheme(
          themeData: ThemeData(
            useMaterial3: true,
            brightness: isDark ? Brightness.dark : Brightness.light,
            colorScheme: ColorScheme.fromSeed(
              seedColor: isDark ? const Color(0xFF0A84FF) : const Color(0xFF007AFF),
              brightness: isDark ? Brightness.dark : Brightness.light,
              primary: isDark ? const Color(0xFF0A84FF) : const Color(0xFF007AFF),
              background: isDark ? const Color(0xFF1E1E1E) : const Color(0xFFECECEC),
            ),
            cardTheme: const CardTheme(
              elevation: 4,
              shadowColor: Colors.black26,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.all(Radius.circular(10.0)),
              ),
            ),
          ),
          buttonRadius: 8.0,
          cardRadius: 10.0,
          windowRadius: 12.0,
          sidebarBg: isDark ? const Color(0x991E1E1E) : const Color(0x99ECECEC), // Semi-transparent for blur
          canvasBg: isDark ? const Color(0xFF1E1E1E) : const Color(0xFFFFFFFF),
          accentPrimary: isDark ? const Color(0xFF0A84FF) : const Color(0xFF007AFF),
          textPrimary: isDark ? Colors.white : Colors.black87,
          textSecondary: isDark ? Colors.white70 : Colors.black54,
        );

      case AppSkin.notion:
        return SkinTheme(
          themeData: ThemeData(
            useMaterial3: true,
            brightness: isDark ? Brightness.dark : Brightness.light,
            colorScheme: ColorScheme.fromSeed(
              seedColor: const Color(0xFF2383E2),
              brightness: isDark ? Brightness.dark : Brightness.light,
              primary: const Color(0xFF2383E2),
              background: isDark ? const Color(0xFF191919) : const Color(0xFFFFFFFF),
            ),
            cardTheme: const CardTheme(
              elevation: 0,
              shape: RoundedRectangleBorder(
                side: BorderSide(color: Color(0xFFE5E5E5), width: 1.0),
                borderRadius: BorderRadius.all(Radius.circular(4.0)),
              ),
            ),
          ),
          buttonRadius: 4.0,
          cardRadius: 4.0,
          windowRadius: 4.0,
          sidebarBg: isDark ? const Color(0xFF202020) : const Color(0xFFF1F1EF),
          canvasBg: isDark ? const Color(0xFF191919) : const Color(0xFFFFFFFF),
          accentPrimary: const Color(0xFF2383E2),
          textPrimary: isDark ? const Color(0xFFD4D4D4) : const Color(0xFF37352F),
          textSecondary: isDark ? const Color(0xFF7C7B77) : const Color(0xFF7C7B77),
        );

      case AppSkin.memos:
        return SkinTheme(
          themeData: ThemeData(
            useMaterial3: true,
            brightness: isDark ? Brightness.dark : Brightness.light,
            colorScheme: ColorScheme.fromSeed(
              seedColor: const Color(0xFF10B981),
              brightness: isDark ? Brightness.dark : Brightness.light,
              primary: const Color(0xFF10B981),
              background: isDark ? const Color(0xFF121214) : const Color(0xFFF3F4F6),
            ),
            cardTheme: const CardTheme(
              elevation: 1,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.all(Radius.circular(8.0)),
              ),
            ),
          ),
          buttonRadius: 6.0,
          cardRadius: 8.0,
          windowRadius: 10.0,
          sidebarBg: isDark ? const Color(0xFF1E1E24) : const Color(0xFFFFFFFF),
          canvasBg: isDark ? const Color(0xFF121214) : const Color(0xFFF3F4F6),
          accentPrimary: const Color(0xFF10B981),
          textPrimary: isDark ? const Color(0xFFE2E8F0) : const Color(0xFF1F2937),
          textSecondary: isDark ? const Color(0xFF94A3B8) : const Color(0xFF4B5563),
        );

      case AppSkin.flomo:
        return SkinTheme(
          themeData: ThemeData(
            useMaterial3: true,
            brightness: isDark ? Brightness.dark : Brightness.light,
            colorScheme: ColorScheme.fromSeed(
              seedColor: const Color(0xFF32B67A),
              brightness: isDark ? Brightness.dark : Brightness.light,
              primary: const Color(0xFF32B67A),
              background: isDark ? const Color(0xFF181816) : const Color(0xFFF4F4F0),
            ),
            cardTheme: const CardTheme(
              elevation: 0,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.all(Radius.circular(10.0)),
              ),
            ),
          ),
          buttonRadius: 8.0,
          cardRadius: 10.0,
          windowRadius: 12.0,
          sidebarBg: isDark ? const Color(0xFF252522) : const Color(0xFFFFFFFF),
          canvasBg: isDark ? const Color(0xFF181816) : const Color(0xFFF4F4F0),
          accentPrimary: const Color(0xFF32B67A),
          textPrimary: isDark ? const Color(0xFFE5E5E5) : const Color(0xFF333333),
          textSecondary: isDark ? const Color(0xFF8A8A8A) : const Color(0xFF868682),
        );
    }
  }
}
