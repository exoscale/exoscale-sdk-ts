// Naming helpers: deterministic kebab-case -> lowerCamelCase / PascalCase
// conversion, with an acronym table so e.g. "ssh-key" becomes SSHKey rather
// than SshKey. Also renders OpenAPI descriptions to JSDoc comment blocks.

import type { JSON } from './model.js'

// Common standard acronyms.
const STANDARD_ACRONYMS = new Set([
  'AA',
  'AAL',
  'AB',
  'ABC',
  'AC',
  'ACK',
  'ACP',
  'AD',
  'ADF',
  'ADSL',
  'AE',
  'AF',
  'AG',
  'AI',
  'AL',
  'AM',
  'AN',
  'ANS',
  'ANSI',
  'AO',
  'AP',
  'APC',
  'API',
  'APU',
  'AR',
  'ARM',
  'ARO',
  'ARP',
  'AS',
  'ASCII',
  'ASI',
  'ASM',
  'ASP',
  'ASS',
  'AT',
  'ATA',
  'ATM',
  'ATX',
  'AU',
  'AV',
  'AW',
  'BA',
  'BB',
  'BC',
  'BCC',
  'BE',
  'BF',
  'BG',
  'BIOS',
  'BJ',
  'BM',
  'BN',
  'BO',
  'BP',
  'BR',
  'BRI',
  'BS',
  'CA',
  'CAD',
  'CBR',
  'CC',
  'CD',
  'CE',
  'CF',
  'CG',
  'CGI',
  'CH',
  'CI',
  'CID',
  'CJ',
  'CL',
  'CM',
  'CMS',
  'CMYK',
  'CN',
  'CO',
  'CP',
  'CPA',
  'CPU',
  'CR',
  'CRC',
  'CRL',
  'CS',
  'CSR',
  'CSS',
  'CT',
  'CTA',
  'CTR',
  'CU',
  'CV',
  'DA',
  'DAC',
  'DB',
  'DBC',
  'DC',
  'DCC',
  'DCE',
  'DD',
  'DE',
  'DF',
  'DG',
  'DH',
  'DHCP',
  'DI',
  'DL',
  'DLL',
  'DLN',
  'DM',
  'DMA',
  'DN',
  'DNS',
  'DO',
  'DP',
  'DPG',
  'DR',
  'DS',
  'DSD',
  'DSSS',
  'DT',
  'DTE',
  'DV',
  'EA',
  'EBM',
  'EC',
  'ECM',
  'ED',
  'EDI',
  'EF',
  'EG',
  'EIA',
  'EIDE',
  'EL',
  'EM',
  'EO',
  'EOM',
  'EOT',
  'ER',
  'ES',
  'ESF',
  'ET',
  'EU',
  'EUP',
  'EX',
  'FA',
  'FAQ',
  'FC',
  'FD',
  'FDDI',
  'FDM',
  'FE',
  'FH',
  'FIFO',
  'FIP',
  'FLA',
  'FM',
  'FP',
  'FPG',
  'FR',
  'FS',
  'FT',
  'FTP',
  'FU',
  'FW',
  'FX',
  'FY',
  'GC',
  'GD',
  'GI',
  'GIF',
  'GIM',
  'GM',
  'GN',
  'GOS',
  'GP',
  'GS',
  'GT',
  'GU',
  'GUI',
  'GW',
  'HA',
  'HB',
  'HC',
  'HD',
  'HDTV',
  'HDV',
  'HF',
  'HH',
  'HI',
  'HM',
  'HP',
  'HPF',
  'HS',
  'HSF',
  'HT',
  'HTML',
  'HTTP',
  'HV',
  'IB',
  'IC',
  'ICF',
  'ICM',
  'ICMP',
  'ID',
  'IDE',
  'IDS',
  'IE',
  'IEEE',
  'IF',
  'IGP',
  'IGR',
  'IH',
  'II',
  'IIO',
  'IM',
  'IP',
  'IPS',
  'IPT',
  'IPX',
  'IR',
  'IS',
  'ISA',
  'ISDN',
  'ISO',
  'ISP',
  'ISU',
  'IT',
  'ITU',
  'IVC',
  'IVR',
  'JA',
  'JC',
  'JD',
  'JE',
  'JF',
  'JI',
  'JM',
  'JN',
  'JR',
  'JRE',
  'JS',
  'JSON',
  'JSP',
  'JTA',
  'JU',
  'JV',
  'KD',
  'KR',
  'KV',
  'LA',
  'LAN',
  'LB',
  'LC',
  'LCD',
  'LE',
  'LF',
  'LG',
  'LI',
  'LLC',
  'LO',
  'LP',
  'LS',
  'LSB',
  'LT',
  'LTE',
  'LU',
  'LV',
  'LZ',
  'MA',
  'MAC',
  'MB',
  'MC',
  'MCA',
  'MCP',
  'MCS',
  'MCT',
  'MD',
  'MDI',
  'MF',
  'MI',
  'MIC',
  'MIPS',
  'MIS',
  'MM',
  'MMF',
  'MN',
  'MO',
  'MP',
  'MPA',
  'MPEG',
  'MS',
  'MSB',
  'MT',
  'MTB',
  'MTU',
  'MU',
  'MV',
  'MW',
  'MX',
  'NA',
  'NAC',
  'NC',
  'ND',
  'NE',
  'NF',
  'NG',
  'NI',
  'NIC',
  'NL',
  'NM',
  'NMS',
  'NNI',
  'NNT',
  'NO',
  'NP',
  'NS',
  'NSP',
  'NT',
  'NTF',
  'NTFS',
  'NV',
  'OA',
  'OCR',
  'ODB',
  'OE',
  'OH',
  'OI',
  'OID',
  'OL',
  'OLE',
  'OM',
  'OO',
  'OR',
  'OS',
  'OSD',
  'OSP',
  'OSPF',
  'OST',
  'OU',
  'PA',
  'PB',
  'PC',
  'PCN',
  'PCR',
  'PCS',
  'PD',
  'PDC',
  'PDN',
  'PDU',
  'PF',
  'PG',
  'PH',
  'PI',
  'PID',
  'PIM',
  'PK',
  'PL',
  'PM',
  'PN',
  'PNG',
  'PO',
  'POI',
  'PON',
  'PP',
  'PPC',
  'PPI',
  'PPP',
  'PS',
  'PT',
  'PU',
  'PV',
  'PX',
  'QA',
  'QAF',
  'QBE',
  'QD',
  'QF',
  'RA',
  'RAI',
  'RC',
  'RD',
  'RDO',
  'RF',
  'RG',
  'RGB',
  'RH',
  'RI',
  'RIS',
  'RISC',
  'RJ',
  'RJE',
  'RL',
  'RM',
  'RO',
  'ROM',
  'RP',
  'RPC',
  'RQ',
  'RR',
  'RS',
  'RSS',
  'RT',
  'SA',
  'SAN',
  'SB',
  'SC',
  'SCP',
  'SCSI',
  'SCT',
  'SD',
  'SDLC',
  'SDU',
  'SE',
  'SF',
  'SG',
  'SH',
  'SI',
  'SIG',
  'SIP',
  'SIS',
  'SL',
  'SLE',
  'SLI',
  'SM',
  'SMF',
  'SMT',
  'SMTP',
  'SN',
  'SNI',
  'SNMP',
  'SNT',
  'SO',
  'SOA',
  'SOH',
  'SP',
  'SPM',
  'SQ',
  'SQL',
  'SS',
  'SSL',
  'SU',
  'SUS',
  'SV',
  'SVG',
  'SW',
  'TA',
  'TAS',
  'TC',
  'TCP',
  'TDM',
  'TE',
  'TF',
  'TFT',
  'TL',
  'TN',
  'TP',
  'TR',
  'TS',
  'TT',
  'TU',
  'UA',
  'UAA',
  'UC',
  'UD',
  'UDD',
  'UDM',
  'UDP',
  'UEF',
  'UH',
  'UL',
  'UM',
  'UMP',
  'UN',
  'UNC',
  'UP',
  'UR',
  'URI',
  'URL',
  'US',
  'USB',
  'UT',
  'UTF',
  'UU',
  'UV',
  'VA',
  'VB',
  'VC',
  'VCI',
  'VF',
  'VFAT',
  'VG',
  'VH',
  'VL',
  'VLB',
  'VLE',
  'VN',
  'VO',
  'VP',
  'VPI',
  'VPN',
  'VRM',
  'VT',
  'WA',
  'WAF',
  'WAN',
  'WAS',
  'WC',
  'WD',
  'WE',
  'WF',
  'WM',
  'WO',
  'WOR',
  'WP',
  'WPA',
  'WSD',
  'WW',
  'WWA',
  'WWW',
  'WZ',
  'XA',
  'XD',
  'XHTM',
  'XM',
  'XML',
  'XMM',
  'XMP',
  'XN',
  'XP',
  'XS',
  'XT',
  'XU',
  'XVG',
  'YAA',
  'ZC',
  'ZI',
  'ZIF',
  'ZM',
  'ZO',
  'ZOP',
  'ZP',
])

