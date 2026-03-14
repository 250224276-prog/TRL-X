/**
 * KML 分包发送模块
 * 适配 BLE 分包限制，整段 KML 发送完后追加结束符序列 0xFF 0xFF 0xFF
 */

const {
  writeBLECharacteristicValue,
  findWritableCharacteristic,
  createBLEConnection
} = require('./ble')

/** BLE 单次写入最大字节数，适配 MTU 限制（230 字节适配资料推荐值） */
const BLE_CHUNK_SIZE = 230

/** KML 发送结束符序列 */
const KML_END_MARKER = [0xFF, 0xFF, 0xFF]

/**
 * CRC32 计算函数
 */
function calculateCRC32(buffer) {
  const crcTable = []
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

  return (crc ^ 0xFFFFFFFF) >>> 0
}

/**
 * 读取文件内容并计算 CRC32
 * @param filePath 文件路径
 * @param compress 是否压缩
 * @param fileType 文件类型，'kml' 或 'gpx'
 */
async function readFileWithCRC(filePath, compress = false, fileType = 'kml') {
  const buffer = await readFileAsArrayBuffer(filePath, compress, fileType)
  const crc32 = calculateCRC32(buffer)
  return { buffer, crc32 }
}

/**
 * 读取 KML 文件内容并计算 CRC32
 */
async function readKmlFileWithCRC(filePath, compress = false) {
  return readFileWithCRC(filePath, compress, 'kml')
}

/**
 * 将 ArrayBuffer 按指定大小分块
 */
function chunkArrayBuffer(buffer, chunkSize) {
  const chunks = []
  const view = new Uint8Array(buffer)
  for (let i = 0; i < view.length; i += chunkSize) {
    chunks.push(view.slice(i, i + chunkSize).buffer)
  }
  return chunks
}

/**
 * 生成「将要通过 BLE 发送的完整载荷」= KML 内容 + 结束符序列 0xFF 0xFF 0xFF
 */
function getPayloadToSend(buffer, chunkSize = BLE_CHUNK_SIZE) {
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
function verifyChunkedPayload(buffer, chunkSize = BLE_CHUNK_SIZE) {
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

  const endsWithEndMarker = totalBytes >= KML_END_MARKER.length &&
    reassembled.subarray(totalBytes - KML_END_MARKER.length).every((byte, index) =>
      byte === KML_END_MARKER[index]
    )
  const toHex = (arr, max) =>
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
    lastByteIs0x04: endsWithEndMarker,
    endsWithEndMarker,
    headHex: toHex(reassembled, 64),
    tailHex: toHex(reassembled.slice(-32), 32)
  }
}

/**
 * 延时函数
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 从计划数据生成 KML 内容
 */
function generateKmlFromPlan(planData) {
  const { raceName, raceDate, checkpoints } = planData

  let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${raceName}</name>
    <description>TRL-X Generated Plan - ${raceDate}</description>
    <Placemark>
      <name>Route</name>
      <LineString>
        <coordinates>`

  if (checkpoints && checkpoints.length > 0) {
    checkpoints.forEach((cp, index) => {
      let lat = 0
      let lon = 0
      let ele = 0

      if (cp.lat !== undefined) lat = cp.lat
      if (cp.lon !== undefined) lon = cp.lon
      if (cp.tempEle !== undefined) ele = cp.tempEle

      if (index > 0) kml += ' '
      kml += `${lon},${lat},${ele}`
    })
  }

  kml += `</coordinates>
      </LineString>
    </Placemark>`

  if (checkpoints && checkpoints.length > 0) {
    checkpoints.forEach((cp, index) => {
      let lat = 0
      let lon = 0
      let ele = 0
      let name = cp.cpNum || `CP${index}`

      if (cp.lat !== undefined) lat = cp.lat
      if (cp.lon !== undefined) lon = cp.lon
      if (cp.tempEle !== undefined) ele = cp.tempEle

      kml += `
    <Placemark>
      <name>${name}</name>
      <Point>
        <coordinates>${lon},${lat},${ele}</coordinates>
      </Point>
    </Placemark>`
    })
  }

  kml += `
  </Document>
</kml>`

  return kml
}

/**
 * 从计划数据生成 GPX 内容
 */
function generateGpxFromPlan(planData) {
  const { raceName, raceDate, checkpoints } = planData

  let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="TRL-X">
  <metadata>
    <name>${raceName}</name>
    <desc>TRL-X Generated Plan - ${raceDate}</desc>
  </metadata>
  <trk>
    <name>Route</name>
    <trkseg>`

  if (checkpoints && checkpoints.length > 0) {
    checkpoints.forEach((cp, index) => {
      let lat = 0
      let lon = 0
      let ele = 0

      if (cp.lat !== undefined) lat = cp.lat
      if (cp.lon !== undefined) lon = cp.lon
      if (cp.tempEle !== undefined) ele = cp.tempEle

      gpx += `
      <trkpt lat="${lat}" lon="${lon}">
        <ele>${ele}</ele>
      </trkpt>`
    })
  }

  gpx += `
    </trkseg>
  </trk>`

  if (checkpoints && checkpoints.length > 0) {
    checkpoints.forEach((cp, index) => {
      let lat = 0
      let lon = 0
      let ele = 0
      let name = cp.cpNum || `CP${index}`

      if (cp.lat !== undefined) lat = cp.lat
      if (cp.lon !== undefined) lon = cp.lon
      if (cp.tempEle !== undefined) ele = cp.tempEle

      gpx += `
  <wpt lat="${lat}" lon="${lon}">
    <ele>${ele}</ele>
    <name>${name}</name>
  </wpt>`
    })
  }

  gpx += `
</gpx>`

  return gpx
}

