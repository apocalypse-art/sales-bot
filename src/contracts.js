/**
 * Registry of monitored contracts.
 *
 * Keys   — lowercased contract addresses
 * Values — { name, onChainName, type }
 *   name        — Manifold Studio display name
 *   onChainName — ERC-721/1155 name() return value
 *   type        — '721' or '1155'
 *
 * The bot will ignore webhook events from contracts not listed here.
 *
 * Generated from "Contract names 2026.csv" — do not edit by hand.
 * Re-generate with:  node scripts/populate-contracts.js
 */

const CONTRACTS = {
  // ── ETH Mainnet ────────────────────────────────────────────────────────────
  '0x8fb9051d464ef8fed7832e05bacc675699a84401': { name: 'The Oversoul', onChainName: 'INFLUX3', type: '721' },
  '0xfda5e0fc9a6b26c2b6e62b779311bd20072eb5b0': { name: 'Art Cards', onChainName: 'XIOIX', type: '1155' },
  '0x5e3cf684507ec9c8eaca551903b8922a6cee3a4e': { name: 'Mages', onChainName: 'Mages', type: '721' },
  '0x9133cd9edebb8198fdfc8e3f4c590834225c4d52': { name: 'OIXXXIO', onChainName: 'OIXXXIO', type: '721' },
  '0x51e1517cd2e7017bdffbfd80aeca93e1b67b86fa': { name: 'OXXXO', onChainName: 'OXXXO', type: '721' },
  '0x9c89597b11e893bcd47e574b633dc09ae66a8efe': { name: 'IXXXI', onChainName: 'IXXXI', type: '721' },
  '0xe367723885ac164506274e098190a3b291be1e29': { name: 'Archai', onChainName: 'Archai', type: '721' },
  '0xace9a28464c105b7ce96d6f1a79d1ef2de0fc064': { name: 'Monsters in a Landscape', onChainName: 'Monsters in a Landscape', type: '721' },
  '0x486f86728ba157cbd21f71cee7ff895e2892f9d6': { name: 'The Origins', onChainName: 'InFlux', type: '721' },
  '0xceaeeb3f6984c970d5354a23d59e70ac3aa2b720': { name: 'InSights', onChainName: 'Apocalypse Art - InSights', type: '721' },
  '0x2318954d3add6175545d482bd648093740201805': { name: 'SR Meeings', onChainName: 'Apocalypse Art - SuperRare Meeings', type: '721' },
  '0x8415d610f19641d97c088b532663cdca3dc58826': { name: 'Editions', onChainName: '', type: '1155' },
  '0x4802bd775674f0638e850e6ab00d79e3341107d0': { name: 'Meeings', onChainName: 'Apocalypse Art - Meeings', type: '721' },
  '0xd60e8125558a4022e7fd0a2a456f27a3b8b6fd07': { name: 'Apocalypse Art', onChainName: 'Apocalypse Art', type: '721' },

  // ── Shape ──────────────────────────────────────────────────────────────────
  '0xdc77d7a6bae09fe36d23d27d8dfd7f930e7b981e': { name: 'The Ordeal', onChainName: 'Influx2', type: '721' },
};

module.exports = CONTRACTS;
