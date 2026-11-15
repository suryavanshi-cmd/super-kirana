// Every failure names its actual cause, in English and Marathi. Never "server problem".
export class GatewayError extends Error {
  constructor(public status: number, public code: string, public en: string, public mr: string, public detail?: string) {
    super(`${code}: ${en}`);
  }
}

const kb = (b: number) => Math.round(b / 1024);
const sec = (s: number) => Math.round(s * 10) / 10;

export const E = {
  noAuth: () => new GatewayError(401, 'NO_AUTH', 'Sign-in token missing (Authorization: Bearer <token>)', 'लॉगिन टोकन मिळाले नाही. पुन्हा लॉगिन करा.'),
  badToken: (why: string) => new GatewayError(401, 'BAD_TOKEN', `Sign-in token rejected: ${why}`, 'लॉगिन टोकन चुकीचे किंवा जुने आहे. पुन्हा लॉगिन करा.', why),
  forbidden: () => new GatewayError(403, 'FORBIDDEN', 'You are not an active member of this shop', 'तुम्ही या दुकानाचे सक्रिय सदस्य नाही.'),
  shopRequired: () => new GatewayError(400, 'SHOP_REQUIRED', 'You belong to more than one shop: send shop_id', 'तुमची एकापेक्षा जास्त दुकाने आहेत: दुकान निवडा.'),
  badShopId: () => new GatewayError(400, 'BAD_SHOP_ID', 'shop_id is not a valid id', 'दुकानाचा क्रमांक चुकीचा आहे.'),
  noAudio: () => new GatewayError(400, 'NO_AUDIO', "No audio file in the request (multipart field 'audio')", 'आवाजाची फाईल मिळाली नाही.'),
  tooLarge: (bytes: number, max: number) => new GatewayError(413, 'AUDIO_TOO_LARGE', `Audio too large (${kb(bytes)} KB > ${kb(max)} KB)`, `आवाजाची फाईल खूप मोठी आहे (${kb(bytes)} KB > ${kb(max)} KB).`),
  tooLong: (s: number, max: number) => new GatewayError(413, 'AUDIO_TOO_LONG', `Audio too long (${sec(s)}s > ${max}s)`, `आवाज खूप लांब आहे (${sec(s)} सेकंद > ${max} सेकंद). एका वेळी एकच नोंद बोला.`),
  tooShort: (s: number, min: number) => new GatewayError(400, 'AUDIO_TOO_SHORT', `Audio too short (${sec(s)}s < ${min}s)`, `आवाज खूप छोटा आहे (${sec(s)} सेकंद). बटण दाबून पूर्ण वाक्य बोला.`),
  silent: (why: string) => new GatewayError(400, 'AUDIO_SILENT', `No speech found in the audio (${why})`, 'आवाजात बोलणे ऐकू आले नाही. मोबाईल तोंडाजवळ धरून पुन्हा बोला.', why),
  format: (mime: string) => new GatewayError(415, 'AUDIO_FORMAT', `Unsupported audio format (${mime || 'unknown'}); send webm/ogg opus, mp4/m4a or wav`, 'ही आवाजाची फाईल चालत नाही.'),
  rateMinute: (n: number) => new GatewayError(429, 'RATE_LIMIT_MINUTE', `Too many voice entries: ${n} per minute per shop`, `एका मिनिटात ${n} पेक्षा जास्त आवाज-नोंदी करता येत नाहीत. थोडे थांबा.`),
  rateDay: (n: number) => new GatewayError(429, 'RATE_LIMIT_DAY', `Daily voice limit reached: ${n} per shop`, `आजची ${n} आवाज-नोंदींची मर्यादा पूर्ण झाली. उद्या पुन्हा वापरा किंवा हाताने नोंद करा.`),
  context: (why: string) => new GatewayError(502, 'CONTEXT_FAILED', `Customer list load failed: ${why}`, `ग्राहकांची यादी आणता आली नाही: ${why}`, why),
  sarvamTimeout: (ms: number) => new GatewayError(504, 'SARVAM_TIMEOUT', `Sarvam timeout (${ms / 1000}s)`, `सर्वम सेवेकडून ${ms / 1000} सेकंदात उत्तर आले नाही. पुन्हा प्रयत्न करा.`),
  sarvam: (status: number, why: string) => new GatewayError(502, status === 403 ? 'SARVAM_AUTH' : status === 429 ? 'SARVAM_LIMIT' : 'SARVAM_ERROR',
    `Sarvam ${status}: ${why}`,
    status === 403 ? 'सर्वम API की स्वीकारली गेली नाही (403).' : status === 429 ? 'सर्वमची मर्यादा किंवा क्रेडिट संपले (429).' : `सर्वम सेवेत अडचण (${status}).`, why),
  notConfigured: (names: string[]) => new GatewayError(503, 'NOT_CONFIGURED', `Server setting missing: ${names.join(', ')}`, `सर्व्हरची सेटिंग नाही: ${names.join(', ')}`),
  badGatewayToken: () => new GatewayError(401, 'BAD_GATEWAY_TOKEN', 'Gateway token missing or wrong', 'गेटवे टोकन चुकीचे आहे.'),
};
