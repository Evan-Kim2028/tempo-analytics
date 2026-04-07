import {
  lookupSelector, lookupEvent, classifyTx,
  KNOWN_SELECTORS, KNOWN_EVENTS,
} from '@/lib/signatures'

test('lookupSelector: known ERC-20 transfer', () => {
  expect(lookupSelector('0xa9059cbb')).toBe('transfer(address,uint256)')
})

test('lookupSelector: known ERC-20 approve', () => {
  expect(lookupSelector('0x095ea7b3')).toBe('approve(address,uint256)')
})

test('lookupSelector: Tempo protocol block record', () => {
  expect(lookupSelector('0xc0000000')).toBe('[Tempo] protocol block record')
})

test('lookupSelector: case-insensitive', () => {
  expect(lookupSelector('0xA9059CBB')).toBe('transfer(address,uint256)')
})

test('lookupSelector: returns undefined for unknown', () => {
  expect(lookupSelector('0xdeadbeef')).toBeUndefined()
})

test('lookupEvent: ERC-20 Transfer', () => {
  expect(lookupEvent('0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'))
    .toBe('Transfer(address,address,uint256)')
})

test('lookupEvent: Uniswap V2 Swap', () => {
  expect(lookupEvent('0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822'))
    .toBe('Swap(address,uint256,uint256,uint256,uint256,address)')
})

test('lookupEvent: returns undefined for unknown', () => {
  expect(lookupEvent('0x' + 'aa'.repeat(32))).toBeUndefined()
})

test('classifyTx: protocol tx (to=0x0000)', () => {
  expect(classifyTx('0x0000000000000000000000000000000000000000', '0xc0000000deadbeef'))
    .toBe('protocol')
})

test('classifyTx: inscription (JSON input)', () => {
  const jsonHex = '0x' + Buffer.from('{"p":"tip-20","op":"mint"}').toString('hex')
  expect(classifyTx('0x0000000000000000000000000000000000000000', jsonHex))
    .toBe('inscription')
})

test('classifyTx: user tx', () => {
  expect(classifyTx('0x20c0000000000000000000000000000000000000', '0xa9059cbb0000'))
    .toBe('user')
})

test('classifyTx: contract deploy (to=null)', () => {
  expect(classifyTx(null, '0x6080604052')).toBe('deploy')
})
