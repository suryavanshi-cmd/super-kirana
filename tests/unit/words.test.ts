import { describe, expect, it } from 'vitest';
import { paiseInWords, rupeesInWords } from '@/lib/words';
import { sameName, skeleton, soundsLike } from '@/lib/translit';
import { matches } from '@/lib/data';

describe('amount in words', () => {
  it('Marathi, Indian grouping', () => {
    expect(rupeesInWords(0, 'mr-IN')).toBe('शून्य');
    expect(rupeesInWords(15, 'mr-IN')).toBe('पंधरा');
    expect(rupeesInWords(100, 'mr-IN')).toBe('शंभर');
    expect(rupeesInWords(150, 'mr-IN')).toBe('एकशे पन्नास');
    expect(rupeesInWords(315, 'mr-IN')).toBe('तीनशे पंधरा');
    expect(rupeesInWords(1250, 'mr-IN')).toBe('एक हजार दोनशे पन्नास');
    expect(rupeesInWords(12500, 'mr-IN')).toBe('बारा हजार पाचशे');
    expect(rupeesInWords(250000, 'mr-IN')).toBe('दोन लाख पन्नास हजार');
    expect(rupeesInWords(10000000, 'mr-IN')).toBe('एक कोटी');
    expect(paiseInWords(61500, 'mr-IN')).toBe('सहाशे पंधरा रुपये');
    expect(paiseInWords(12550, 'mr-IN')).toBe('एकशे पंचवीस रुपये पन्नास पैसे');
  });
  it('English, Indian grouping', () => {
    expect(paiseInWords(31500, 'en-IN')).toBe('Three hundred fifteen rupees');
    expect(paiseInWords(125050, 'en-IN')).toBe('One thousand two hundred fifty rupees and fifty paise');
    expect(rupeesInWords(1234567, 'en-IN')).toBe('twelve lakh thirty-four thousand five hundred sixty-seven');
    expect(rupeesInWords(99, 'en-IN')).toBe('ninety-nine');
  });
  it('covers every number 0–99 in Marathi with a distinct word', () => {
    const words = Array.from({ length: 100 }, (_, i) => rupeesInWords(i, 'mr-IN'));
    expect(new Set(words).size).toBe(100);
    expect(words.every((w) => /^[ऀ-ॿ]+$/.test(w))).toBe(true);
  });
});

describe('English letters find Marathi names', () => {
  it('builds comparable skeletons', () => {
    expect(skeleton('सुरेश पाटील')).toBe('srs ptl');
    expect(skeleton('Suresh Patil')).toBe('srs ptl');
  });
  it('matches by sound from the start of any word', () => {
    expect(soundsLike('suresh', 'सुरेश पाटील')).toBe(true);
    expect(soundsLike('sur', 'सुरेश पाटील')).toBe(true);
    expect(soundsLike('patil', 'सुरेश पाटील')).toBe(true);
    expect(soundsLike('meena', 'मीना जाधव')).toBe(true);
    expect(soundsLike('jadhav', 'मीना जाधव')).toBe(true);
    expect(soundsLike('shinde', 'अनिल शिंदे')).toBe(true);
    expect(soundsLike('ramesh', 'सुरेश पाटील')).toBe(false);
    expect(soundsLike('s', 'सुरेश')).toBe(false);                 // too short to be useful
    expect(matches('suresh', 'सुरेश पाटील', null)).toBe(true);
    expect(matches('98765 43210', 'x', '9876543210')).toBe(true);
    expect(matches('सुरे', 'सुरेश पाटील')).toBe(true);
  });
  it('spots the same person written twice', () => {
    expect(sameName('सुरेश पाटील', 'सुरेश  पाटील')).toBe(true);
    expect(sameName('Suresh Patil', 'सुरेश पाटील')).toBe(true);
    expect(sameName('सुरेश पाटील', 'सुरेश जाधव')).toBe(false);
  });
});
