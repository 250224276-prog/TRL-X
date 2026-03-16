/**
 * KML 分包发送模块
 * 适配 BLE 分包限制，整段 KML 发送完后追加结束符序列 0xFF 0xFF 0xFF
 */

import {
  writeBLECharacteristicValue,
  findWritableCharacteristic,
  createBLEConnection
} from './ble'

/** BLE 单次写入最大字节数，适配 MTU 限制（230 字节适配资料推荐值） */
export const BLE_CHUNK_SIZE = 230

/** KML 发送结束符序列 */
export const KML_END_MARKER = [0xFF, 0xFF, 0xFF]

/**
 * CRC32 计算函数
 */
export function calculateCRC32(buffer: ArrayBuffer): number {
  // CRC32 表
  const crcTable: number[] = []
  for (let i = 0; i < 256; i++) {
    let crc = i
    for (let j = 0; j < 8; j++) {
      crc = (crc >> 1) ^ ((crc & 1) ? 0xEDB88320 : 0)
    }
    crcTable[i] = crc
  }
  
  let crc = 0xFFFFFFFF
  const view = new Uint8Array(buffer)
  
  for (let i = 0; i < view.length; i++) {
    crc = (crc >> 8) ^ crcTable[(crc & 0xFF) ^ view[i]]
  }
  
  // 使用无符号右移确保结果是正数
  return (crc ^ 0xFFFFFFFF) >>> 0
}

/**
 * 读取文件内容并计算 CRC32
 * @param filePath 文件路径
 * @param compress 是否压缩
 * @param fileType 文件类型，'kml' 或 'gpx'
 */
export async function readFileWithCRC(filePath: string, compress: boolean = false, fileType: 'kml' | 'gpx' = 'kml'): Promise<{ buffer: ArrayBuffer; crc32: number }> {
  const buffer = await readFileAsArrayBuffer(filePath, compress, fileType)
  const crc32 = calculateCRC32(buffer)
  return { buffer, crc32 }
}

/**
 * 读取 KML 文件内容并计算 CRC32
 */
export async function readKmlFileWithCRC(filePath: string, compress: boolean = false): Promise<{ buffer: ArrayBuffer; crc32: number }> {
  return readFileWithCRC(filePath, compress, 'kml')
}

export interface SendProgress {
  sentBytes: number
  totalBytes: number
  percent: number
  currentChunk: number
  totalChunks: number
}

export interface KmlSendOptions {
  /** 设备 ID */
  deviceId: string
  /** 分包大小，默认 20 字节 */
  chunkSize?: number
  /** 每包之间的延迟 ms，部分 BLE 栈需要 */
  writeDelayMs?: number
  /** 进度回调 */
  onProgress?: (progress: SendProgress) => void
}

/**
 * 将 ArrayBuffer 按指定大小分块
 */
export function chunkArrayBuffer(
  buffer: ArrayBuffer,
  chunkSize: number
): ArrayBuffer[] {
  const chunks: ArrayBuffer[] = []
  const view = new Uint8Array(buffer)
  for (let i = 0; i < view.length; i += chunkSize) {
    chunks.push(view.slice(i, i + chunkSize).buffer)
  }
  return chunks
}

/** 校验结果：用于在不连设备时验证分包与结束符是否正确 */
export interface VerifyResult {
  ok: boolean
  message: string
  totalBytes: number
  chunkCount: number
  lastByteIs0x04: boolean
  /** 前 64 字节十六进制预览（便于对比） */
  headHex: string
  /** 最后 32 字节十六进制预览（应含 ... FF FF FF） */
  tailHex: string
}

/**
 * 生成「将要通过 BLE 发送的完整载荷」= KML 内容 + 结束符序列 0xFF 0xFF 0xFF
 */
export function getPayloadToSend(
  buffer: ArrayBuffer,
  chunkSize: number = BLE_CHUNK_SIZE
): { payload: ArrayBuffer; chunkCount: number; totalBytes: number } {
  const contentChunks = chunkArrayBuffer(buffer, chunkSize)
  const endChunk = new Uint8Array(KML_END_MARKER).buffer
  const totalBytes = buffer.byteLength + KML_END_MARKER.length
  const chunkCount = contentChunks.length + 1
  const payload = new Uint8Array(totalBytes)
  payload.set(new Uint8Array(buffer), 0)
  payload.set(KML_END_MARKER, payload.length - KML_END_MARKER.length)
  return { payload: payload.buffer, chunkCount, totalBytes }
}

/**
 * 校验分包逻辑是否正确：模拟分包再拼接，应等于 原内容 + 结束符序列 0xFF 0xFF 0xFF
 */
