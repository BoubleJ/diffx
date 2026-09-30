export const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue']

export function isSourceFile(path: string): boolean {
  return SOURCE_EXTENSIONS.some((ext) => path.endsWith(ext))
}
