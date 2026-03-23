import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeErc20Transfer, getEventName } from '../src/events.js';

test('getEventName decodes concentrated liquidity pool events', () => {
  assert.equal(
    getEventName('0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67'),
    'Swap'
  );
  assert.equal(
    getEventName('0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde'),
    'Mint'
  );
  assert.equal(
    getEventName('0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c'),
    'Burn'
  );
  assert.equal(
    getEventName('0x70935338e69775456a85ddef226c395fb668b63fa0115f5f20610b388e6ca9c0'),
    'Collect'
  );
  assert.equal(
    getEventName('0xac49e518f90a358f652e4400164f05a5d8f7e35e7747279bc3a93dbf584e125a'),
    'IncreaseObservationCardinalityNext'
  );
  assert.equal(
    getEventName('0x973d8d92bb299f4af6ce49b52a8adb85ae46b9f214c4c4fc06ac77401237b133'),
    'SetFeeProtocol'
  );
  assert.equal(
    getEventName('0x596b573906218d3411850b26a6b437d6c4522fdb43d2d2386263f86d50b8b151'),
    'CollectProtocol'
  );
  assert.equal(
    getEventName('0x5f2147fb558c977441fbdfebcf8cd5776606adc8da5ff95566fc2a4137e54d13'),
    'Transfer(address,address,uint256,address)'
  );
});

test('getEventName is case-insensitive and uses deterministic non-guessing fallback labels', () => {
  assert.equal(
    getEventName('0xC42079F94A6350D7E6235F29174924F928CC2AC818EB64FED8004E115FBCCA67'),
    'Swap'
  );
  assert.equal(getEventName('0x1234'), 'Topic0:0x1234');
  assert.equal(getEventName(null), 'NoTopic0');
  assert.equal(getEventName('   '), 'NoTopic0');
});

test('decodeErc20Transfer still decodes standard transfer logs', () => {
  const decoded = decodeErc20Transfer({
    topics: [
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
      '0x0000000000000000000000001111111111111111111111111111111111111111',
      '0x0000000000000000000000002222222222222222222222222222222222222222',
    ],
    data: '0x2a',
  });

  assert.deepEqual(decoded, {
    fromAddress: '0x1111111111111111111111111111111111111111',
    toAddress: '0x2222222222222222222222222222222222222222',
    amount: '42',
  });
});
