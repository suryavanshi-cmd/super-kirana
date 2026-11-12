import { describe, expect, it } from 'vitest';
import { parseVoice } from '@/lib/voice/parse';
import type { CustomerRow } from '@/lib/api';

const c = (id: string, name: string, balance = 0, mobile: string | null = null): CustomerRow => ({ id, name, mobile, is_active: true, balance_paise: balance });
const customers = [c('c1', 'सुरेश भट', 50000), c('c2', 'हॉटेल अंबरी'), c('c3', 'मीना जाधव', 12000), c('c4', 'सुरेश पाटील'), c('c5', 'Ramesh Shinde')];

describe('spoken entries', () => {
  it("the user's Marathi example: credit, ₹2,000, nothing paid", () => {
    const d = parseVoice('सुरेश भट यांनी 2,000 रुपयाचा किराणा घेतला, नो पेमेंट', customers);
    expect(d).toMatchObject({ intent: 'credit', amountPaise: 200000, paidPaise: 0, what: 'किराणा', name: 'सुरेश भट' });
    expect(d.matches[0].customer.id).toBe('c1');
    expect(d.problems).toEqual([]);
  });

  it("the user's Hinglish example: Hotel Ambari ₹250 pending", () => {
    const d = parseVoice('kab se hotel Ambari 250 rupees pending', customers);
    expect(d).toMatchObject({ intent: 'credit', amountPaise: 25000, paidPaise: 0, name: 'hotel Ambari' });
    expect(d.matches[0].customer.id).toBe('c2');                  // Latin speech finds the Marathi name
  });

  it('English speech recognised in Latin letters', () => {
    const d = parseVoice('Suresh Bhatt took 2000 rupees kirana no payment', customers);
    expect(d).toMatchObject({ intent: 'credit', amountPaise: 200000, paidPaise: 0 });
    expect(d.matches[0].customer.id).toBe('c1');
  });

  it('credit with part paid now', () => {
    expect(parseVoice('मीना जाधव यांनी 1500 चा किराणा घेतला आणि 500 दिले', customers))
      .toMatchObject({ intent: 'credit', amountPaise: 150000, paidPaise: 50000, name: 'मीना जाधव' });
    expect(parseVoice('Ramesh ne 800 ka saman liya, 300 diye', customers))
      .toMatchObject({ intent: 'credit', amountPaise: 80000, paidPaise: 30000 });
  });

  it('payments (old dues received)', () => {
    const d = parseVoice('मीना जाधव यांनी 500 रुपये जमा केले', customers);
    expect(d).toMatchObject({ intent: 'payment', amountPaise: 50000, paidPaise: null });
    expect(d.matches[0].customer.id).toBe('c3');
    expect(parseVoice('Ramesh Shinde paid 1200', customers)).toMatchObject({ intent: 'payment', amountPaise: 120000 });
    expect(parseVoice('सुरेश भट ने 300 रुपये दिए', customers)).toMatchObject({ intent: 'payment', amountPaise: 30000 });
  });

  it('numbers spoken as words', () => {
    expect(parseVoice('सुरेश भट दोन हजार उधार', customers).amountPaise).toBe(200000);
    expect(parseVoice('सुरेश भट अडीचशे रुपये बाकी', customers).amountPaise).toBe(25000);
    expect(parseVoice('सुरेश भट दीड हजार किराणा घेतला', customers).amountPaise).toBe(150000);
    expect(parseVoice('सुरेश भट साडे तीन हजार उधार', customers).amountPaise).toBe(350000);
    expect(parseVoice('सुरेश भट पाचशे पन्नास बाकी', customers).amountPaise).toBe(55000);
    expect(parseVoice('Suresh two thousand five hundred pending', customers).amountPaise).toBe(250000);
    expect(parseVoice('Suresh do hazar udhar', customers).amountPaise).toBe(200000);
    expect(parseVoice('सुरेश भट २५० बाकी', customers).amountPaise).toBe(25000);
    expect(parseVoice('Suresh 1,25,000 pending', customers).amountPaise).toBe(12500000);
  });

  it('ambiguous first names offer every likely customer', () => {
    const d = parseVoice('सुरेश 400 उधार', customers);
    expect(d.matches.map((m) => m.customer.id).slice(0, 2).sort()).toEqual(['c1', 'c4']);
  });

  it('unknown customers keep the spoken name for a new account', () => {
    const d = parseVoice('Ganesh More 650 rupees pending', customers);
    expect(d.name).toBe('Ganesh More');
    expect(d.matches).toEqual([]);
  });

  it('reports what it could not understand', () => {
    expect(parseVoice('सुरेश भट किराणा घेतला', customers).problems).toEqual(['no_amount']);
    expect(parseVoice('500 रुपये उधार', customers).problems).toEqual(['no_name']);
  });
});
