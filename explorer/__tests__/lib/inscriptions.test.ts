import { parseInscriptionInput } from '@/lib/inscriptions'

function hexEncode(str: string): string {
  return '0x' + Buffer.from(str).toString('hex')
}

test('parses a valid TIP-20 mint inscription', () => {
  const input = hexEncode('{"p":"tip-20","op":"mint","tick":"TEMP","amt":"420"}')
  expect(parseInscriptionInput(input)).toEqual({
    p: 'tip-20', op: 'mint', tick: 'TEMP', amt: '420',
  })
})

test('parses a deploy inscription', () => {
  const input = hexEncode('{"p":"tip-20","op":"deploy","tick":"TIME","max":"21000000"}')
  expect(parseInscriptionInput(input)).toMatchObject({ op: 'deploy', tick: 'TIME' })
})

test('returns null for non-JSON input', () => {
  expect(parseInscriptionInput('0xa9059cbb0000')).toBeNull()
})

test('returns null for 0x-only input', () => {
  expect(parseInscriptionInput('0x')).toBeNull()
})

test('returns null for malformed JSON hex', () => {
  expect(parseInscriptionInput('0x' + Buffer.from('not json').toString('hex'))).toBeNull()
})

test('normalizes tick to uppercase', () => {
  const input = hexEncode('{"p":"tip-20","op":"mint","tick":"temp","amt":"1"}')
  const result = parseInscriptionInput(input)
  expect(result?.tick).toBe('TEMP')
})
