// First Sarvam AI call: one chat completion. Run with: node --env-file=.env sarvam-chat.mjs
import { SarvamAIClient } from 'sarvamai';

const apiSubscriptionKey = process.env.SARVAM_API_KEY;
if (!apiSubscriptionKey) {
  console.error('SARVAM_API_KEY is not set. Add it to .env first.');
  process.exit(1);
}

const client = new SarvamAIClient({ apiSubscriptionKey });
const response = await client.chat.completions({
  model: 'sarvam-105b-conversations',
  messages: [{ role: 'user', content: 'नमस्कार! एका वाक्यात स्वतःची ओळख करून द्या.' }],
});
console.log(response.choices[0]?.message?.content);
