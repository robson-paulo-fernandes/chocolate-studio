// chocolate-midi-send: sends complete MIDI messages (SysEx included) to a CoreMIDI destination as ONE packet,
// the way CubeSuite and SysEx Librarian do. Chromium's Web MIDI output reached the Chocolate Plus fragmented
// (a lone F0, the message, an invalid byte, as seen by MIDI Monitor) and the controller ignored it.
//
// Protocol on stdin, one request per line:  <id>\t<destination name>\t<hex bytes>
// Reply on stdout, one line per request:     <id>\tok   or   <id>\terror\t<reason>
import CoreMIDI
import Foundation

setvbuf(stdout, nil, _IOLBF, 0)

var client = MIDIClientRef()
var port = MIDIPortRef()
guard MIDIClientCreate("Chocolate Studio" as CFString, nil, nil, &client) == noErr,
      MIDIOutputPortCreate(client, "Chocolate Studio out" as CFString, &port) == noErr else {
  print("0\terror\tcoremidi-unavailable")
  exit(1)
}

func stringProperty(_ object: MIDIObjectRef, _ key: CFString) -> String? {
  var value: Unmanaged<CFString>?
  guard MIDIObjectGetStringProperty(object, key, &value) == noErr, let text = value?.takeRetainedValue() else { return nil }
  return text as String
}

/// Exactly one destination whose name or display name equals `name`; nil when none or several.
func destination(named name: String) -> (MIDIEndpointRef?, String) {
  var found: [MIDIEndpointRef] = []
  for index in 0..<MIDIGetNumberOfDestinations() {
    let endpoint = MIDIGetDestination(index)
    if stringProperty(endpoint, kMIDIPropertyName) == name || stringProperty(endpoint, kMIDIPropertyDisplayName) == name {
      found.append(endpoint)
    }
  }
  if found.count == 1 { return (found[0], "") }
  return (nil, found.isEmpty ? "destination-not-found" : "destination-ambiguous")
}

func parseHex(_ text: String) -> [UInt8]? {
  let chars = Array(text.utf8)
  guard !chars.isEmpty, chars.count % 2 == 0, chars.count <= 2 * 8192 else { return nil }
  var bytes: [UInt8] = []
  bytes.reserveCapacity(chars.count / 2)
  var index = 0
  while index < chars.count {
    guard let byte = UInt8(String(decoding: chars[index..<index + 2], as: UTF8.self), radix: 16) else { return nil }
    bytes.append(byte)
    index += 2
  }
  return bytes
}

func send(_ bytes: [UInt8], to endpoint: MIDIEndpointRef) -> OSStatus {
  let size = bytes.count + 1024
  let buffer = UnsafeMutableRawPointer.allocate(byteCount: size, alignment: 8)
  defer { buffer.deallocate() }
  let list = buffer.bindMemory(to: MIDIPacketList.self, capacity: 1)
  var packet = MIDIPacketListInit(list)
  packet = MIDIPacketListAdd(list, size, packet, 0, bytes.count, bytes)
  return MIDISend(port, endpoint, list)
}

while let line = readLine() {
  let fields = line.split(separator: "\t", omittingEmptySubsequences: false).map(String.init)
  guard fields.count == 3 else { print("\(fields.first ?? "0")\terror\tbad-request"); continue }
  let id = fields[0]
  guard let bytes = parseHex(fields[2]) else { print("\(id)\terror\tbad-bytes"); continue }
  let (endpoint, reason) = destination(named: fields[1])
  guard let target = endpoint else { print("\(id)\terror\t\(reason)"); continue }
  let status = send(bytes, to: target)
  print(status == noErr ? "\(id)\tok" : "\(id)\terror\tmidisend-\(status)")
}