// Exoscale-specific acronyms.
const CUSTOM_ACRONYMS: Record<string, string> = {
  ssh: 'SSH',
  ai: 'AI',
  iam: 'IAM',
  sks: 'SKS',
  sos: 'SOS',
  dbaas: 'DBAAS',
  ppapi: 'PPAPI',
}

// RenderReference renders an OpenAPI reference path to its PascalCase type name.
// e.g. "#/components/schemas/instance-pool-ref" -> "InstancePoolRef"
export function renderReference(referencePath: string): string {
  const base = referencePath.split('/').pop() ?? ''
  return toCamel(base)
}

export function toLowerCamel(s: string): string {
  return toInitialCamel(s, true)
}

export function toCamel(s: string): string {
  return toInitialCamel(s, false)
}

const SEPARATORS = /[-_./+\s]+/
const TRIM_SEPARATORS = /^[-_./+\s]+|[-_./+\s]+$/

function toInitialCamel(s: string, lower: boolean): string {
  if (s === '') return ''

  const trimmed = s.replace(TRIM_SEPARATORS, '')
  const words = trimmed.split(SEPARATORS).filter((w) => w !== '')

  for (let i = 0; i < words.length; i++) {
    let w = words[i]
    if (w === '') continue

    if (STANDARD_ACRONYMS.has(w.toUpperCase())) {
      w = w.toUpperCase()
    }

    const custom = CUSTOM_ACRONYMS[w]
    if (custom !== undefined) {
      w = custom
    }

    if (i === 0 && lower) {
      words[i] = w.toLowerCase()
      continue
    }

    // Uppercase only the first byte, preserving the rest of the word.
    const first = w.charCodeAt(0)
    const isLow = first >= 0x61 && first <= 0x7a
    if (isLow) {
      w = String.fromCharCode(first - 0x20) + w.slice(1)
    }
    words[i] = w
  }

  return words.join('')
}

