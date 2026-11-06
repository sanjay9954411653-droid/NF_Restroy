/**
 * Minimal ambient types for the WebUSB and Web Bluetooth APIs used by
 * ../lib/thermalPrinter.ts. These browser APIs aren't part of TypeScript's
 * standard DOM lib, so only the small subset actually used is declared here.
 */

interface USBDevice {
  opened: boolean
  vendorId: number
  productId: number
  productName?: string
  manufacturerName?: string
  configuration: { interfaces: USBInterface[] } | null
  open(): Promise<void>
  close(): Promise<void>
  selectConfiguration(configurationValue: number): Promise<void>
  claimInterface(interfaceNumber: number): Promise<void>
  transferOut(endpointNumber: number, data: BufferSource): Promise<{ status: string; bytesWritten: number }>
}
interface USBInterface {
  interfaceNumber: number
  alternate: { interfaceClass?: number; endpoints: USBEndpoint[] }
}
interface USBEndpoint {
  endpointNumber: number
  direction: 'in' | 'out'
}
interface USB {
  requestDevice(options: { filters: Array<Record<string, unknown>> }): Promise<USBDevice>
  getDevices(): Promise<USBDevice[]>
}

interface BluetoothRemoteGATTCharacteristic {
  writeValue(value: BufferSource): Promise<void>
  writeValueWithoutResponse?(value: BufferSource): Promise<void>
}
interface BluetoothRemoteGATTService {
  getCharacteristic(uuid: string): Promise<BluetoothRemoteGATTCharacteristic>
}
interface BluetoothRemoteGATTServer {
  connected: boolean
  connect(): Promise<BluetoothRemoteGATTServer>
  getPrimaryService(uuid: string): Promise<BluetoothRemoteGATTService>
}
interface BluetoothDevice {
  id: string
  name?: string
  gatt?: BluetoothRemoteGATTServer
}
interface Bluetooth {
  requestDevice(options: {
    acceptAllDevices?: boolean
    filters?: Array<Record<string, unknown>>
    optionalServices?: string[]
  }): Promise<BluetoothDevice>
  getDevices?(): Promise<BluetoothDevice[]>
}

interface Navigator {
  usb?: USB
  bluetooth?: Bluetooth
}
