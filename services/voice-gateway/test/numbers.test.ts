import { describe, expect, it } from 'vitest';
import { evaluate, numberToken } from '../src/parser/numbers';
import { normalise } from '../src/parser/text';

const value = (s: string) => evaluate(normalise(s).split(' ').flatMap((w) => numberToken(w) ?? []));

describe('amount rules', () => {
  it.each([
    ['250', 250], ['२५०', 250], ['2,500', 2500], ['१,२००', 1200],
    ['don she pannas', 250], ['don-she pannas', 250], ['दोनशे पन्नास', 250], ['दोन शे पन्नास', 250],
    ['dide-she', 150], ['did she', 150], ['दीडशे', 150], ['दीड हजार', 1500],
    ['adich hajar', 2500], ['अडीच हजार', 2500], ['अडीचशे', 250],
    ['sava she', 125], ['sava don hajar', 2250], ['सव्वा दोन हजार', 2250], ['सव्वाशे', 125],
    ['saade teen she', 350], ['साडे तीनशे', 350], ['saade char hajar', 4500],
    ['paune paach she', 475], ['पावणे पाचशे', 475], ['paune don hajar', 1750],
    ['ek hajar', 1000], ['हजार', 1000], ['2 hajar 500', 2500], ['teen hajar paachshe', 3500], ['एक लाख', 100000],
    ['pannas', 50], ['पन्नास', 50], ['ainshi', 80], ['ऐंशी', 80], ['navvad', 90], ['नव्वद', 90], ['नव्व्याण्णव', 99],
    ['paanch sau', 500], ['do sau pachas', 250], ['dedh hazaar', 1500], ['dhai sau', 250],
    ['two hundred fifty', 250], ['one thousand', 1000], ['twenty five', 25], ['ninety nine', 99],
  ])('%s = %d', (s, n) => expect(value(s as string)).toBe(n));

  it('every Marathi number word 1–99 in Devanagari is known', async () => {
    const mod = await import('../src/parser/numbers');
    const words = ['एक', 'दोन', 'तीन', 'चार', 'पाच', 'सहा', 'सात', 'आठ', 'नऊ', 'दहा', 'अकरा', 'बारा', 'वीस', 'तीस', 'चाळीस', 'पन्नास', 'साठ', 'सत्तर', 'ऐंशी', 'नव्वद'];
    const nums = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 20, 30, 40, 50, 60, 70, 80, 90];
    words.forEach((w, i) => expect(mod.numberToken(w)?.[0]).toEqual({ kind: 'num', value: nums[i] }));
  });
  it('words that are not numbers stay unknown', () => {
    for (const w of ['ramesh', 'sakhar', 'dile', 'रमेश', 'साखर', 'ha', 'so']) expect(numberToken(w)).toBeNull();
  });
  it('Latin spellings 1–99 do not collide (Marathi, Hindi and English agree)', () => {
    const pairs: [string, number][] = [['ek', 1], ['don', 2], ['do', 2], ['teen', 3], ['tin', 3], ['char', 4], ['pach', 5], ['paanch', 5], ['saha', 6], ['saat', 7], ['aath', 8],
      ['nau', 9], ['daha', 10], ['das', 10], ['bara', 12], ['vees', 20], ['bees', 20], ['tees', 30], ['chalis', 40], ['pannas', 50], ['pachas', 50], ['saath', 60], ['sattar', 70], ['assi', 80], ['nabbe', 90]];
    for (const [w, n] of pairs) expect(numberToken(w)?.[0], w).toEqual({ kind: 'num', value: n });
  });
});
