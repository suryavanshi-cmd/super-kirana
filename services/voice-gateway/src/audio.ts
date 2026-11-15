// Checks a clip BEFORE paying Sarvam for it: format, real duration from the container, and silence.
// No decoding libraries: durations come from container headers (Ogg granule, WebM block timecodes,
// MP4 mvhd, WAV header); silence from WAV energy or, for compressed audio, the bit-rate
// (Opus/AAC encoders spend almost no bytes on silence).
import { config } from './config';
import { E } from './errors';

export type Format = 'webm' | 'ogg' | 'mp4' | 'wav';
export interface AudioInfo { format: Format; mime: string; bytes: number; seconds: number | null; kbps: number | null }

export function sniff(buf: Buffer): Format | null {
  if (buf.length < 12) return null;
  if (buf.readUInt32BE(0) === 0x1a45dfa3) return 'webm';
  if (buf.toString('ascii', 0, 4) === 'OggS') return 'ogg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') return 'wav';
  if (buf.toString('ascii', 4, 8) === 'ftyp') return 'mp4';
  return null;
}
const MIME: Record<Format, string> = { webm: 'audio/webm', ogg: 'audio/ogg', mp4: 'audio/mp4', wav: 'audio/wav' };

function oggSeconds(buf: Buffer): number | null {
  const last = buf.lastIndexOf('OggS');
  if (last < 0 || last + 14 > buf.length) return null;
  const granule = Number(buf.readBigUInt64LE(last + 6));
  // Opus always counts at 48 kHz; Vorbis would need the header rate (rare from browsers).
  return granule > 0 && granule < 48000 * 3600 ? granule / 48000 : null;
}

function readVint(buf: Buffer, pos: number): { len: number; value: number } | null {
  const first = buf[pos];
  if (first === undefined || first === 0) return null;
  let len = 1, mask = 0x80;
  while (!(first & mask) && len < 8) { len++; mask >>= 1; }
  let value = first & (mask - 1);
  for (let i = 1; i < len; i++) value = value * 256 + (buf[pos + i] ?? 0);
  return { len, value };
}

/** WebM from MediaRecorder has no Duration header: use last Cluster timecode + largest block offset. */
function webmSeconds(buf: Buffer): number | null {
  let lastCluster = -1, clusterTime = 0, maxRel = 0, scale = 1_000_000; // ns per tick
  const ts = buf.indexOf(Buffer.from([0x2a, 0xd7, 0xb1]));             // TimecodeScale
  if (ts > 0) { const size = readVint(buf, ts + 3); if (size && size.value <= 8) scale = buf.readUIntBE(ts + 3 + size.len, size.value); }
  for (let p = buf.indexOf(Buffer.from([0x1f, 0x43, 0xb6, 0x75])); p >= 0; p = buf.indexOf(Buffer.from([0x1f, 0x43, 0xb6, 0x75]), p + 4)) lastCluster = p;
  if (lastCluster < 0) return null;
  const tc = buf.indexOf(0xe7, lastCluster + 4);
  if (tc < 0 || tc > lastCluster + 16) return null;
  const tsize = readVint(buf, tc + 1);
  if (!tsize || tsize.value > 8) return null;
  clusterTime = buf.readUIntBE(tc + 1 + tsize.len, tsize.value);
  // SimpleBlocks (0xA3) after the last cluster: [size][track vint][int16 relative time]
  for (let p = buf.indexOf(0xa3, tc); p >= 0 && p < buf.length - 6; p = buf.indexOf(0xa3, p + 1)) {
    const size = readVint(buf, p + 1);
    if (!size) continue;
    const track = readVint(buf, p + 1 + size.len);
    if (!track || track.value !== 1) continue;
    const at = p + 1 + size.len + track.len;
    if (at + 2 > buf.length) break;
    const rel = buf.readInt16BE(at);
    if (rel >= 0 && rel < 32000) maxRel = Math.max(maxRel, rel);
  }
  const seconds = ((clusterTime + maxRel) * scale) / 1e9 + 0.02;
  return seconds > 0 && seconds < 3600 ? seconds : null;
}

function mp4Seconds(buf: Buffer): number | null {
  const p = buf.indexOf('mvhd');
  if (p < 0 || p + 24 > buf.length) return null;
  const version = buf[p + 4];
  const scale = version === 1 ? buf.readUInt32BE(p + 24) : buf.readUInt32BE(p + 16);
  const dur = version === 1 ? Number(buf.readBigUInt64BE(p + 28)) : buf.readUInt32BE(p + 20);
  return scale > 0 && dur > 0 ? dur / scale : null;
}

function wavInfo(buf: Buffer): { seconds: number; rms: number } | null {
  const fmt = buf.indexOf('fmt ');
  const data = buf.indexOf('data');
  if (fmt < 0 || data < 0) return null;
  const channels = buf.readUInt16LE(fmt + 10), rate = buf.readUInt32LE(fmt + 12), bits = buf.readUInt16LE(fmt + 22);
  const start = data + 8, len = Math.min(buf.readUInt32LE(data + 4), buf.length - start);
  if (!rate || !channels || bits !== 16) return { seconds: len / Math.max(1, rate * channels * (bits / 8)), rms: 1 };
  let sum = 0, n = 0;
  for (let i = start; i + 1 < start + len; i += 2 * channels) { const s = buf.readInt16LE(i) / 32768; sum += s * s; n++; }
  return { seconds: n / rate, rms: n ? Math.sqrt(sum / n) : 0 };
}

/** Throws a clear error for anything we should not send to Sarvam. */
export function inspect(buf: Buffer, declaredMime = ''): AudioInfo {
  if (buf.length > config.maxAudioBytes) throw E.tooLarge(buf.length, config.maxAudioBytes);
  const format = sniff(buf);
  if (!format) throw E.format(declaredMime);
  let seconds: number | null = null, rms: number | null = null;
  if (format === 'ogg') seconds = oggSeconds(buf);
  else if (format === 'webm') seconds = webmSeconds(buf);
  else if (format === 'mp4') seconds = mp4Seconds(buf);
  else { const w = wavInfo(buf); seconds = w?.seconds ?? null; rms = w?.rms ?? null; }
  if (seconds !== null) {
    if (seconds > config.maxAudioSeconds + 0.3) throw E.tooLong(seconds, config.maxAudioSeconds);
    if (seconds < config.minAudioSeconds) throw E.tooShort(seconds, config.minAudioSeconds);
  }
  const kbps = seconds ? (buf.length * 8) / 1000 / seconds : null;
  if (rms !== null && rms < 0.003) throw E.silent(`level ${rms.toFixed(4)}`);
  // Opus/AAC spend almost nothing on silence: a 4 s silent WebM is ~4.7 kbps incl. container, speech is 12+ kbps.
  if (format !== 'wav' && kbps !== null && seconds !== null && seconds >= 1 && kbps < 6) throw E.silent(`${kbps.toFixed(1)} kbps`);
  return { format, mime: MIME[format], bytes: buf.length, seconds: seconds === null ? null : Math.round(seconds * 100) / 100, kbps: kbps === null ? null : Math.round(kbps * 10) / 10 };
}