// docLines normalizes an OpenAPI description into JSDoc comment lines,
// preserving blank lines and indentation so markdown (headings, lists, code
// fences) renders correctly in TypeDoc. `*/` is escaped so a description can
// never terminate the comment. Leading/trailing blank lines are dropped.
export function docLines(doc: string | undefined): string[] {
  if (!doc || doc === 'null') return []

  const lines = doc.split('\n').map((l) => l.replace(/\*\//g, '*\\/').replace(/[ \t\r]+$/, ''))

  let start = 0
  let end = lines.length
  while (start < end && lines[start].trim() === '') start++
  while (end > start && lines[end - 1].trim() === '') end--
  return lines.slice(start, end)
}

// renderDocBlock renders a JSDoc comment block from groups of lines. Groups
// are separated by a blank line (e.g. description, constraints, tags); empty
// groups are skipped. Returns '' when there is nothing to render.
export function renderDocBlock(groups: Array<string[]>): string {
  const lines: string[] = []
  for (const group of groups) {
    if (group.length === 0) continue
    if (lines.length > 0) lines.push('')
    lines.push(...group)
  }
  if (lines.length === 0) return ''
  return ['/**', ...lines.map((l) => (l === '' ? ' *' : ` * ${l}`)), ' */'].join('\n')
}

// renderDoc returns a JSDoc comment block from an OpenAPI description.
export function renderDoc(doc: string | undefined): string {
  return renderDocBlock([docLines(doc)])
}

// numBound renders one numeric bound as "Min 0", "Min >0" or "Max <100".
// OpenAPI 3.0 encodes exclusivity as a boolean next to the bound; 3.1 encodes
// it as the bound itself. Both are handled.
function numBound(value: any, exclusive: any, label: 'Min' | 'Max'): string {
  const op = label === 'Min' ? '>' : '<'
  if (value !== undefined && value !== null) {
    return exclusive === true ? `${label} ${op}${value}` : `${label} ${value}`
  }
  if (typeof exclusive === 'number') {
    return `${label} ${op}${exclusive}`
  }
  return ''
}

// constraintLine renders a schema's constraints as one compact line, e.g.
// "Min 0, Max 65535, Length 3-63, Read-only". Returns '' when there are none.
function constraintLine(schema: JSON): string {
  const parts: string[] = []

  const min = numBound(schema.minimum, schema.exclusiveMinimum, 'Min')
  const max = numBound(schema.maximum, schema.exclusiveMaximum, 'Max')
  if (min) parts.push(min)
  if (max) parts.push(max)

  if (schema.minLength != null && schema.maxLength != null) {
    parts.push(`Length ${schema.minLength}-${schema.maxLength}`)
  } else if (schema.minLength != null) {
    parts.push(`Min length ${schema.minLength}`)
  } else if (schema.maxLength != null) {
    parts.push(`Max length ${schema.maxLength}`)
  }

  if (typeof schema.pattern === 'string' && schema.pattern !== '') {
    parts.push(`Pattern \`${schema.pattern}\``)
  }
  if (schema.maxItems != null) parts.push(`Max items ${schema.maxItems}`)
  if (schema.uniqueItems === true) parts.push('Unique items')
  if (schema.readOnly === true) parts.push('Read-only')

  return parts.join(', ')
}

// stableStringify renders a JSON value with object keys sorted recursively,
// so rendered defaults and examples do not depend on the spec's key ordering.
// Array order is content and is preserved.
function stableStringify(value: any): string {
  if (value !== null && typeof value === 'object') {
    if (Array.isArray(value)) {
      return `[${value.map(stableStringify).join(',')}]`
    }
    const entries = Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

// schemaTags renders the JSDoc block tags for a schema's default, example and
// deprecation status. Returns an empty list when there is nothing to tag.
function schemaTags(schema: JSON): string[] {
  const tags: string[] = []
  if (schema.deprecated === true) tags.push('@deprecated')
  if (schema.default !== undefined && schema.default !== null) {
    tags.push(`@defaultValue ${stableStringify(schema.default)}`)
  }
  if (schema.example !== undefined && schema.example !== null) {
    tags.push(`@example ${stableStringify(schema.example)}`)
  }
  return tags
}

// schemaDoc renders the full JSDoc block for a schema: its description, a
// compact constraint line, and @deprecated/@defaultValue/@example tags. For a
// $ref schema only the description is rendered, since siblings of a $ref are
// ignored by the OpenAPI 3.0 spec.
export function schemaDoc(schema: JSON, description: string | undefined): string {
  const remarks = docLines(description)
  if (schema.$ref !== undefined) return renderDocBlock([remarks])
  const line = constraintLine(schema)
  return renderDocBlock([remarks, line === '' ? [] : [line], schemaTags(schema)])
}

// isAlphanumeric reports whether the whole string is [A-Za-z0-9]+.
export function isAlphanumeric(s: string): boolean {
  return /^[A-Za-z0-9]+$/.test(s)
}

// validJsIdentifier reports whether the name is a valid TS identifier
// (in particular it must not start with a digit).
export function validJsIdentifier(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)
}