export function verifyChunkedPayload(
  buffer: ArrayBuffer,
  chunkSize: number = BLE_CHUNK_SIZE
): VerifyResult {
  const contentChunks = chunkArrayBuffer(buffer, chunkSize)
  const endChunk = new Uint8Array(KML_END_MARKER)
  const totalBytes = buffer.byteLength + KML_END_MARKER.length
  const chunkCount = contentChunks.length + 1

  const reassembled = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of contentChunks) {
    const arr = new Uint8Array(chunk)
    reassembled.set(arr, offset)
    offset += arr.length
  }
  reassembled.set(KML_END_MARKER, offset)

  const expected = new Uint8Array(totalBytes)
  expected.set(new Uint8Array(buffer), 0)
  expected.set(KML_END_MARKER, expected.length - KML_END_MARKER.length)

  let ok = reassembled.length === expected.length
  if (ok) {
    for (let i = 0; i < expected.length; i++) {
      if (reassembled[i] !== expected[i]) {
        ok = false
        break
      }
    }
  }

  // 检查是否以结束符序列结尾
  const endsWithEndMarker = totalBytes >= KML_END_MARKER.length && 
    reassembled.subarray(totalBytes - KML_END_MARKER.length).every((byte, index) => 
      byte === KML_END_MARKER[index]
    )
  const toHex = (arr: Uint8Array, max: number) =>
    Array.from(arr.slice(0, max))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ')

  return {
    ok,
    message: ok
      ? `校验通过：${totalBytes} 字节，${chunkCount} 包，末尾 ${KML_END_MARKER.map(b => '0x' + b.toString(16).toUpperCase()).join(' ')}`
      : `校验失败：拼接结果与预期不一致`,
    totalBytes,
    chunkCount,
    lastByteIs0x04: endsWithEndMarker, // 保持向后兼容
    endsWithEndMarker,
    headHex: toHex(reassembled, 64),
    tailHex: toHex(reassembled.slice(-32), 32)
  }
}

/**
 * 延时函数
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 将文件转换为与PC端兼容的bin文件（不压缩）
 * @param text 文件内容
 * @param fileType 文件类型，'kml' 或 'gpx'
 */
export function convertFileToBin(text: string, fileType: 'kml' | 'gpx'): ArrayBuffer {
  // 根据文件类型选择解析器
  const { points, lines } = fileType === 'kml' ? parseKmlContent(text) : parseGpxContent(text)
  
  // 生成二进制数据（不压缩）
  const binaryData = generateBinaryData(points, lines, false)
  
  return binaryData.buffer
}

/**
 * 将KML文件转换为与PC端兼容的bin文件（不压缩）
 */
export function convertKmlToBin(text: string): ArrayBuffer {
  return convertFileToBin(text, 'kml')
}

/**
 * 对转换后的bin文件进行压缩
 */
export function compressBinFile(binBuffer: ArrayBuffer): ArrayBuffer {
  const view = new Uint8Array(binBuffer)
  let offset = 0
  
  // 读取总段数
  const totalSegments = readUint32(view, offset)
  offset += 4
  
  // 计算压缩后的数据大小
  let totalSize = 4 // 总段数
  
  // 收集所有段的点数据和原始段点数
  const segments: { pointCount: number; points: { lon: number; lat: number; alt: number }[] }[] = []
  
  for (let i = 0; i < totalSegments; i++) {
    const pointCount = readUint32(view, offset)
    offset += 4
    totalSize += 4 // 段点数
    
    const points: { lon: number; lat: number; alt: number }[] = []
    
    for (let j = 0; j < pointCount; j++) {
      const lonInt = readInt32(view, offset)
      offset += 4
      const latInt = readInt32(view, offset)
      offset += 4
      const altInt = readInt32(view, offset)
      offset += 4
      
      // 转换为浮点数
      const lon = int32ToFloat(lonInt)
      const lat = int32ToFloat(latInt)
      const alt = int32ToFloat(altInt)
      
      points.push({ lon, lat, alt })
    }
    
    segments.push({ pointCount, points })
    totalSize += 12 + points.length * 9 // 估算压缩后的大小
  }
  
  // 分配缓冲区
  const compressedBuffer = new Uint8Array(totalSize)
  let compressedOffset = 0
  
  // 写入总段数
  writeUint32(compressedBuffer, compressedOffset, totalSegments)
  compressedOffset += 4
  
  // 压缩每一段
  for (const segment of segments) {
    // 写入原始段点数，保持与原文件一致
    writeUint32(compressedBuffer, compressedOffset, segment.pointCount)
    compressedOffset += 4
    
    // 压缩点数据
    const pointsCompressed = compressPoints(segment.points)
    compressedBuffer.set(pointsCompressed, compressedOffset)
    compressedOffset += pointsCompressed.length
  }
  
  // 裁剪到实际大小
  return compressedBuffer.slice(0, compressedOffset).buffer
}

