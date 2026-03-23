# SeFi Contract Manifest Path

Drop one or more manifest files in:

`SeFi/contracts/manifests/*.json`

SeFi automatically loads all manifest files at startup and before each near-real-time polling cycle.

## Manifest Shape

```json
{
  "protocol": "String (required)",
  "network": "mainnet|testnet|previewnet (optional)",
  "contracts": [
    {
      "id": "Hedera contract id or EVM address (required)",
      "name": "String (required)",
      "category": "String (required)",
      "evm": "EVM address (optional)",
      "priority": "Boolean (optional)",
      "asset": "String (optional)"
    }
  ],
  "tokens": [
    {
      "id": "Hedera token id (required)",
      "name": "String (optional)",
      "symbol": "String (optional)",
      "decimals": "Integer (optional)"
    }
  ],
  "topics": [
    {
      "id": "Hedera topic id (required)",
      "name": "String (optional)"
    }
  ]
}
```

## Notes

- `network` is optional. If set, the manifest only loads when it matches `SEFI_NETWORK`.
- Duplicate contracts/tokens/topics across files are deduplicated by ID.
- SeFi defaults to `testnet` when `SEFI_NETWORK` is not provided.
