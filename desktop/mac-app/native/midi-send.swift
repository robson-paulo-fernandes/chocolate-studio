// chocolate-midi-send: the Mac app's MIDI path to the Chocolate, through CoreMIDI in both directions, the way
// CubeSuite and SysEx Librarian do. With Chromium's Web MIDI on macOS 26, MIDI Monitor showed outgoing SysEx
// fragmented (a lone F0, the message, an invalid byte) and the Chocolate Plus ignored it; after outgoing went
// native, the Chocolate answered (seen in MIDI Monitor) but the replies never reached the page through Web MIDI.
//
// stdin, one request per line:
//   <id>\tsend\t<destination name>\t<hex bytes>   sends the bytes as ONE packet
//   <id>\tlisten\t<source name>                   receives from that source only (replaces the previous one)
//   <id>\tstop                                    stops receiving
// stdout, one line each:
//   <id>\tok   or   <id>\terror\t<reason>
//   in\t<hex bytes>                               every packet received from the listened source
import CoreMIDI
import Foundation

let output = DispatchQueue(label: "chocolate.stdout")
func emit(_ line: String) { output.sync { print(line); fflush(stdout) } }
func hex(_ bytes: UnsafeRawBufferPointer) -> String { bytes.map { String(format: "%02x", $0) }.joined() }

// MIDIPacket is packed: timeStamp (8) + length (2), then data
let dataOffset = MemoryLayout<MIDIPacket>.offset(of: \MIDIPacket.data) ?? 10

var client = MIDIClientRef()
var outPort = MIDIPortRef()
var inPort = MIDIPortRef()
var listening: MIDIEndpointRef = 0

guard MIDIClientCreate("Chocolate Studio" as CFString, nil, nil, &client) == noErr,
      MIDIOutputPortCreate(client, "Chocolate Studio out" as CFString, &outPort) == noErr,
      MIDIInputPortCreateWithBlock(client, "Chocolate Studio in" as CFString, &inPort, { list, _ in
        for packet in list.unsafeSequence() {
          let length = Int(packet.pointee.length)
          guard length > 0 else { continue }
          // read `length` bytes in place: a packet's data can be longer than the 256-byte tuple Swift imports
          let start = UnsafeRawPointer(packet).advanced(by: dataOffset)
          emit("in\t" + hex(UnsafeRawBufferPointer(start: start, count: length)))
        }
      }) == noErr else {
  emit("0\terror\tcoremidi-unavailable")
  exit(1)
}

func stringProperty(_ object: MIDIObjectRef, _ key: CFString) -> String? {
  var value: Unmanaged<CFString>?
  guard MIDIObjectGetStringProperty(object, key, &value) == noErr, let text = value?.takeRetainedValue() else { return nil }
  return text as String
}

/// Exactly one endpoint whose name or display name equals `name`.
func endpoint(named name: String, count: Int, at: (Int) -> MIDIEndpointRef) -> (MIDIEndpointRef?, String) {
  var found: [MIDIEndpointRef] = []
  for index in 0..<count {
    let candidate = at(index)
    if stringProperty(candidate, kMIDIPropertyName) == name || stringProperty(candidate, kMIDIPropertyDisplayName) == name {
      found.append(candidate)
    }
  }
  if found.count == 1 { return (found[0], "") }
  return (nil, found.isEmpty ? "not-found" : "ambiguous")
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

func send(_ bytes: [UInt8], to target: MIDIEndpointRef) -> OSStatus {
  let size = bytes.count + 1024
  let buffer = UnsafeMutableRawPointer.allocate(byteCount: size, alignment: 8)
  defer { buffer.deallocate() }
  let list = buffer.bindMemory(to: MIDIPacketList.self, capacity: 1)
  var packet = MIDIPacketListInit(list)
  packet = MIDIPacketListAdd(list, size, packet, 0, bytes.count, bytes)
  return MIDISend(outPort, target, list)
}

func stopListening() {
  if listening != 0 { MIDIPortDisconnectSource(inPort, listening); listening = 0 }
}

while let line = readLine() {
  let fields = line.split(separator: "\t", omittingEmptySubsequences: false).map(String.init)
  let id = fields.first ?? "0"
  switch (fields.count, fields.count > 1 ? fields[1] : "") {
  case (4, "send"):
    guard let bytes = parseHex(fields[3]) else { emit("\(id)\terror\tbad-bytes"); continue }
    let (found, reason) = endpoint(named: fields[2], count: MIDIGetNumberOfDestinations(), at: MIDIGetDestination)
    guard let target = found else { emit("\(id)\terror\tdestination-\(reason)"); continue }
    let status = send(bytes, to: target)
    emit(status == noErr ? "\(id)\tok" : "\(id)\terror\tmidisend-\(status)")
  case (3, "listen"):
    let (found, reason) = endpoint(named: fields[2], count: MIDIGetNumberOfSources(), at: MIDIGetSource)
    guard let source = found else { emit("\(id)\terror\tsource-\(reason)"); continue }
    stopListening()
    let status = MIDIPortConnectSource(inPort, source, nil)
    if status == noErr { listening = source; emit("\(id)\tok") } else { emit("\(id)\terror\tconnect-\(status)") }
  case (2, "stop"):
    stopListening()
    emit("\(id)\tok")
  default:
    emit("\(id)\terror\tbad-request")
  }
}