/**
 * PC端兼容的文件转换算法（组合转换和压缩）
 * 生成与PC端解析器兼容的二进制格式
 * @param text 文件内容
 * @param fileType 文件类型，'kml' 或 'gpx'
 */
export function compressTextByType(text: string, fileType: 'kml' | 'gpx'): ArrayBuffer {
  // 先转换为bin文件
  const binBuffer = convertFileToBin(text, fileType)
  // 再压缩
  return compressBinFile(binBuffer)
}

/**
 * PC端兼容的KML文件转换算法（组合转换和压缩）
 * 生成与PC端解析器兼容的二进制格式
 */
export function compressText(text: string): ArrayBuffer {
  return compressTextByType(text, 'kml')
}

/**
 * 解压压缩后的bin文件
 */
export function decompress(compressedBuffer: ArrayBuffer): ArrayBuffer {
  const view = new Uint8Array(compressedBuffer)
  let offset = 0
  
  // 读取总段数
  const totalSegments = readUint32(view, offset)
  offset += 4
  
  // 计算解压后的数据大小
  let totalPoints = 0
  const segmentOffsets: number[] = []
  const segmentPointCounts: number[] = []
  
  // 先读取所有段的点数
  for (let i = 0; i < totalSegments; i++) {
    segmentOffsets.push(offset)
    const pointCount = readUint32(view, offset)
    segmentPointCounts.push(pointCount)
    totalPoints += pointCount
    offset += 4
  }
  
  // 计算解压后的数据大小
  const decompressedSize = 4 + totalSegments * 4 + totalPoints * 12
  const decompressedBuffer = new Uint8Array(decompressedSize)
  let decompressedOffset = 0
  
  // 写入总段数
  writeUint32(decompressedBuffer, decompressedOffset, totalSegments)
  decompressedOffset += 4
  
  // 解压每一段
  for (let i = 0; i < totalSegments; i++) {
    const pointCount = segmentPointCounts[i]
    const segmentStart = segmentOffsets[i] + 4 // 跳过段点数
    
    // 写入段点数
    writeUint32(decompressedBuffer, decompressedOffset, pointCount)
    decompressedOffset += 4
    
    // 提取当前段的压缩数据
    let segmentEnd = i < totalSegments - 1 ? segmentOffsets[i + 1] : view.length
    const segmentData = view.slice(segmentStart, segmentEnd)
    
    // 解压点数据
    const points = decompressPoints(segmentData, pointCount)
    
    // 写入解压后的点数据（使用int32格式，与原文件一致）
    for (const point of points) {
      const lonInt = floatToInt32(point.lon)
      const latInt = floatToInt32(point.lat)
      const altInt = floatToInt32(point.alt)
      
      writeInt32(decompressedBuffer, decompressedOffset, lonInt)
      decompressedOffset += 4
      writeInt32(decompressedBuffer, decompressedOffset, latInt)
      decompressedOffset += 4
      writeInt32(decompressedBuffer, decompressedOffset, altInt)
      decompressedOffset += 4
    }
  }
  
  return decompressedBuffer.buffer
}

/**
 * 比较两个ArrayBuffer是否相等
 */
export function compareBuffers(buffer1: ArrayBuffer, buffer2: ArrayBuffer): boolean {
  if (buffer1.byteLength !== buffer2.byteLength) {
    console.log('比较失败：长度不一致', buffer1.byteLength, 'vs', buffer2.byteLength)
    return false
  }
  
  const view1 = new Uint8Array(buffer1)
  const view2 = new Uint8Array(buffer2)
  
  for (let i = 0; i < view1.length; i++) {
    if (view1[i] !== view2[i]) {
      console.log('比较失败：第', i, '字节不一致', view1[i].toString(16).padStart(2, '0'), 'vs', view2[i].toString(16).padStart(2, '0'))
      // 打印周围的字节，方便调试
      const start = Math.max(0, i - 10)
      const end = Math.min(view1.length, i + 10)
      console.log('周围字节：')
      console.log('Buffer1:', Array.from(view1.slice(start, end)).map(b => b.toString(16).padStart(2, '0')).join(' '))
      console.log('Buffer2:', Array.from(view2.slice(start, end)).map(b => b.toString(16).padStart(2, '0')).join(' '))
      return false
    }
  }
  
  return true
}

/**
 * 读取Uint32数据
 */
