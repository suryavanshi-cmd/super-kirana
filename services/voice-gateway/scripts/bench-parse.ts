// Parser speed: p50/p95 over all fixture transcripts with a 2,000-customer shop.  npm run bench:parse
import data from '../test/fixtures/transcripts.json' with { type: 'json' };
import { indexCustomers } from '../src/parser/match';
import { indexItems, parse } from '../src/parser/parse';

const customers = indexCustomers([...data.customers, ...Array.from({ length: 2000 }, (_, i) => ({ id: `x${i}`, name: `Customer ${i} ${['Patil', 'More', 'Jadhav', 'Shinde', 'कुलकर्णी'][i % 5]}` }))]);
const items = indexItems(data.shop_items);
const times: number[] = [];
for (let round = 0; round < 5; round++) for (const c of data.cases) { const t = performance.now(); parse(c.text, customers, items); times.push(performance.now() - t); }
times.sort((a, b) => a - b);
const q = (p: number) => times[Math.min(times.length - 1, Math.floor(p * times.length))].toFixed(2);
console.log(`parse: ${times.length} runs, 2,000+ customers → p50 ${q(0.5)} ms, p95 ${q(0.95)} ms, max ${q(1)} ms`);
