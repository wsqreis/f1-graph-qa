import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalize, sameAnswer } from '../eval/compare.ts';

describe('sameAnswer', () => {
  it('ignores column names, column order and extra columns', () => {
    assert.ok(sameAnswer([{ driver: 'Ayrton Senna', wins: 6 }], [{ wins: 6, name: 'Ayrton Senna', team: 'McLaren' }]));
  });

  it('accepts the answer inside a short top-N list', () => {
    const top5 = ['Ayrton Senna', 'Graham Hill', 'Michael Schumacher', 'Alain Prost', 'Lewis Hamilton'].map((d, i) => ({
      d,
      w: 6 - i,
    }));
    assert.ok(sameAnswer([{ driver: 'Ayrton Senna', wins: 6 }], top5));
  });

  it('rejects wrong values and over-long results', () => {
    assert.ok(!sameAnswer([{ titles: 8 }], [{ titles: 9 }]));
    const many = Array.from({ length: 30 }, (_, i) => ({ n: i }));
    assert.ok(!sameAnswer([{ n: 1 }], many));
  });

  it('needs every reference row, each matched once', () => {
    const teams = [{ team: 'Renault' }, { team: 'McLaren' }];
    assert.ok(sameAnswer(teams, [{ t: 'McLaren' }, { t: 'Renault' }]));
    assert.ok(!sameAnswer(teams, [{ t: 'McLaren' }]));
    assert.ok(!sameAnswer([{ team: 'McLaren' }, { team: 'McLaren' }], [{ t: 'McLaren' }]));
  });

  it('expects nothing when the reference is empty', () => {
    assert.ok(sameAnswer([], []));
    assert.ok(!sameAnswer([], [{ x: 1 }]));
  });

  it('normalises numbers, accents, case and list order', () => {
    assert.equal(normalize(423.0), normalize('423'));
    assert.equal(normalize('Kimi Räikkönen'), normalize('kimi raikkonen'));
    assert.equal(normalize([2014, 2008]), normalize([2008, 2014]));
  });
});