function readUint32(buffer: Uint8Array, offset: number): number {
  const view = new DataView(new ArrayBuffer(4))
  for (let i = 0; i < 4; i++) {
    view.setUint8(i, buffer[offset + i])
  }
  return view.getUint32(0, true) // little-endian
}

/**
 * 读取Float32数据
 */
function readFloat32(buffer: Uint8Array, offset: number): number {
  const view = new DataView(new ArrayBuffer(4))
  for (let i = 0; i < 4; i++) {
    view.setUint8(i, buffer[offset + i])
  }
  return view.getFloat32(0, true) // little-endian
}

/**
 * 解析KML内容，提取点和线数据
 */
function parseKmlContent(text: string): { points: { lon: number; lat: number; alt: number }[]; lines: { points: { lon: number; lat: number; alt: number }[] }[] } {
  const points: { lon: number; lat: number; alt: number }[] = []
  const lines: { points: { lon: number; lat: number; alt: number }[] }[] = []
  
  // 简单的KML解析，提取Point和LineString数据
  // 注意：这是一个简化的解析器，实际应用中可能需要更复杂的XML解析
  
  // 提取Point数据
  const pointRegex = /<Point[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>[\s\S]*?<\/Point>/g
  let match
  while ((match = pointRegex.exec(text)) !== null) {
    const coordData = match[1].trim()
    const point = parseCoordinate(coordData)
    if (point) {
      points.push(point)
    }
  }
  
  // 提取LineString数据
  const lineRegex = /<LineString[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>[\s\S]*?<\/LineString>/g
  while ((match = lineRegex.exec(text)) !== null) {
    const coordData = match[1].trim()
    const linePoints = parseCoordinates(coordData)
    if (linePoints.length > 0) {
      lines.push({ points: linePoints })
    }
  }
  
  return { points, lines }
}

/**
 * 解析GPX内容，提取点和线数据
 */
function parseGpxContent(text: string): { points: { lon: number; lat: number; alt: number }[]; lines: { points: { lon: number; lat: number; alt: number }[] }[] } {
  const points: { lon: number; lat: number; alt: number }[] = []
  const lines: { points: { lon: number; lat: number; alt: number }[] }[] = []
  
  // 提取wpt数据（对应KML的Point）
  const wptRegex = /<wpt[\s\S]*?lat="([^"]+)"[\s\S]*?lon="([^"]+)"[\s\S]*?(?:<ele>([\s\S]*?)<\/ele>)?[\s\S]*?<\/wpt>/g
  let match
  while ((match = wptRegex.exec(text)) !== null) {
    const lat = parseFloat(match[1])
    const lon = parseFloat(match[2])
    const alt = match[3] ? parseFloat(match[3]) : 0
    
    if (!isNaN(lon) && !isNaN(lat)) {
      points.push({ lon, lat, alt: isNaN(alt) ? 0 : alt })
    }
  }
  
  // 提取trkseg和trkpt数据（对应KML的LineString）
  const trksegRegex = /<trkseg[\s\S]*?<\/trkseg>/g
  while ((match = trksegRegex.exec(text)) !== null) {
    const trksegContent = match[0]
    const trkptRegex = /<trkpt[\s\S]*?lat="([^"]+)"[\s\S]*?lon="([^"]+)"[\s\S]*?(?:<ele>([\s\S]*?)<\/ele>)?[\s\S]*?(?:\/>|<\/trkpt>)/g
    const linePoints: { lon: number; lat: number; alt: number }[] = []
    
    let trkptMatch
    while ((trkptMatch = trkptRegex.exec(trksegContent)) !== null) {
      const lat = parseFloat(trkptMatch[1])
      const lon = parseFloat(trkptMatch[2])
      const alt = trkptMatch[3] ? parseFloat(trkptMatch[3]) : 0
      
      if (!isNaN(lon) && !isNaN(lat)) {
        linePoints.push({ lon, lat, alt: isNaN(alt) ? 0 : alt })
      }
    }
    
    if (linePoints.length > 0) {
      lines.push({ points: linePoints })
    }
  }
  
  return { points, lines }
}

/**
 * 解析单个坐标
 */
function parseCoordinate(coordData: string): { lon: number; lat: number; alt: number } | null {
  const parts = coordData.split(',')
  if (parts.length >= 2) {
    const lon = parseFloat(parts[0])
    const lat = parseFloat(parts[1])
    const alt = parts.length >= 3 ? parseFloat(parts[2]) : 0
    
    if (!isNaN(lon) && !isNaN(lat)) {
      return { lon, lat, alt: isNaN(alt) ? 0 : alt }
    }
  }
  return null
}

/**
 * 解析多个坐标
 */
function parseCoordinates(coordData: string): { lon: number; lat: number; alt: number }[] {
  const result: { lon: number; lat: number; alt: number }[] = []
  
  // 坐标数据格式: "lon,lat,alt lon,lat,alt ..."
  const coords = coordData.split(/\s+/).filter(c => c.length > 0)
  
  for (const coord of coords) {
    const point = parseCoordinate(coord)
    if (point) {
      result.push(point)
    }
  }
  
  return result
}

/**
 * float转int32函数
 * 使用缩放因子将float转换为int32，保留足够的精度
 */
function floatToInt32(value: number): number {
  // 对于经纬度，使用1e6的缩放因子，保留6位小数
  // 对于海拔，使用1e2的缩放因子，保留2位小数
  return Math.round(value * 1000000)
}

/**
 * int32转float函数
 */
function int32ToFloat(value: number): number {
  return value / 1000000
}

/**
 * 编码差值为字节
 * 使用可变长度编码，小数值用更少的字节
 * 第一个字节格式: [继续位(1bit)][符号位(1bit)][数据位(6bit)]
 * 后续字节格式: [继续位(1bit)][数据位(7bit)]
 */
function encodeDelta(delta: number): number[] {
  const result: number[] = []
  
  // 处理符号
  const sign = delta < 0 ? 1 : 0
  let absDelta = Math.abs(delta)
  
  // 第一个字节：6位数据 + 1位符号 + 1位继续标志
  let firstByte = absDelta & 0x3F  // 取低6位
  absDelta >>= 6
  
  if (absDelta > 0) {
    firstByte |= 0x80  // 设置继续位
  }
  
  if (sign > 0) {
    firstByte |= 0x40  // 设置符号位
  }
  
  result.push(firstByte)
  
  // 后续字节：每字节7位数据 + 1位继续标志
  while (absDelta > 0) {
    let byte = absDelta & 0x7F  // 取低7位
    absDelta >>= 7
    
    if (absDelta > 0) {
      byte |= 0x80  // 设置继续位
    }
    
    result.push(byte)
  }
  
  return result
}

/**
 * 解码字节为差值
 */
function decodeDelta(bytes: number[]): number {
  let result = 0
  let sign = 0
  let shift = 0
  
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]
    
    // 提取符号位（仅第一个字节）
    if (i === 0) {
      sign = (byte & 0x40) >> 6
    }
    
    // 提取数据位（低7位，去除符号位和继续位）
    const dataBits = i === 0 ? (byte & 0x3F) : (byte & 0x7F)
    
    // 按位累加（低位优先）
    result |= (dataBits << shift)
    shift += (i === 0 ? 6 : 7)
    
    // 检查是否结束（继续位为0）
    if ((byte & 0x80) === 0) {
      break
    }
  }
  
  // 应用符号
  return sign === 1 ? -result : result
}

