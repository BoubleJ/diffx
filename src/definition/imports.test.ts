import { describe, it, expect } from 'vitest'
import { parseImports } from './imports'

describe('parseImports', () => {
  it('reads default, named, aliased and namespace imports', () => {
    const map = parseImports([
      "import main, { formatDate as fmt, sum } from './utils/date'",
      "import * as utils from './utils'",
      "import type { User } from './types'",
      "import { type Role, getRole } from './roles'",
      "import './side.css'",
    ].join('\n'))
    expect(map.get('main')).toEqual({ specifier: './utils/date', imported: 'default' })
    expect(map.get('fmt')).toEqual({ specifier: './utils/date', imported: 'formatDate' })
    expect(map.get('sum')).toEqual({ specifier: './utils/date', imported: 'sum' })
    expect(map.get('utils')).toEqual({ specifier: './utils', imported: '*' })
    expect(map.get('User')).toEqual({ specifier: './types', imported: 'User' })
    expect(map.get('Role')).toEqual({ specifier: './roles', imported: 'Role' })
    expect(map.get('getRole')).toEqual({ specifier: './roles', imported: 'getRole' })
    expect(map.size).toBe(7)
  })

  it('reads imports spread over several lines', () => {
    const map = parseImports("import {\n  a,\n  b as c,\n} from '@/lib'\n")
    expect(map.get('a')).toEqual({ specifier: '@/lib', imported: 'a' })
    expect(map.get('c')).toEqual({ specifier: '@/lib', imported: 'b' })
  })
})
