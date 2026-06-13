import 'package:flutter/services.dart';
import 'package:local_auth/local_auth.dart';
import 'package:local_auth_android/local_auth_android.dart';
import 'package:local_auth_ios/local_auth_ios.dart';

class BiometricService {
  final LocalAuthentication _auth = LocalAuthentication();

  /// Check if the device has biometric hardware and it is configured
  Future<bool> isBiometricAvailable() async {
    try {
      final bool canAuthenticateWithBiometrics = await _auth.canCheckBiometrics;
      final bool canAuthenticate = canAuthenticateWithBiometrics || await _auth.isDeviceSupported();
      return canAuthenticate;
    } on PlatformException catch (e) {
      print("[BiometricService] isBiometricAvailable error: $e");
      return false;
    }
  }

  /// Get list of enrolled biometric types (fingerprint, face, etc.)
  Future<List<BiometricType>> getAvailableBiometrics() async {
    try {
      return await _auth.getAvailableBiometrics();
    } on PlatformException catch (e) {
      print("[BiometricService] getAvailableBiometrics error: $e");
      return [];
    }
  }

  /// Perform authentication. Returns true if successful.
  Future<bool> authenticate({
    required String reason,
    bool stickyAuth = true,
    bool biometricOnly = false,
  }) async {
    try {
      final bool didAuthenticate = await _auth.authenticate(
        localizedReason: reason,
        options: AuthenticationOptions(
          stickyAuth: stickyAuth,
          biometricOnly: biometricOnly,
          useErrorDialogs: true,
        ),
        authMessages: const <AuthMessages>[
          AndroidAuthMessages(
            signInTitle: '安全身份验证',
            deviceCredentialsRequiredTitle: '请输入设备密码',
            cancelButton: '取消',
          ),
          IOSAuthMessages(
            cancelButton: '取消',
          ),
        ],
      );
      return didAuthenticate;
    } on PlatformException catch (e) {
      print("[BiometricService] authenticate error: $e");
      return false;
    }
  }
}