/**
 * 压缩点数据
 */
function compressPoints(points: { lon: number; lat: number; alt: number }[]): Uint8Array {
  if (points.length === 0) {
    return new Uint8Array(0)
  }
  
  // 计算压缩后的数据大小（估算）
  const estimatedSize = 12 + points.length * 9 // 第一个点12字节，后续每个点约3字节
  const buffer = new Uint8Array(estimatedSize)
  let offset = 0
  
  // 写入第一个点的原始数据（作为基准点）
  const firstPoint = points[0]
  const firstLonInt = floatToInt32(firstPoint.lon)
  const firstLatInt = floatToInt32(firstPoint.lat)
  const firstAltInt = floatToInt32(firstPoint.alt)
  
  writeInt32(buffer, offset, firstLonInt)
  offset += 4
  writeInt32(buffer, offset, firstLatInt)
  offset += 4
  writeInt32(buffer, offset, firstAltInt)
  offset += 4
  
  // 压缩后续点
  let prevLonInt = firstLonInt
  let prevLatInt = firstLatInt
  let prevAltInt = firstAltInt
  
  for (let i = 1; i < points.length; i++) {
    const point = points[i]
    const lonInt = floatToInt32(point.lon)
    const latInt = floatToInt32(point.lat)
    const altInt = floatToInt32(point.alt)
    
    // 计算差值
    const deltaLon = lonInt - prevLonInt
    const deltaLat = latInt - prevLatInt
    const deltaAlt = altInt - prevAltInt
    
    // 编码差值
    const encodedLon = encodeDelta(deltaLon)
    const encodedLat = encodeDelta(deltaLat)
    const encodedAlt = encodeDelta(deltaAlt)
    
    // 写入编码后的数据
    for (const byte of encodedLon) {
      buffer[offset++] = byte
    }
    for (const byte of encodedLat) {
      buffer[offset++] = byte
    }
    for (const byte of encodedAlt) {
      buffer[offset++] = byte
    }
    
    // 更新前一个点
    prevLonInt = lonInt
    prevLatInt = latInt
    prevAltInt = altInt
  }
  
  // 裁剪到实际大小
  return buffer.slice(0, offset)
}

