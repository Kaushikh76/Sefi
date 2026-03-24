export const EVENT_SIGNATURES = {
  Transfer: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
  Approval: '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',
  Deposit: '0xde6857219544bb5b7746f48ed30be6386fefc61b2f864cacf559893bf50fd951',
  Withdraw: '0x3115d1449a7b732c986cba18244e897a450f61e1bb8d589cd2e69e6c8924f9f7',
  Borrow: '0xc6a898309e823ee50bac64e45ca8adba6690e99e7841c45d754e2a38e9019d9b',
  Repay: '0x4cdde6e09bb755c9a5589ebaec640bbfedff1362d4b255ebf8339782b9942faa',
  Initialize: '0x98636036cb66a9c19a37435efc1e90142190214e8abeb821bdba3f2990dd4c95',
  Mint: '0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde',
  Burn: '0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c',
  Collect: '0x70935338e69775456a85ddef226c395fb668b63fa0115f5f20610b388e6ca9c0',
  Swap: '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67',
  Flash: '0xbdbdb71d7860376ba52b25a5028beea23581364a40522f6bcfb86bb1f2dca633',
  IncreaseObservationCardinalityNext: '0xac49e518f90a358f652e4400164f05a5d8f7e35e7747279bc3a93dbf584e125a',
  SetFeeProtocol: '0x973d8d92bb299f4af6ce49b52a8adb85ae46b9f214c4c4fc06ac77401237b133',
  CollectProtocol: '0x596b573906218d3411850b26a6b437d6c4522fdb43d2d2386263f86d50b8b151',
  'Transfer(address,address,uint256,address)': '0x5f2147fb558c977441fbdfebcf8cd5776606adc8da5ff95566fc2a4137e54d13',
};

const SIGNATURE_TO_NAME = Object.fromEntries(
  Object.entries(EVENT_SIGNATURES).map(([name, signature]) => [signature.toLowerCase(), name])
);

function normalizeTopic0(topic0) {
  if (topic0 === undefined || topic0 === null) return '';
  return String(topic0).trim().toLowerCase();
}

export function getEventName(topic0) {
  const normalizedTopic0 = normalizeTopic0(topic0);
  if (!normalizedTopic0) return 'NoTopic0';
  return SIGNATURE_TO_NAME[normalizedTopic0] || `Topic0:${normalizedTopic0}`;
}

export function decodeErc20Transfer(log) {
  const topic0 = log.topics?.[0]?.toLowerCase();
  if (topic0 !== EVENT_SIGNATURES.Transfer.toLowerCase()) {
    return null;
  }

  try {
    const fromAddress = `0x${log.topics?.[1]?.slice(-40) || ''.padStart(40, '0')}`;
    const toAddress = `0x${log.topics?.[2]?.slice(-40) || ''.padStart(40, '0')}`;
    const amount = log.data ? BigInt(log.data).toString() : '0';

    return {
      fromAddress,
      toAddress,
      amount,
    };
  } catch {
    return null;
  }
}
