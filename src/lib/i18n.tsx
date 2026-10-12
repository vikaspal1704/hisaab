import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { HINGLISH } from './hinglish'

export type Lang = 'en' | 'hi'
type Vars = Record<string, string | number>

const STORAGE_KEY = 'hisaab.lang'

/** The language currently chosen (for code outside React, like error messages). */
export function currentLang(): Lang {
  return readLang()
}

function readLang(): Lang {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'hi' ? 'hi' : 'en'
  } catch {
    return 'en'
  }
}

/**
 * Translates an English UI string. The English text is the key, so screens
 * read naturally and anything not yet translated simply stays English.
 * Placeholders look like {name}.
 */
export function translate(lang: Lang, text: string, vars?: Vars): string {
  const template = lang === 'hi' ? (HINGLISH[text] ?? text) : text
  return vars ? template.replace(/\{(\w+)\}/g, (m, key: string) => (key in vars ? String(vars[key]) : m)) : template
}

interface I18n {
  lang: Lang
  setLang: (lang: Lang) => void
  t: (text: string, vars?: Vars) => string
}

const I18nContext = createContext<I18n>({ lang: 'en', setLang: () => {}, t: (text, vars) => translate('en', text, vars) })

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readLang)
  const setLang = useCallback((next: Lang) => {
    setLangState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Private mode: the choice lasts for this visit only.
    }
    document.documentElement.lang = next === 'hi' ? 'hi-Latn' : 'en'
  }, [])
  const value = useMemo<I18n>(() => ({ lang, setLang, t: (text, vars) => translate(lang, text, vars) }), [lang, setLang])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export const useT = () => useContext(I18nContext)