/**
 * 解压点数据
 */
function decompressPoints(compressedData: Uint8Array, pointCount: number): { lon: number; lat: number; alt: number }[] {
  const points: { lon: number; lat: number; alt: number }[] = []
  if (pointCount === 0 || compressedData.length === 0) {
    return points
  }
  
  let offset = 0
  
  // 读取第一个点（基准点）
  const firstLonInt = readInt32(compressedData, offset)
  offset += 4
  const firstLatInt = readInt32(compressedData, offset)
  offset += 4
  const firstAltInt = readInt32(compressedData, offset)
  offset += 4
  
  points.push({
    lon: int32ToFloat(firstLonInt),
    lat: int32ToFloat(firstLatInt),
    alt: int32ToFloat(firstAltInt)
  })
  
  // 解压后续点
  let prevLonInt = firstLonInt
  let prevLatInt = firstLatInt
  let prevAltInt = firstAltInt
  
  for (let i = 1; i < pointCount; i++) {
    // 解码经度差值
    const lonBytes: number[] = []
    while (offset < compressedData.length) {
      const byte = compressedData[offset++]
      lonBytes.push(byte)
      if ((byte & 0x80) === 0) {
        break
      }
    }
    const deltaLon = decodeDelta(lonBytes)
    
    // 解码纬度差值
    const latBytes: number[] = []
    while (offset < compressedData.length) {
      const byte = compressedData[offset++]
      latBytes.push(byte)
      if ((byte & 0x80) === 0) {
        break
      }
    }
    const deltaLat = decodeDelta(latBytes)
    
    // 解码海拔差值
    const altBytes: number[] = []
    while (offset < compressedData.length) {
      const byte = compressedData[offset++]
      altBytes.push(byte)
      if ((byte & 0x80) === 0) {
        break
      }
    }
    const deltaAlt = decodeDelta(altBytes)
    
    // 计算当前点
    const currentLonInt = prevLonInt + deltaLon
    const currentLatInt = prevLatInt + deltaLat
    const currentAltInt = prevAltInt + deltaAlt
    
    points.push({
      lon: int32ToFloat(currentLonInt),
      lat: int32ToFloat(currentLatInt),
      alt: int32ToFloat(currentAltInt)
    })
    
    // 更新前一个点
    prevLonInt = currentLonInt
    prevLatInt = currentLatInt
    prevAltInt = currentAltInt
  }
  
  return points
}

/**
 * 生成与PC端兼容的二进制数据
 * 格式：线数据（分段格式），与PC端解析器兼容
 */
function generateBinaryData(points: { lon: number; lat: number; alt: number }[], lines: { points: { lon: number; lat: number; alt: number }[] }[], compress: boolean = true): Uint8Array {
  // 计算总大小
  let totalSize = 0
  
  // 线数据大小：总段数(4字节) + 每段点数(4字节) + 每段点数据
  totalSize += 4 // 总段数
  for (const line of lines) {
    // 简单起见，每条LineString作为一个段
    totalSize += 4 // 段点数
    if (compress) {
      // 压缩模式：估算大小
      totalSize += 12 + line.points.length * 9 // 第一个点12字节，后续每个点约3字节
    } else {
      // 非压缩模式：每个点12字节
      totalSize += line.points.length * 12
    }
  }
  
  // 分配缓冲区
  const buffer = new Uint8Array(totalSize)
  let offset = 0
  
  // 写入线数据（分段格式，与PC端解析器兼容）
  const totalSegments = lines.length
  writeUint32(buffer, offset, totalSegments)
  offset += 4
  
  for (const line of lines) {
    const pointCount = line.points.length
    writeUint32(buffer, offset, pointCount)
    offset += 4
    
    if (compress) {
      // 压缩模式
      const compressedData = compressPoints(line.points)
      buffer.set(compressedData, offset)
      offset += compressedData.length
    } else {
      // 非压缩模式（使用int32格式，与压缩模式保持一致）
      for (const point of line.points) {
        const lonInt = floatToInt32(point.lon)
        const latInt = floatToInt32(point.lat)
        const altInt = floatToInt32(point.alt)
        
        writeInt32(buffer, offset, lonInt)
        offset += 4
        writeInt32(buffer, offset, latInt)
        offset += 4
        writeInt32(buffer, offset, altInt)
        offset += 4
      }
    }
  }
  
  // 裁剪到实际大小
  return buffer.slice(0, offset)
}

