import { useEffect, useState } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getSharedHighlighter } from '@pierre/diffs'
import { codeLanguage, hastText, type HastNode } from '../markdownCode'

const THEMES = { light: 'github-light', dark: 'github-dark' } as const

function PlainCode({ code }: { code: string }) {
  return <pre className="answer-code"><code>{code}</code></pre>
}

function HighlightedCode({ code, lang }: { code: string; lang: string }) {
  const [html, setHtml] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setHtml(null)
    getSharedHighlighter({ themes: [THEMES.light, THEMES.dark], langs: [lang] })
      .then((highlighter) => {
        if (!cancelled) setHtml(highlighter.codeToHtml(code, { lang, themes: THEMES, defaultColor: 'light' }))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [code, lang])
  if (html === null) return <PlainCode code={code} />
  return <div className="answer-code-highlighted" dangerouslySetInnerHTML={{ __html: html }} />
}

const components: Components = {
  table: ({ children }) => <div className="answer-table"><table>{children}</table></div>,
  a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
  pre: ({ node }) => {
    const code = (node as unknown as HastNode | undefined)?.children?.[0]
    const text = hastText(code).replace(/\n$/, '')
    const className = code?.properties?.className
    const lang = codeLanguage(Array.isArray(className) ? className.join(' ') : undefined)
    return lang ? <HighlightedCode code={text} lang={lang} /> : <PlainCode code={text} />
  },
}

export function AnswerMarkdown({ text }: { text: string }) {
  return (
    <div className="answer-markdown">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>{text}</Markdown>
    </div>
  )
}