/**
 * 字符串转 UTF-8 ArrayBuffer
 * 兼容不支持 TextEncoder 的环境
 */
function stringToUtf8ArrayBuffer(str) {
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
 * 读取文件内容为 ArrayBuffer（UTF-8）
 * 使用 encoding: 'utf8' 保证各平台返回一致，再转成 UTF-8 字节
 * @param filePath 文件路径
 * @param compress 是否压缩
 * @param fileType 文件类型，'kml' 或 'gpx'
 */
function readFileAsArrayBuffer(filePath, compress = false, fileType = 'kml') {
  return new Promise((resolve, reject) => {
    const fs = wx.getFileSystemManager()
    fs.readFile({
      filePath,
      encoding: 'utf8',
      success: (res) => {
        const data = res.data
        if (typeof data === 'string') {
          const originalBuffer = stringToUtf8ArrayBuffer(data)
          console.log('Original buffer length:', originalBuffer.byteLength)
          resolve(originalBuffer)
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
 * 将 KML 的 ArrayBuffer 分包发送到 BLE 设备
 * 最后追加结束符序列 0xFF 0xFF 0xFF
 */
async function sendKmlBufferToBle(buffer, options) {
  console.log('sendKmlBufferToBle called with buffer length:', buffer.byteLength)
  const {
    deviceId,
    chunkSize = 230,
    writeDelayMs = 20,
    onProgress
  } = options

  console.log('Chunking buffer with size:', chunkSize)
  const contentChunks = chunkArrayBuffer(buffer, chunkSize)
  const endChunk = new Uint8Array(KML_END_MARKER).buffer
  const allChunks = [...contentChunks, endChunk]
  const totalBytes = buffer.byteLength + KML_END_MARKER.length
  let sentBytes = 0
  let currentChunkIndex = 0

  console.log('Total chunks to send:', allChunks.length)
  console.log('Total bytes to send:', totalBytes)

  while (currentChunkIndex < allChunks.length) {
    try {
      console.log('Finding writable characteristic for device:', deviceId)
      const characteristic = await findWritableCharacteristic(deviceId)
      console.log('Found writable characteristic:', characteristic)

      for (let i = currentChunkIndex; i < allChunks.length; i++) {

        const chunk = allChunks[i]
        console.log('Sending chunk', i + 1, 'of', allChunks.length, 'size:', chunk.byteLength)

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
          } catch (error) {
            console.warn('Error sending chunk', i + 1, ':', error)

            if (error.errMsg && error.errMsg.includes('no connection')) {
              console.warn('Connection lost, will attempt to reconnect')
              throw error
            }

            retries--
            if (retries > 0) {
              console.log('Retrying...', retries, 'attempts left')
              await delay(writeDelayMs * 2)
            } else {
              throw error
            }
          }
        }

        sentBytes += chunk.byteLength
        currentChunkIndex = i + 1

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

        if (writeDelayMs > 0 && i < allChunks.length - 1) {
          console.log('Waiting for', writeDelayMs, 'ms before sending next chunk')
          await delay(writeDelayMs)
        }
      }

      console.log('All chunks sent successfully')
      return

    } catch (error) {
      console.warn('Error during send, attempting to reconnect:', error)

      if (error.errMsg && error.errMsg.includes('no connection')) {
        console.log('Attempting to reconnect...')

        try {
          await createBLEConnection(deviceId)
          console.log('Reconnected successfully, resuming send from chunk', currentChunkIndex + 1)

          await delay(1000)
        } catch (reconnectError) {
          console.error('Failed to reconnect:', reconnectError)
          throw new Error('连接断开且重连失败，请重新手动连接设备')
        }
      } else {
        throw error
      }
    }
  }
}

module.exports = {
  BLE_CHUNK_SIZE,
  KML_END_MARKER,
  calculateCRC32,
  readFileWithCRC,
  readKmlFileWithCRC,
  chunkArrayBuffer,
  getPayloadToSend,
  verifyChunkedPayload,
  generateKmlFromPlan,
  generateGpxFromPlan,
  stringToUtf8ArrayBuffer,
  readFileAsArrayBuffer,
  sendKmlBufferToBle
}