/**
 * 写入GeoPoint数据
 */
function writeGeoPoint(buffer: Uint8Array, offset: number, point: { lon: number; lat: number; alt: number }): void {
  // 使用DataView确保little-endian字节序
  const view = new DataView(new ArrayBuffer(12))
  view.setFloat32(0, point.lon, true) // little-endian
  view.setFloat32(4, point.lat, true) // little-endian
  view.setFloat32(8, point.alt, true) // little-endian
  
  // 复制到目标缓冲区
  const uint8View = new Uint8Array(view.buffer)
  for (let i = 0; i < 12; i++) {
    buffer[offset + i] = uint8View[i]
  }
}

/**
 * 写入Uint32数据
 */
function writeUint32(buffer: Uint8Array, offset: number, value: number): void {
  const view = new DataView(new ArrayBuffer(4))
  view.setUint32(0, value, true) // little-endian
  const uint8View = new Uint8Array(view.buffer)
  for (let i = 0; i < 4; i++) {
    buffer[offset + i] = uint8View[i]
  }
}

/**
 * 写入Int32数据
 */
function writeInt32(buffer: Uint8Array, offset: number, value: number): void {
  const view = new DataView(new ArrayBuffer(4))
  view.setInt32(0, value, true) // little-endian
  const uint8View = new Uint8Array(view.buffer)
  for (let i = 0; i < 4; i++) {
    buffer[offset + i] = uint8View[i]
  }
}

/**
 * 读取Int32数据
 */
function readInt32(buffer: Uint8Array, offset: number): number {
  const view = new DataView(new ArrayBuffer(4))
  for (let i = 0; i < 4; i++) {
    view.setUint8(i, buffer[offset + i])
  }
  return view.getInt32(0, true) // little-endian
}

/**
 * 读取文件内容为 ArrayBuffer（UTF-8）
 * 使用 encoding: 'utf8' 保证各平台返回一致，再转成 UTF-8 字节
 * @param filePath 文件路径
 * @param compress 是否压缩
 * @param fileType 文件类型，'kml' 或 'gpx'
 */
export function readFileAsArrayBuffer(filePath: string, compress: boolean = false, fileType: 'kml' | 'gpx' = 'kml'): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const fs = wx.getFileSystemManager()
    fs.readFile({
      filePath,
      encoding: 'utf8',
      success: (res) => {
        const data = res.data
        if (typeof data === 'string') {
          if (compress) {
            // 使用压缩算法
            console.log('Compressing file, original length:', data.length)
            const compressedBuffer = compressTextByType(data, fileType)
            console.log('Compressed length:', compressedBuffer.byteLength)
            console.log('Compression ratio:', ((1 - compressedBuffer.byteLength / data.length) * 100).toFixed(2) + '%')
            
            resolve(compressedBuffer)
          } else {
            const originalBuffer = stringToUtf8ArrayBuffer(data)
            console.log('Original buffer length:', originalBuffer.byteLength)
            resolve(originalBuffer)
          }
          return
        }
        if (data instanceof ArrayBuffer) {
          resolve(data)
          return
        }
        reject(new Error('无法读取文件内容'))
      },
      fail: (err) => reject(err)
    })
  })
}

/**
 * 读取 KML 文件内容为 ArrayBuffer（UTF-8）
 * 使用 encoding: 'utf8' 保证各平台返回一致，再转成 UTF-8 字节
 */
export function readKmlFileAsArrayBuffer(filePath: string, compress: boolean = false): Promise<ArrayBuffer> {
  return readFileAsArrayBuffer(filePath, compress, 'kml')
}

/**
 * 字符串转 UTF-8 ArrayBuffer
 * 兼容不支持 TextEncoder 的环境
 */
function stringToUtf8ArrayBuffer(str: string): ArrayBuffer {
  // 手动实现 UTF-8 编码，不依赖 TextEncoder
  let length = 0
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    if (code <= 0x7f) {
      length += 1
    } else if (code <= 0x7ff) {
      length += 2
    } else if (code <= 0xffff) {
      length += 3
    } else {
      length += 4
    }
  }
  
  const buffer = new ArrayBuffer(length)
  const view = new Uint8Array(buffer)
  let offset = 0
  
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    if (code <= 0x7f) {
      view[offset++] = code
    } else if (code <= 0x7ff) {
      view[offset++] = 0xc0 | (code >> 6)
      view[offset++] = 0x80 | (code & 0x3f)
    } else if (code <= 0xffff) {
      view[offset++] = 0xe0 | (code >> 12)
      view[offset++] = 0x80 | ((code >> 6) & 0x3f)
      view[offset++] = 0x80 | (code & 0x3f)
    } else {
      view[offset++] = 0xf0 | (code >> 18)
      view[offset++] = 0x80 | ((code >> 12) & 0x3f)
      view[offset++] = 0x80 | ((code >> 6) & 0x3f)
      view[offset++] = 0x80 | (code & 0x3f)
    }
  }
  
  return buffer
}



