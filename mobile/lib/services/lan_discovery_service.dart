import 'package:nsd/nsd.dart' as nsd;

class DiscoveredPeer {
  final String name;
  final String host;
  final int port;
  final List<String> addresses;
  final Map<String, String> txt;

  DiscoveredPeer({
    required this.name,
    required this.host,
    required this.port,
    required this.addresses,
    required this.txt,
  });

  String get ipv4 {
    // Pick first IPv4 address
    return addresses.firstWhere(
      (addr) => RegExp(r'^\d+\.\d+\.\d+\.\d+$').hasMatch(addr),
      orElse: () => addresses.isNotEmpty ? addresses.first : '',
    );
  }
}

class LanDiscoveryService {
  nsd.Discovery? _discovery;
  final List<DiscoveredPeer> _peers = [];
  bool _isScanning = false;

  bool get isScanning => _isScanning;
  List<DiscoveredPeer> get peers => _peers;

  /// Start scanning for peer servers on the local Wi-Fi router
  Future<void> startDiscovery(Function(List<DiscoveredPeer>) onUpdated) async {
    if (_isScanning) return;
    _isScanning = true;

    try {
      _discovery = await nsd.startDiscovery('_super-note._tcp');
      _discovery!.addListener(() {
        _peers.clear();
        for (var service in _discovery!.services) {
          final String name = service.name ?? '';
          final String host = service.host ?? '';
          final int port = service.port ?? 3001;
          
          final List<String> addresses = service.addresses
                  ?.map((addr) => addr.address)
                  .toList() ?? [];

          // Parse TXT records
          final Map<String, String> txtMap = {};
          service.txt?.forEach((key, value) {
            txtMap[key] = value != null ? String.fromCharCodes(value) : '';
          });

          if (name.isNotEmpty) {
            _peers.add(
              DiscoveredPeer(
                name: name,
                host: host,
                port: port,
                addresses: addresses,
                txt: txtMap,
              ),
            );
          }
        }
        onUpdated(List.from(_peers));
      });
    } catch (e) {
      print("[LanDiscoveryService] Failed to start mDNS discovery: $e");
      _isScanning = false;
    }
  }

  /// Stop scanning
  Future<void> stopDiscovery() async {
    if (!_isScanning) return;
    _isScanning = false;

    if (_discovery != null) {
      try {
        await nsd.stopDiscovery(_discovery!);
      } catch (e) {
        print("[LanDiscoveryService] Failed to stop mDNS discovery: $e");
      }
      _discovery = null;
    }
    _peers.clear();
  }
}