/**
 * 将 KML 的 ArrayBuffer 分包发送到 BLE 设备
 * 最后追加结束符序列 0xFF 0xFF 0xFF
 */
export async function sendKmlBufferToBle(
  buffer: ArrayBuffer,
  options: KmlSendOptions
): Promise<void> {
  console.log('sendKmlBufferToBle called with buffer length:', buffer.byteLength)
  const {
    deviceId,
    chunkSize = 230, // 按照表格设置分包大小
    writeDelayMs = 20, // 按照表格设置发送间隔
    onProgress
  } = options

  // 分包：KML 内容
  console.log('Chunking buffer with size:', chunkSize)
  const contentChunks = chunkArrayBuffer(buffer, chunkSize)
  // 结束符单独一包
  const endChunk = new Uint8Array(KML_END_MARKER).buffer
  const allChunks = [...contentChunks, endChunk]
  const totalBytes = buffer.byteLength + KML_END_MARKER.length
  let sentBytes = 0
  let currentChunkIndex = 0

  console.log('Total chunks to send:', allChunks.length)
  console.log('Total bytes to send:', totalBytes)

  // 主发送循环，支持重连后续传
  while (currentChunkIndex < allChunks.length) {
    try {
      console.log('Finding writable characteristic for device:', deviceId)
      const characteristic = await findWritableCharacteristic(deviceId)
      console.log('Found writable characteristic:', characteristic)

      // 发送当前及后续数据包
      for (let i = currentChunkIndex; i < allChunks.length; i++) {

        const chunk = allChunks[i]
        console.log('Sending chunk', i + 1, 'of', allChunks.length, 'size:', chunk.byteLength)
        
        // 添加错误重试机制
        let retries = 3
        let sent = false
        
        while (retries > 0 && !sent) {
          try {
            await writeBLECharacteristicValue(
              deviceId,
              characteristic.serviceId,
              characteristic.uuid,
              chunk
            )
            console.log('Chunk', i + 1, 'sent successfully')
            sent = true
          } catch (error: any) {
            console.warn('Error sending chunk', i + 1, ':', error)
            
            // 检查是否是连接错误
            if (error.errMsg && error.errMsg.includes('no connection')) {
              console.warn('Connection lost, will attempt to reconnect')
              throw error // 抛出错误以触发重连
            }
            
            retries--
            if (retries > 0) {
              console.log('Retrying...', retries, 'attempts left')
              await delay(writeDelayMs * 2) // 重试时增加延迟
            } else {
              throw error // 重试失败，抛出错误
            }
          }
        }

        sentBytes += chunk.byteLength
        currentChunkIndex = i + 1 // 更新当前位置

        if (onProgress) {
          console.log('Calling onProgress with sentBytes:', sentBytes, 'totalBytes:', totalBytes)
          onProgress({
            sentBytes,
            totalBytes,
            percent: Math.round((sentBytes / totalBytes) * 100),
            currentChunk: i + 1,
            totalChunks: allChunks.length
          })
          console.log('onProgress called successfully')
        }

        // 包间延迟，避免 BLE 栈溢出
        if (writeDelayMs > 0 && i < allChunks.length - 1) {
          console.log('Waiting for', writeDelayMs, 'ms before sending next chunk')
          await delay(writeDelayMs)
        }
      }
      
      // 所有数据包发送完成
      console.log('All chunks sent successfully')
      return
      
    } catch (error: any) {
      console.warn('Error during send, attempting to reconnect:', error)
      
      // 检查是否是连接错误
      if (error.errMsg && error.errMsg.includes('no connection')) {
        console.log('Attempting to reconnect...')
        
        try {
          // 尝试重新连接
          await createBLEConnection(deviceId)
          console.log('Reconnected successfully, resuming send from chunk', currentChunkIndex + 1)
          
          // 延迟一段时间，确保连接稳定
          await delay(1000)
        } catch (reconnectError) {
          console.error('Failed to reconnect:', reconnectError)
          throw new Error('连接断开且重连失败，请重新手动连接设备')
        }
      } else {
        // 其他错误，直接抛出
        throw error
      }
    }
  }
}
